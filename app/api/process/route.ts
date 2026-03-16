import { createServiceClient } from '@/lib/supabase/server';
import { withErrorHandler, ApiError } from '@/lib/utils/api_handler';
import { requireJobToken } from '@/lib/utils/auth';

const handler = async (req: Request) => {
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
    .single() as { data: any, error: any };
  
  if (!job) throw new ApiError('JOB_NOT_FOUND');
  
  // Idempotency — already triggered
  if (['QUEUED', 'VIDEO_AGENT_RUNNING', 'QUALITY_AGENT_RUNNING',
       'PERCEPTION_AGENT_RUNNING', 'SEGMENTATION_AGENT_RUNNING',
       'ACTION_AGENT_RUNNING', 'TASK_GRAPH_AGENT_RUNNING',
       'DATASET_BUILDER_RUNNING', 'COMPLETED'].includes(job.status)) {
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
    .maybeSingle(); // Note we don't handle soft deletes yet but that's what the schema implies
  
  // Let's check if the actual file exists in the storage bucket
  const { data: files, error: listError } = await supabase.storage
    .from('raw-videos')
    .list(`jobs/${job_id}/RAW_VIDEO/v1`, { limit: 10 });

  if (listError || !files || !files.some(f => f.name === 'input.mp4')) {
     throw new ApiError('UPLOAD_NOT_COMPLETE');
  }

  // 4. Atomic transition: UPLOADED → QUEUED
  const { error: transitionError } = await supabase
    .from('processing_jobs')
    .update({ status: 'QUEUED', queued_at: new Date().toISOString() })
    .eq('id', job_id)
    .eq('status', 'UPLOADED');  // Only succeeds if still UPLOADED
  
  if (transitionError) throw new ApiError('PIPELINE_TRIGGER_FAILED', { details: transitionError });
  
  // 5. Trigger Modal webhook
  try {
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
        throw new Error(`Modal returned ${modalRes.status}`);
     }
  } catch (err) {
     // Roll back to UPLOADED if Modal trigger fails
     await supabase.from('processing_jobs').update({ status: 'UPLOADED', queued_at: null })
       .eq('id', job_id);
     throw new ApiError('PIPELINE_TRIGGER_FAILED', { details: err instanceof Error ? err.message : 'Unknown' });
  }
  
  return Response.json({ job_id, status: 'QUEUED', trace_id: job.trace_id }, { status: 202 });
};

export const POST = withErrorHandler(handler);
