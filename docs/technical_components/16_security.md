# AutoEgoLab v3.0 — Security Architecture
**Document owner:** AI Systems Engineering  
**Revision:** 2.0 | **Date:** 2026-03-16 | **Status:** Build-Ready

---

## 16.1 Security Architecture Overview

AutoEgoLab uses an **anonymous session model with per-job capability tokens**. There are no user accounts. Each video upload creates an isolated, time-limited capability token that gates all subsequent access to that job's data.

**Threat model:**
1. **Unauthorized job access** — mitigation: job-scoped HMAC bearer tokens
2. **Storage data leakage** — mitigation: private buckets + short-lived signed URLs
3. **API abuse (scraping, DoS)** — mitigation: IP-based rate limiting
4. **Server-side request forgery** — mitigation: no user-controlled URL parameters in backend requests
5. **Secret leakage** — mitigation: environment isolation; no secrets in code, logs, or client bundles
6. **Malicious file upload** — mitigation: multi-layer validation before any processing begins

---

## 16.2 Job-Scoped Bearer Token Protocol

### Token Structure

```
ael_jt_<64-hex-chars>
```

- `ael_jt_` — fixed prefix for easy identification and redaction in logs
- 64 hex chars — 256 bits of entropy from `crypto.randomBytes(32).toString('hex')`

**Only the HMAC hash is stored in the database.** If the database is compromised, the attacker gets hashes, not valid tokens.

```typescript
// lib/utils/token.ts

import { createHmac, randomBytes } from 'crypto';

export function generateJobToken(): string {
  return `ael_jt_${randomBytes(32).toString('hex')}`;
}

export function hashToken(rawToken: string): string {
  return createHmac('sha256', process.env.JOB_TOKEN_SIGNING_SECRET!)
    .update(rawToken)
    .digest('hex');
}

export function verifyJobToken(rawToken: string, storedHash: string): boolean {
  const computedHash = hashToken(rawToken);
  
  // Constant-time comparison to prevent timing attacks
  return computedHash.length === storedHash.length &&
    crypto.timingSafeEqual(
      Buffer.from(computedHash, 'hex'),
      Buffer.from(storedHash, 'hex'),
    );
}
```

### Token Lifecycle

```
POST /api/upload
    │
    ├─ Create job row (no token yet)
    ├─ Generate raw token: ael_jt_<random64>
    ├─ Hash: HMAC-SHA256(JOB_TOKEN_SIGNING_SECRET, raw_token)
    ├─ Insert job_tokens row: { job_id, token_hash, expires_at: now + 24h }
    └─ Return raw_token to client ← ONLY TIME raw token is transmitted

Client stores: localStorage['ael_token_{job_id}'] = raw_token

On every subsequent API call:
    Authorization: Bearer ael_jt_<raw_token>
    
Server validates:
    1. Parse Bearer header
    2. Verify prefix 'ael_jt_'
    3. Hash token with HMAC
    4. Query job_tokens WHERE job_id = ? AND token_hash = ? AND expires_at > NOW()
    5. If no row found: 401 INVALID_JOB_TOKEN
    6. If expires_at past: 401 TOKEN_EXPIRED
    7. If revoked_at set: 401 TOKEN_REVOKED
```

### `job_tokens` Table

```sql
-- From 0001_init.sql
CREATE TABLE public.job_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id       UUID NOT NULL REFERENCES public.processing_jobs(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,   -- HMAC-SHA256 of raw token
    expires_at   TIMESTAMPTZ NOT NULL,   -- NOW() + 24h
    revoked_at   TIMESTAMPTZ,            -- NULL = active; set to revoke
    last_used_at TIMESTAMPTZ,            -- Updated on each valid use (async, best-effort)
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast token lookups
CREATE INDEX idx_job_tokens_job ON public.job_tokens(job_id, token_hash);

-- Token cleanup job (runs daily via Modal)
DELETE FROM public.job_tokens WHERE expires_at < NOW() - INTERVAL '24 hours';
```

---

## 16.3 File Upload Security — Multi-Layer Validation

Video files are a common vector for parser exploitation. AutoEgoLab runs 4 validation layers before any GPU processing:

```
Layer 1: Client-side (UX gatekeeping, not security-critical)
  - Extension check: .mp4 only
  - Size check: < 300MB
  - MIME type: 'video/mp4' from File.type

Layer 2: POST /api/upload server-side body validation (Zod schema)
  - Declared file_name, file_size_bytes, mime_type, sha256 validated
  - Size maximum enforced before creating any jobs
  - Returns 400 before any DB write if invalid

Layer 3: Post-upload ffprobe validation (runs on Modal CPU container)
  - Runs after the file lands in Supabase Storage
  - Checks: codec, duration, stream validity, non-zero video track
  - ffprobe runs in a subprocess — never parses the file in the main Python process
  - If ffprobe fails: status → FAILED_VALIDATION, file is cleaned up

Layer 4: Pre-inference sanity check (at Video Agent start)
  - Re-validates file size in storage matches declared size
  - SHA-256 of downloaded bytes matches stored sha256
  - If mismatch: FAILED_VIDEO_AGENT with INTEGRITY_CHECK_FAILED code
```

