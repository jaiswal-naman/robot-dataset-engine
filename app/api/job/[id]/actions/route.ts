import { createServiceClient } from '@/lib/supabase/server';
import { withErrorHandler, ApiError } from '@/lib/utils/api_handler';
import { requireJobToken } from '@/lib/utils/auth';

const handler = async (req: Request, { params }: { params: { id: string } }) => {
  const { id: jobId } = await Promise.resolve(params);

  await requireJobToken(req, jobId);
  const supabase = createServiceClient();

  const { data: job } = await supabase
    .from('processing_jobs')
    .select('status')
    .eq('id', jobId)
    .single() as { data: any; error: any };

  if (!job) throw new ApiError('JOB_NOT_FOUND');
  if (job.status !== 'COMPLETED') throw new ApiError('JOB_NOT_READY');

  const { data: actions } = await supabase
    .from('actions')
    .select('id, action_index, action_label, verb, object, tool, confidence, model_used, segment_id')
    .eq('job_id', jobId)
    .order('action_index', { ascending: true }) as { data: any[] | null; error: any };

  return new Response(JSON.stringify({
    job_id: jobId,
    actions: actions ?? [],
    total: actions?.length ?? 0,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const GET = withErrorHandler(handler);
