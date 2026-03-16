import { createServiceClient } from '@/lib/supabase/server';
import { withErrorHandler, ApiError } from '@/lib/utils/api_handler';
import { requireJobToken } from '@/lib/utils/auth';

const handler = async (req: Request, { params }: { params: { id: string } }) => {
  // Wait for `params` to resolve before destructuring properties
  const resolvedParams = await Promise.resolve(params);
  const jobId = resolvedParams.id;

  await requireJobToken(req, jobId);
  const supabase = createServiceClient();
  
  const { data: job } = await supabase
    .from('processing_jobs')
    .select(`
      id, status, progress_percent, current_agent,
      queued_at, started_at, completed_at, updated_at,
      failure_code, failure_details, trace_id
    `)
    .eq('id', jobId)
    .single() as { data: any, error: any };
  
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
};

export const GET = withErrorHandler(handler);