### ffprobe Validation Code

```python
# modal_backend/agents/video_agent.py

import subprocess, json

def validate_video_with_ffprobe(video_path: str) -> dict:
    """
    Run ffprobe in subprocess (never parse in-process — defense in depth).
    Returns parsed video metadata.
    Raises ValueError with typed code on validation failure.
    """
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_format", "-show_streams",
            video_path
        ],
        capture_output=True,
        text=True,
        timeout=30,  # Kill if takes > 30s (malformed file protection)
    )
    
    if result.returncode != 0:
        e = ValueError("ffprobe failed — corrupt or unsupported file")
        e.code = "CORRUPT_VIDEO"
        raise e
    
    probe = json.loads(result.stdout)
    
    video_streams = [s for s in probe.get("streams", []) if s.get("codec_type") == "video"]
    if not video_streams:
        e = ValueError("No video stream found")
        e.code = "NO_VIDEO_STREAM"
        raise e
    
    codec = video_streams[0].get("codec_name", "unknown")
    if codec not in CONFIG.VALID_CODECS:
        e = ValueError(f"Unsupported codec: {codec}")
        e.code = "BAD_CODEC"
        raise e
    
    duration = float(probe.get("format", {}).get("duration", 0))
    if duration > CONFIG.MAX_VIDEO_DURATION_SEC:
        e = ValueError(f"Video too long: {duration:.1f}s")
        e.code = "VIDEO_TOO_LONG"
        raise e
    
    if duration < 5:
        e = ValueError("Video too short (< 5s)")
        e.code = "VIDEO_TOO_SHORT"
        raise e
    
    return {
        "duration_sec": duration,
        "codec": codec,
        "width": video_streams[0].get("width"),
        "height": video_streams[0].get("height"),
        "fps": eval(video_streams[0].get("r_frame_rate", "1/1")),  # '30/1' → 30.0
    }
```

---

## 16.4 Row Level Security (RLS) Configuration

RLS ensures the anon key (used by the browser for Realtime) cannot read other users' job data.

```sql
-- From 0004_rls.sql

-- Enable RLS on all tables
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_graphs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_embeddings ENABLE ROW LEVEL SECURITY;

-- ─── processing_jobs ────────────────────────────────────────────────────
-- Service role bypasses RLS (used by API routes and Modal)
-- Anon role: NO access (all reads go through the authenticated API)
-- Note: Realtime reads via the Supabase Realtime system use a 
--       server-side subscription that bypasses RLS when using service role.
--       Browser clients subscribe via anon key, but the channel is filtered
--       by job_id in the SUBSCRIBE call — not via RLS.

-- Deny anon reads
CREATE POLICY "anon_no_read" ON public.processing_jobs
  FOR SELECT TO anon USING (false);

-- Service role can do anything
CREATE POLICY "service_role_all" ON public.processing_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Same pattern for all other tables:
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['artifacts', 'skill_segments', 'actions', 
                              'task_graphs', 'search_embeddings', 'agent_runs', 
                              'job_events', 'dataset_manifests'] LOOP
    EXECUTE format('CREATE POLICY "anon_no_read" ON public.%I FOR SELECT TO anon USING (false)', tbl);
    EXECUTE format('CREATE POLICY "service_role_all" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', tbl);
  END LOOP;
END $$;
```

---

## 16.5 API Rate Limiting

```typescript
// lib/rate-limit.ts — sliding window via Upstash Redis

const RATE_LIMITS = {
  'upload': {
    window: '1 h',
    max: 5,
    identifier: (req: Request) => getClientIp(req),
  },
  'process': {
    window: '1 h',
    max: 20,
    identifier: (req: Request) => getClientIp(req),
  },
  'search': {
    window: '1 h',
    max: 120,
    identifier: (req: Request) => getClientIp(req),
  },
  'status': {
    window: '1 min',
    max: 60,
    identifier: (req: Request) => extractJobToken(req) ?? getClientIp(req),
  },
} as const;

function getClientIp(req: Request): string {
  // Vercel sets X-Forwarded-For with real client IP
  // Always take the FIRST IP in the chain (leftmost = real client)
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}
```

**Response on rate limit:**
```json
HTTP/1.1 429 Too Many Requests
Retry-After: 3542
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1742100000

{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Upload limit: 5 per hour. Try again in 59 minutes.",
    "retryable": true
  },
  "request_id": "req_..."
}
```

