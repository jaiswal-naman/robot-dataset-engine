import { createHmac } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { ApiError } from './errors';

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
  Promise.resolve(
    supabase.from('job_tokens').update({ last_used_at: new Date().toISOString() })
      .eq('id', tokenRow.id)
  ).catch(() => {});
}
