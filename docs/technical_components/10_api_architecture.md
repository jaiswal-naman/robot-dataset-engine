# AutoEgoLab v3.0 — API Architecture
**Document owner:** AI Systems Engineering  
**Revision:** 2.0 | **Date:** 2026-03-16 | **Status:** Build-Ready

---

## 10.1 API Design Principles

1. **JSON over HTTPS** — all request and response bodies are `application/json`
2. **Explicit idempotency** — mutating endpoints accept an `idempotency_key` header; repeat calls with the same key return the original response
3. **Typed error envelopes** — every non-2xx response has a structured `error` object (never raw exception strings)
4. **Minimal surface area** — exactly 5 endpoints. No REST proliferation, no GraphQL
5. **Token-gated after creation** — only `POST /api/upload` is unauthenticated. Every other endpoint requires `Authorization: Bearer <job_access_token>`
6. **No partial success** — every endpoint either fully succeeds (2xx) or returns a typed error. Never return partial data with a 200

---

## 10.2 Common Request Headers

```
Content-Type: application/json
Authorization: Bearer <job_access_token>   ← required on all endpoints except POST /api/upload
Idempotency-Key: <uuid>                    ← recommended on POST /api/upload, required on POST /api/process
X-Request-Id: <uuid>                       ← optional; server generates one if absent; echoed in response
```

---

## 10.3 Standard Error Envelope

Every non-2xx response MUST use this format. Never return raw error messages from exceptions.

```typescript
// types/api.ts
interface ApiErrorResponse {
  error: {
    code: string;           // Machine-readable error code (see catalog below)
    message: string;        // Human-readable description
    retryable: boolean;     // Should client retry with same params?
    field?: string;         // For validation errors — which field failed
  };
  request_id: string;       // For support lookups
  trace_id: string | null;  // LangSmith trace ID if applicable
}
```

### Error Code Catalog

```typescript
// lib/utils/errors.ts

export const ERROR_CODES = {
  // Upload errors (400)
  INVALID_FORMAT:          { status: 400, retryable: false },
  FILE_TOO_LARGE:          { status: 400, retryable: false },
  VIDEO_TOO_LONG:          { status: 400, retryable: false },
  INVALID_MIME_TYPE:       { status: 400, retryable: false },
  INVALID_SHA256:          { status: 400, retryable: false },
  
  // Auth errors (401)
  MISSING_TOKEN:           { status: 401, retryable: false },
  INVALID_JOB_TOKEN:       { status: 401, retryable: false },
  TOKEN_EXPIRED:           { status: 401, retryable: false },
  TOKEN_REVOKED:           { status: 401, retryable: false },
  
  // State errors (409)
  JOB_NOT_FOUND:           { status: 404, retryable: false },
  JOB_NOT_READY:           { status: 409, retryable: true  },  // pipeline not done yet
  JOB_ALREADY_PROCESSING:  { status: 409, retryable: false },
  UPLOAD_NOT_COMPLETE:     { status: 409, retryable: true  },
  ARTIFACT_NOT_FOUND:      { status: 404, retryable: false },
  ARTIFACT_EXPIRED:        { status: 410, retryable: false },
  
  // Rate limiting (429)
  RATE_LIMIT_EXCEEDED:     { status: 429, retryable: true  },
  
  // Server errors (500/503)
  SIGNED_URL_FAILED:       { status: 500, retryable: true  },
  PIPELINE_TRIGGER_FAILED: { status: 503, retryable: true  },
  INTERNAL_ERROR:          { status: 500, retryable: false },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly context?: Record<string, unknown>
  ) {
    super(code);
  }
  
  toResponse(requestId: string, traceId: string | null = null): Response {
    const { status, retryable } = ERROR_CODES[this.code];
    return Response.json({
      error: { code: this.code, message: this.message, retryable },
      request_id: requestId,
      trace_id: traceId,
    }, { status });
  }
}
```

### Error Handler Wrapper

```typescript
// lib/utils/api_handler.ts

export function withErrorHandler(
  handler: (req: Request, ctx: any) => Promise<Response>
) {
  return async (req: Request, ctx: any): Promise<Response> => {
    const requestId = req.headers.get('X-Request-Id') ?? `req_${nanoid(21)}`;
    
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return err.toResponse(requestId);
      }
      
      // Unexpected error — log full stack, return sanitized 500
      console.error({ requestId, error: err, message: 'Unhandled API error' });
      return new ApiError('INTERNAL_ERROR').toResponse(requestId);
    }
  };
}

// Usage:
export const POST = withErrorHandler(async (req) => {
  // ... handler code
});
```

