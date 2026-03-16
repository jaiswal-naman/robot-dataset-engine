import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { ApiError } from './utils/errors';

let redis: Redis | undefined;
try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = Redis.fromEnv();
  }
} catch (e) {
  console.warn('Upstash Redis not configured, rate limiting disabled.');
}

const limiters = redis ? {
  upload:  new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5,   '1 h'), prefix: 'rl:upload' }),
  process: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(20,  '1 h'), prefix: 'rl:process' }),
  search:  new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(120, '1 h'), prefix: 'rl:search' }),
} : null;

export async function checkRateLimit(
  endpoint: 'upload' | 'process' | 'search',
  identifier: string
): Promise<void> {
  // If Redis not configured (local dev), skip rate limiting
  if (!limiters) return;
  
  const { success, reset } = await limiters[endpoint].limit(identifier);
  
  if (!success) {
    const retryAfterSec = Math.ceil((reset - Date.now()) / 1000);
    throw new (class extends ApiError {
      retryAfterSec: number;
      constructor(code: any, context?: Record<string, unknown>) {
        super(code, context);
        this.retryAfterSec = retryAfterSec;
      }
    })('RATE_LIMIT_EXCEEDED');
  }
}
