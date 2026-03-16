export const ERROR_CODES = {
  // Upload errors (400)
  INVALID_FORMAT:          { status: 400, retryable: false },
  FILE_TOO_LARGE:          { status: 400, retryable: false },
  VIDEO_TOO_LONG:          { status: 400, retryable: false },
  INVALID_MIME_TYPE:       { status: 400, retryable: false },
  INVALID_SHA256:          { status: 400, retryable: false },
  
  // Auth errors (401)
  MISSING_TOKEN:           { status: 401, retryable: false },
  INVALID_JOB_TOKEN:       { status: 401, retryable: false },
  TOKEN_EXPIRED:           { status: 401, retryable: false },
  TOKEN_REVOKED:           { status: 401, retryable: false },
  
  // State errors (409)
  JOB_NOT_FOUND:           { status: 404, retryable: false },
  JOB_NOT_READY:           { status: 409, retryable: true  },  // pipeline not done yet
  JOB_ALREADY_PROCESSING:  { status: 409, retryable: false },
  UPLOAD_NOT_COMPLETE:     { status: 409, retryable: true  },
  ARTIFACT_NOT_FOUND:      { status: 404, retryable: false },
  ARTIFACT_EXPIRED:        { status: 410, retryable: false },
  
  // Rate limiting (429)
  RATE_LIMIT_EXCEEDED:     { status: 429, retryable: true  },
  
  // Server errors (500/503)
  SIGNED_URL_FAILED:       { status: 500, retryable: true  },
  PIPELINE_TRIGGER_FAILED: { status: 503, retryable: true  },
  INTERNAL_ERROR:          { status: 500, retryable: false },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly context?: Record<string, unknown>
  ) {
    super(code);
    this.name = 'ApiError';
  }
  
  toResponse(requestId: string, traceId: string | null = null): Response {
    const { status, retryable } = ERROR_CODES[this.code];
    return Response.json({
      error: { code: this.code, message: this.message || this.code, retryable, ...this.context },
      request_id: requestId,
      trace_id: traceId,
    }, { status });
  }
}