---

## 10.4 Endpoint 1 — `POST /api/upload`

**Purpose:** Initialize a new processing job and return signed upload destination.  
**Auth:** None (IP rate-limited — 5 requests/hour)  
**Idempotency:** If `sha256` matches an existing job in `UPLOADED` state, returns that job's data.

### Request Schema

```typescript
// types/api.ts
const UploadRequestSchema = z.object({
  file_name:        z.string().min(1).max(255).regex(/\.mp4$/i, 'Must be .mp4'),
  file_size_bytes:  z.number().int().positive().max(314_572_800),
  mime_type:        z.literal('video/mp4'),
  sha256:           z.string().regex(/^[a-f0-9]{64}$/, '64-char hex SHA-256'),
});
```

### Full Implementation

```typescript
// app/api/upload/route.ts
import { nanoid } from 'nanoid';
import { createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { withErrorHandler, ApiError } from '@/lib/utils/api_handler';
import { UploadRequestSchema } from '@/types/api';
import { createHmac, randomBytes } from 'crypto';

export const POST = withErrorHandler(async (req: Request) => {
  const requestId = `req_${nanoid(21)}`;
  
  // 1. Rate limit
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  await checkRateLimit('upload', ip);  // throws ApiError('RATE_LIMIT_EXCEEDED') if over
  
  // 2. Parse + validate body
  const body = UploadRequestSchema.safeParse(await req.json());
  if (!body.success) {
    throw new ApiError('INVALID_FORMAT', { issues: body.error.issues });
  }
  const { file_name, file_size_bytes, mime_type, sha256 } = body.data;
  
  const supabase = createServiceClient();
  
  // 3. Idempotency check (same SHA-256 → return existing job)
  const idempotencyKey = `upload:${sha256}`;
  const { data: existingJob } = await supabase
    .from('processing_jobs')
    .select('id, status')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  
  if (existingJob && existingJob.status === 'UPLOADED') {
    const { data: existingToken } = await supabase
      .from('job_tokens')
      .select('token_hash')
      .eq('job_id', existingJob.id)
      .single();
    // Note: We can't return the original raw token (only hash stored)
    // Issue a new token for the same job
    const rawToken = mintJobToken(existingJob.id, supabase);
    const objectKey = `jobs/${existingJob.id}/RAW_VIDEO/v1/input.mp4`;
    const { data: signedUpload } = await supabase.storage
      .from('raw-videos')
      .createSignedUploadUrl(objectKey, { expiresIn: 900 });
    
    return Response.json({
      job_id: existingJob.id,
      job_access_token: rawToken,
      idempotent: true,
      upload: { bucket: 'raw-videos', object_key: objectKey,
                signed_url: signedUpload.signedUrl, expires_in_sec: 900 },
      limits: { max_duration_sec: 360, max_size_bytes: 314_572_800 },
    }, { status: 200, headers: { 'X-Request-Id': requestId } });
  }
  
  // 4. Create new job
  const jobId = crypto.randomUUID();
  const traceId = `trc_${nanoid(21)}`;
  const objectKey = `jobs/${jobId}/RAW_VIDEO/v1/input.mp4`;
  
  await supabase.from('processing_jobs').insert({
    id: jobId,
    trace_id: traceId,
    status: 'UPLOADED',
    idempotency_key: idempotencyKey,
    input_bucket: 'raw-videos',
    input_object_key: objectKey,
  });
  
  // 5. Mint job token
  const rawToken = await mintJobToken(jobId, supabase);
  
  // 6. Signed upload URL
  const { data: signedUpload } = await supabase.storage
    .from('raw-videos')
    .createSignedUploadUrl(objectKey, { expiresIn: 900 });
  
  if (!signedUpload?.signedUrl) {
    throw new ApiError('SIGNED_URL_FAILED');
  }
  
  return Response.json({
    job_id: jobId,
    trace_id: traceId,
    job_access_token: rawToken,
    upload: {
      bucket: 'raw-videos',
      object_key: objectKey,
      signed_url: signedUpload.signedUrl,
      expires_in_sec: 900,
    },
    limits: { max_duration_sec: 360, max_size_bytes: 314_572_800 },
  }, { status: 201, headers: { 'X-Request-Id': requestId } });
});

async function mintJobToken(jobId: string, supabase: any): Promise<string> {
  const rawToken = `ael_jt_${randomBytes(32).toString('hex')}`;
  const tokenHash = createHmac('sha256', process.env.JOB_TOKEN_SIGNING_SECRET!)
    .update(rawToken).digest('hex');
  
  await supabase.from('job_tokens').insert({
    job_id: jobId,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
  
  return rawToken;
}
```

