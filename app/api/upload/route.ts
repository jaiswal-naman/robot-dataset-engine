import { nanoid } from 'nanoid';
import { createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { withErrorHandler } from '@/lib/utils/api_handler';
import { ApiError } from '@/lib/utils/errors';
import { UploadRequestSchema } from '@/types/api';
import { createHmac, randomBytes, createHash } from 'crypto';

export const POST = withErrorHandler(async (req: Request) => {
  const requestId = req.headers.get('X-Request-Id') ?? `req_${nanoid(21)}`;
  
  // 1. Rate limit
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  await checkRateLimit('upload', ip);
  
  // 2. Parse + validate body
  const body = UploadRequestSchema.safeParse(await req.json());
  if (!body.success) {
    throw new ApiError('INVALID_FORMAT', { issues: body.error.issues });
  }
  const { file_name, file_size_bytes, mime_type, sha256 } = body.data;
  
  const supabase = createServiceClient();
  
  // 3. Idempotency check — same SHA-256 → return existing job at ANY status
  const idempotencyKey = `upload:${sha256}`;
  const { data: existingJob } = await (supabase
    .from('processing_jobs')
    .select('id, status, trace_id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle() as any) as { data: { id: string; status: string; trace_id: string } | null };
  
  if (existingJob) {
    // Mint a fresh token for the existing job (tokens are 24h)
    const rawToken = await mintJobToken(existingJob.id, supabase);
    const objectKey = `jobs/${existingJob.id}/RAW_VIDEO/v1/input.mp4`;
    const { data: signedUpload } = await supabase.storage
      .from('raw-videos')
      .createSignedUploadUrl(objectKey);
    
    if (!signedUpload?.signedUrl) {
      throw new ApiError('SIGNED_URL_FAILED');
    }

    return Response.json({
      job_id: existingJob.id,
      trace_id: existingJob.trace_id,
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
  
  const { error: jobInsertError } = await supabase.from('processing_jobs').insert({
    id: jobId,
    trace_id: traceId,
    status: 'UPLOADED',
    idempotency_key: idempotencyKey,
    input_bucket: 'raw-videos',
    input_object_key: objectKey,
  });
  
  if (jobInsertError) {
    throw new ApiError('INTERNAL_ERROR', { details: jobInsertError.message });
  }
  
  // 5. Mint job token
  const rawToken = await mintJobToken(jobId, supabase);
  
  // 6. Create the artifact row for the RAW_VIDEO  ← FIX: was missing before
  //    This is critical: Modal pipeline looks for this row to start processing
  const { error: artifactInsertError } = await (supabase.from('artifacts').insert({
    job_id: jobId,
    artifact_type: 'RAW_VIDEO',
    producer_agent: 'VIDEO_AGENT',   // closest valid enum value; UPLOAD_API is bootstrap
    bucket: 'raw-videos',
    object_key: objectKey,
    content_type: mime_type,
    size_bytes: file_size_bytes,
    sha256: sha256,
    metadata: { file_name, original_sha256: sha256 },
  } as any) as any);
  
  if (artifactInsertError) {
    // Non-fatal: log but don't fail
    console.error('Failed to create artifact row:', artifactInsertError.message);
  }
  
  // 7. Signed upload URL
  const { data: signedUpload } = await supabase.storage
    .from('raw-videos')
    .createSignedUploadUrl(objectKey);
  
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
