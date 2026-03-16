import { createServiceClient } from '@/lib/supabase/server';
import { withErrorHandler, ApiError } from '@/lib/utils/api_handler';
import { requireJobToken } from '@/lib/utils/auth';

const handler = async (req: Request, { params }: { params: { id: string } }) => {
  // Wait for `params` to resolve before destructuring
  const resolvedParams = await Promise.resolve(params);
  const jobId = resolvedParams.id;

  await requireJobToken(req, jobId);
  const supabase = createServiceClient();
  
  const { data: job } = await supabase
    .from('processing_jobs').select('status').eq('id', jobId).single();
  
  if (!job) throw new ApiError('JOB_NOT_FOUND');
  if (job.status !== 'COMPLETED') throw new ApiError('JOB_NOT_READY', { status: job.status });
  
  const { data: manifest } = await supabase
    .from('dataset_manifests')
    .select('*, json_artifact:dataset_json_artifact_id(*), rlds_artifact:dataset_rlds_artifact_id(*)')
    .eq('job_id', jobId)
    .single();

  if (!manifest) throw new ApiError('INTERNAL_ERROR', { message: 'No manifest found for completed job.' });
  
  // Generate signed URLs (300s TTL)
  const jsonUrl = manifest.json_artifact 
      ? (await supabase.storage.from((manifest.json_artifact as any).bucket).createSignedUrl((manifest.json_artifact as any).object_key, 300)).data?.signedUrl 
      : null;
      
  const rldsUrl = manifest.rlds_artifact 
      ? (await supabase.storage.from((manifest.rlds_artifact as any).bucket).createSignedUrl((manifest.rlds_artifact as any).object_key, 300)).data?.signedUrl 
      : null;
  
  return Response.json({
    job_id: jobId,
    status: 'COMPLETED',
    downloads: [
      { type: 'DATASET_JSON', filename: 'dataset.json',      signed_url: jsonUrl,  expires_in_sec: 300 },
      { type: 'DATASET_RLDS', filename: 'dataset.tfrecord',  signed_url: rldsUrl,  expires_in_sec: 300 },
    ].filter(d => d.signed_url), // only return those that generated correctly
    manifest: {
      schema_version:   manifest.schema_version,
      dataset_version:  manifest.dataset_version,
      record_count:     manifest.record_count,
      segment_count:    (manifest.manifest_json as any)?.segment_count,
      action_count:     (manifest.manifest_json as any)?.action_count,
      task_graph_nodes: (manifest.manifest_json as any)?.task_graph_node_count,
      warnings:         manifest.warnings ?? [],
    },
  });
};

export const GET = withErrorHandler(handler);