### Response (201)

```json
{
  "job_id": "2f8a1c3d-...",
  "trace_id": "trc_AbCdEf12345...",
  "job_access_token": "ael_jt_a1b2c3...",
  "upload": {
    "bucket": "raw-videos",
    "object_key": "jobs/2f8a.../RAW_VIDEO/v1/input.mp4",
    "signed_url": "https://[project].supabase.co/storage/v1/object/sign/raw-videos/jobs/...",
    "expires_in_sec": 900
  },
  "limits": {
    "max_duration_sec": 360,
    "max_size_bytes": 314572800
  }
}
```

---

## 10.5 Endpoint 2 — `POST /api/process`

**Purpose:** Signal that the client upload is complete and trigger the AI pipeline.  
**Auth:** `Authorization: Bearer <job_access_token>` required  
**Idempotency:** Calling multiple times is safe — only the first call transitions to QUEUED and triggers Modal.

### Full Implementation

```typescript
// app/api/process/route.ts
export const POST = withErrorHandler(async (req: Request) => {
  const { job_id } = await req.json();
  if (!job_id) throw new ApiError('INVALID_FORMAT', { field: 'job_id' });
  
  // 1. Validate token
  await requireJobToken(req, job_id);
  
  // 2. Load job
  const supabase = createServiceClient();
  const { data: job } = await supabase
    .from('processing_jobs')
    .select('id, status, trace_id')
    .eq('id', job_id)
    .single();
  
  if (!job) throw new ApiError('JOB_NOT_FOUND');
  
  // Idempotency — already triggered
  if (['QUEUED', 'VIDEO_AGENT_RUNNING', 'QUALITY_AGENT_RUNNING',
       'PERCEPTION_AGENT_RUNNING', 'SEGMENTATION_AGENT_RUNNING',
       'ACTION_AGENT_RUNNING', 'TASK_GRAPH_AGENT_RUNNING',
       'DATASET_BUILDER_RUNNING'].includes(job.status)) {
    return Response.json({ job_id, status: job.status, trace_id: job.trace_id }, { status: 202 });
  }
  
  if (job.status !== 'UPLOADED') {
    throw new ApiError('JOB_ALREADY_PROCESSING', { current_status: job.status });
  }
  
  // 3. Verify video is actually in Storage before triggering
  const { data: videoArtifact } = await supabase
    .from('artifacts')
    .select('id')
    .eq('job_id', job_id)
    .eq('artifact_type', 'RAW_VIDEO')
    .is('deleted_at', null)
    .maybeSingle();
  
  if (!videoArtifact) throw new ApiError('UPLOAD_NOT_COMPLETE');
  
  // 4. Atomic transition: UPLOADED → QUEUED (optimistic lock prevents double-trigger)
  const { error: transitionError } = await supabase
    .from('processing_jobs')
    .update({ status: 'QUEUED', queued_at: new Date().toISOString() })
    .eq('id', job_id)
    .eq('status', 'UPLOADED');  // Only succeeds if still UPLOADED
  
  if (transitionError) throw new ApiError('PIPELINE_TRIGGER_FAILED');
  
  // 5. Trigger Modal webhook
  const modalRes = await fetch(process.env.MODAL_WEBHOOK_URL!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MODAL_WEBHOOK_SECRET!}`,
    },
    body: JSON.stringify({ job_id, trace_id: job.trace_id }),
    signal: AbortSignal.timeout(5000),  // 5s timeout
  });
  
  if (!modalRes.ok) {
    // Roll back to UPLOADED if Modal trigger fails
    await supabase.from('processing_jobs').update({ status: 'UPLOADED', queued_at: null })
      .eq('id', job_id);
    throw new ApiError('PIPELINE_TRIGGER_FAILED');
  }
  
  return Response.json({ job_id, status: 'QUEUED', trace_id: job.trace_id }, { status: 202 });
});
```

---

## 10.6 Endpoint 3 — `GET /api/job/:id`

**Purpose:** Return current job state for polling / session restore.  
**Auth:** Bearer token required.  
**Rate limit:** 60 req/min per token (polling fallback case).

```typescript
// app/api/job/[id]/route.ts
export const GET = withErrorHandler(async (req: Request, { params }: { params: { id: string } }) => {
  await requireJobToken(req, params.id);
  const supabase = createServiceClient();
  
  const { data: job } = await supabase
    .from('processing_jobs')
    .select(`
      id, status, progress_percent, current_agent,
      queued_at, started_at, completed_at, updated_at,
      failure_code, failure_details, trace_id
    `)
    .eq('id', params.id)
    .single();
  
  if (!job) throw new ApiError('JOB_NOT_FOUND');
  
  return Response.json({
    job_id: job.id,
    trace_id: job.trace_id,
    status: job.status,
    progress_percent: job.progress_percent,
    current_agent: job.current_agent,
    timings: {
      queued_at:    job.queued_at,
      started_at:   job.started_at,
      completed_at: job.completed_at,
      updated_at:   job.updated_at,
    },
    last_error: job.failure_code
      ? { code: job.failure_code, details: job.failure_details }
      : null,
  });
});
```

### Response (200)

```json
{
  "job_id": "2f8a...",
  "trace_id": "trc_...",
  "status": "ACTION_AGENT_RUNNING",
  "progress_percent": 72,
  "current_agent": "ACTION_AGENT",
  "timings": {
    "queued_at":    "2026-03-16T06:00:00Z",
    "started_at":   "2026-03-16T06:00:12Z",
    "completed_at": null,
    "updated_at":   "2026-03-16T06:02:20Z"
  },
  "last_error": null
}
```

---

## 10.7 Endpoint 4 — `GET /api/job/:id/dataset`

**Purpose:** Return signed download URLs for the final dataset artifacts.  
**Auth:** Bearer token required. Only returns data when `status = COMPLETED`.

```typescript
// app/api/job/[id]/dataset/route.ts
export const GET = withErrorHandler(async (req: Request, { params }: { params: { id: string } }) => {
  await requireJobToken(req, params.id);
  const supabase = createServiceClient();
  
  const { data: job } = await supabase
    .from('processing_jobs').select('status').eq('id', params.id).single();
  
  if (!job) throw new ApiError('JOB_NOT_FOUND');
  if (job.status !== 'COMPLETED') throw new ApiError('JOB_NOT_READY', { status: job.status });
  
  const { data: manifest } = await supabase
    .from('dataset_manifests')
    .select('*, json_artifact:dataset_json_artifact_id(*), rlds_artifact:dataset_rlds_artifact_id(*)')
    .eq('job_id', params.id)
    .single();
  
  // Generate signed URLs (300s TTL)
  const [jsonUrl, rldsUrl] = await Promise.all([
    generateSignedDownloadUrl(manifest.dataset_json_artifact_id, 300),
    generateSignedDownloadUrl(manifest.dataset_rlds_artifact_id, 300),
  ]);
  
  return Response.json({
    job_id: params.id,
    status: 'COMPLETED',
    downloads: [
      { type: 'DATASET_JSON', filename: 'dataset.json',      signed_url: jsonUrl,  expires_in_sec: 300 },
      { type: 'DATASET_RLDS', filename: 'dataset.tfrecord',  signed_url: rldsUrl,  expires_in_sec: 300 },
    ],
    manifest: {
      schema_version:   manifest.schema_version,
      dataset_version:  manifest.dataset_version,
      record_count:     manifest.record_count,
      segment_count:    manifest.manifest_json?.segment_count,
      action_count:     manifest.manifest_json?.action_count,
      task_graph_nodes: manifest.manifest_json?.task_graph_node_count,
      warnings:         manifest.warnings ?? [],
    },
  });
});
```

---

## 10.8 Endpoint 5 — `POST /api/search`

**Purpose:** Semantic similarity search over extracted skills/actions for a specific job.  
**Auth:** Bearer token required. Job must be `COMPLETED`.  
**Rate limit:** 120 req/hour per IP.

```typescript
// app/api/search/route.ts
import { embedQuery } from '@/lib/ai/embeddings';

