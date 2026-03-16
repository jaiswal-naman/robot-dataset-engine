import { embedQuery } from '@/lib/ai/embeddings';
import { createServiceClient } from '@/lib/supabase/server';
import { withErrorHandler, ApiError } from '@/lib/utils/api_handler';
import { requireJobToken } from '@/lib/utils/auth';

const handler = async (req: Request) => {
  const { job_id, query, top_k = 5 } = await req.json();
  
  if (!job_id || !query) throw new ApiError('INVALID_FORMAT');
  
  await requireJobToken(req, job_id);
  const supabase = createServiceClient();
  
  // Job must be completed
  const { data: job } = await supabase.from('processing_jobs')
    .select('status').eq('id', job_id).single() as { data: any, error: any };
  if (!job) throw new ApiError('JOB_NOT_FOUND');
  if (job.status !== 'COMPLETED') throw new ApiError('JOB_NOT_READY');
  
  // Generate query embedding
  const queryEmbedding = await embedQuery(query);  // 768-dim DINOv2/text embed
  
  // Convert embedding array to Postgres vector string format '[0.1, 0.2, ...]'
  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  // Vector search via pgvector RPC
  const { data: results, error } = await supabase.rpc('search_job_embeddings', {
    p_job_id: job_id,
    p_query_embedding: embeddingStr,
    p_top_k: Math.min(top_k, 20),  // Cap at 20 results
  });

  if (error) {
     throw new ApiError('INTERNAL_ERROR', { details: error.message });
  }
  
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
      similarity:   parseFloat(Number(r.score || 0).toFixed(4)), // score corresponds to RPC return type
      start_ts_ms:  segment?.start_ts_ms,
      end_ts_ms:    segment?.end_ts_ms,
      action_label: action?.action_label,
      primary_object: segment?.primary_object,
    };
  }));
  
  return Response.json({ job_id, query, results: enriched });
};

export const POST = withErrorHandler(handler);