---

## 16.6 Secret Management

### Rotation Schedule

| Secret | Purpose | Rotation Period | Rotation Procedure |
|---|---|---|---|
| `JOB_TOKEN_SIGNING_SECRET` | HMAC key for tokens | 30 days | Rotate in Vercel → all existing tokens immediately invalid |
| `MODAL_WEBHOOK_SECRET` | Webhook auth | 30 days | Must rotate in both Vercel and Modal simultaneously |
| `SUPABASE_SERVICE_ROLE_KEY` | DB service access | 60 days | Rotate in Supabase, update Vercel + Modal secrets |
| `GOOGLE_API_KEY` | Gemini API | 30 days | Generate new key, rotate in Modal secret |
| `LANGCHAIN_API_KEY` | LangSmith tracing | 90 days | Generate in LangSmith, rotate in Modal secret |
| `UPSTASH_REDIS_REST_TOKEN` | Rate limiting | 60 days | Rotate in Upstash, update Vercel secret |

### Secret Rotation Protocol (for `JOB_TOKEN_SIGNING_SECRET`)

```bash
# 1. Generate new secret
NEW_SECRET=$(openssl rand -hex 32)

# 2. Update in Vercel (takes effect on next deployment)
vercel env add JOB_TOKEN_SIGNING_SECRET production
# Paste NEW_SECRET when prompted

# 3. Redeploy to apply immediately
vercel --prod

# Note: After rotation, all existing job tokens are IMMEDIATELY invalid.
# Users in progress will see 401 TOKEN_EXPIRED and must restart their session.
# For zero-downtime rotation: implement dual-secret validation window (future enhancement)
```

---

## 16.7 Security Edge Cases

| Attack | Scenario | Defense |
|---|---|---|
| **Token replay** | Attacker captures bearer token from browser network tab | Short TTL (24h); HTTPS-only; `Secure` + `HttpOnly` if using cookies |
| **Timing attack on token** | Attacker tries many tokens and measures response time | `crypto.timingSafeEqual()` used for hashed comparison |
| **Malicious MP4 crafted for parser exploit** | PoC MP4 with malformed headers | ffprobe runs in subprocess; Python never parses binary layer; subprocess timeout = 30s |
| **SQL injection via filename** | `file_name = "'; DROP TABLE jobs;--"` | All DB writes use parameterized queries via Supabase JS SDK |
| **SSRF via job_id or signed URL params** | Attacker tries to read internal Modal/Supabase URLs via API | No server-side URL fetching using user-provided parameters |
| **Token in server logs** | Bearer header accidentally logged | `Authorization` header is redacted in all log statements; never log `req.headers` directly |
| **Service role key in client bundle** | Build misconfiguration exposes `SUPABASE_SERVICE_ROLE_KEY` | No `NEXT_PUBLIC_` prefix; CI step validates with `@next/bundle-analyzer` that key is absent |
| **Storage object enumeration** | Attacker guesses object keys (all include `job_id`) | Buckets are private; no public listing; signed URLs expire in ≤300s |
| **Job data cross-contamination** | Attacker uses their token to access another job's data | Token is bound to `job_id` by `job_tokens.job_id` FK; mismatched token = 401 |

---

## 16.8 Security Validation Checklist (Run Before Launch)

```bash
# 1. Verify service role key not in client bundle
npm run build
npx @next/bundle-analyzer  # Confirm SUPABASE_SERVICE_ROLE_KEY absent from chunks

# 2. Verify all storage buckets are private
supabase storage ls --project-ref [ref]  # All buckets should show public: false

# 3. Test token cross-job access (should fail)
TOKEN_B=$(curl -s -X POST /api/upload -d {...} | jq .job_access_token)
curl -H "Authorization: Bearer $TOKEN_B" /api/job/[job_id_of_different_job]
# Expected: 401 INVALID_JOB_TOKEN

# 4. Test expired token (should fail)
# Set job_tokens.expires_at = NOW() - INTERVAL '1 minute' in DB
curl -H "Authorization: Bearer $STALE_TOKEN" /api/job/[job_id]
# Expected: 401 TOKEN_EXPIRED

# 5. Test rate limiting
for i in {1..6}; do curl -X POST /api/upload -d {...}; done
# Expected: request 6 returns 429

# 6. Test malicious file upload
curl -X PUT [signed_url] --data-binary @corrupt.avi
curl -X POST /api/process -H "Authorization: Bearer $TOKEN" -d {...}
# Expected: job transitions to FAILED_VALIDATION

# 7. Run dependency audit
npm audit --audit-level=high
pip-audit -r requirements.txt
```

---