export const POST = withErrorHandler(async (req: Request) => {
  const { job_id, query, top_k = 5 } = await req.json();
  
  if (!job_id || !query) throw new ApiError('INVALID_FORMAT');
  
  await requireJobToken(req, job_id);
  const supabase = createServiceClient();
  
  // Job must be completed
  const { data: job } = await supabase.from('processing_jobs')
    .select('status').eq('id', job_id).single();
  if (!job) throw new ApiError('JOB_NOT_FOUND');
  if (job.status !== 'COMPLETED') throw new ApiError('JOB_NOT_READY');
  
  // Generate query embedding
  const queryEmbedding = await embedQuery(query);  // 768-dim DINOv2/text embed
  
  // Vector search via pgvector RPC
  const { data: results } = await supabase.rpc('search_job_embeddings', {
    p_job_id: job_id,
    p_query_embedding: queryEmbedding,
    p_top_k: Math.min(top_k, 20),  // Cap at 20 results
  });
  
  // Enrich results with segment timestamps
  const enriched = await Promise.all((results ?? []).map(async (r: any) => {
    const { data: action } = await supabase
      .from('actions').select('action_label, verb, object')
      .eq('id', r.action_id).single();
    const { data: segment } = await supabase
      .from('skill_segments').select('start_ts_ms, end_ts_ms, primary_object')
      .eq('id', r.segment_id).single();
    return {
      segment_id:   r.segment_id,
      action_id:    r.action_id,
      text:         r.text_content,
      similarity:   parseFloat(r.similarity.toFixed(4)),
      start_ts_ms:  segment?.start_ts_ms,
      end_ts_ms:    segment?.end_ts_ms,
      action_label: action?.action_label,
      primary_object: segment?.primary_object,
    };
  }));
  
  return Response.json({ job_id, query, results: enriched });
});
```

---

## 10.9 Token Validation Utility (Shared)

Used by all protected endpoints. Extract this into `lib/utils/auth.ts`:

```typescript
// lib/utils/auth.ts
import { createHmac } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { ApiError } from './api_handler';

