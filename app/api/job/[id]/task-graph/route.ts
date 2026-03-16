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

  const { data: graphs } = await supabase
    .from('task_graphs')
    .select('graph_json, model_name, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1) as { data: any[] | null; error: any };

  if (!graphs || graphs.length === 0) throw new ApiError('ARTIFACT_NOT_FOUND');

  const graphData = graphs[0];
  return new Response(JSON.stringify({
    job_id: jobId,
    graph: graphData.graph_json,
    model_name: graphData.model_name,
    created_at: graphData.created_at,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const GET = withErrorHandler(handler);
