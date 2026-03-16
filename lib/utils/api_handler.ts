import { nanoid } from 'nanoid';
import { ApiError } from './errors';

export { ApiError };

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
      return new ApiError('INTERNAL_ERROR', { details: err instanceof Error ? err.message : 'Unknown' }).toResponse(requestId);
    }
  };
}
