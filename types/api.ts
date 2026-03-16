import { z } from 'zod';

export interface ApiErrorResponse {
  error: {
    code: string;           // Machine-readable error code (see catalog below)
    message: string;        // Human-readable description
    retryable: boolean;     // Should client retry with same params?
    field?: string;         // For validation errors — which field failed
  };
  request_id: string;       // For support lookups
  trace_id: string | null;  // LangSmith trace ID if applicable
}

export const UploadRequestSchema = z.object({
  file_name:        z.string().min(1).max(255).regex(/\.mp4$/i, 'Must be .mp4'),
  file_size_bytes:  z.number().int().positive().max(314_572_800),
  mime_type:        z.literal('video/mp4'),
  sha256:           z.string().regex(/^[a-f0-9]{64}$/, '64-char hex SHA-256'),
});

export type UploadRequest = z.infer<typeof UploadRequestSchema>;