export async function requireJobToken(req: Request, jobId: string): Promise<void> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new ApiError('MISSING_TOKEN');
  }
  
  const rawToken = authHeader.slice(7);
  if (!rawToken.startsWith('ael_jt_')) {
    throw new ApiError('INVALID_JOB_TOKEN');
  }
  
  const tokenHash = createHmac('sha256', process.env.JOB_TOKEN_SIGNING_SECRET!)
    .update(rawToken)
    .digest('hex');
  
  const supabase = createServiceClient();
  const { data: tokenRow } = await supabase
    .from('job_tokens')
    .select('id, expires_at, revoked_at')
    .eq('job_id', jobId)
    .eq('token_hash', tokenHash)
    .maybeSingle();
  
  if (!tokenRow) throw new ApiError('INVALID_JOB_TOKEN');
  if (new Date(tokenRow.expires_at) < new Date()) throw new ApiError('TOKEN_EXPIRED');
  if (tokenRow.revoked_at) throw new ApiError('TOKEN_REVOKED');
  
  // Update last_used_at (best-effort, don't fail if this errors)
  supabase.from('job_tokens').update({ last_used_at: new Date().toISOString() })
    .eq('id', tokenRow.id).then(() => {});
}
```

---

## 10.10 Rate Limiting Implementation

```typescript
// lib/rate-limit.ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { ApiError } from './utils/api_handler';

const redis = Redis.fromEnv();

const limiters = {
  upload:  new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5,   '1 h'), prefix: 'rl:upload' }),
  process: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(20,  '1 h'), prefix: 'rl:process' }),
  search:  new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(120, '1 h'), prefix: 'rl:search' }),
};

export async function checkRateLimit(
  endpoint: keyof typeof limiters,
  identifier: string
): Promise<void> {
  // If Redis not configured (local dev), skip rate limiting
  if (!process.env.UPSTASH_REDIS_REST_URL) return;
  
  const { success, reset } = await limiters[endpoint].limit(identifier);
  
  if (!success) {
    const retryAfterSec = Math.ceil((reset - Date.now()) / 1000);
    throw Object.assign(new ApiError('RATE_LIMIT_EXCEEDED'), { retryAfterSec });
  }
}
```

---

## 10.11 API Edge Cases

| Scenario | Client Action | Server Behavior |
|---|---|---|
| Upload then immediately `POST /process` before video fully PUTs | `POST /api/process` before storage write completes | 409 `UPLOAD_NOT_COMPLETE` — `artifacts` table checked for `RAW_VIDEO` row |
| `GET /api/job/:id/dataset` before pipeline done | Polling client calls dataset before COMPLETED | 409 `JOB_NOT_READY` with `current_status` in error body |
| `POST /api/process` called twice | Double-click / retry logic | Second call detects job already in `QUEUED` → returns 202 with current status (idempotent) |
| Invalid bearer token (tampered) | Attacker modifies token | HMAC mismatch → 401 `INVALID_JOB_TOKEN` — never reveals *why* it failed |
| `POST /api/search` with empty query | Frontend bug | 400 `INVALID_FORMAT` with `{field: "query"}` |
| Modal webhook times out (>5s) | Network issue to Modal | Roll back to UPLOADED status; return 503 `PIPELINE_TRIGGER_FAILED`; client can retry `POST /api/process` |

---
