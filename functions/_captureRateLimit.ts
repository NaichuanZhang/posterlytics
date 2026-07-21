import type { CapturePreviewError } from './_capturePreview.ts';

export const MAX_CAPTURE_PREVIEW_RETRY_AFTER_SECONDS = 86_400;

export type CapturePreviewRateLimitDecision =
  | { kind: 'allow' }
  | {
      kind: 'deny';
      status: 429;
      error: CapturePreviewError;
      retryAfterSeconds: number;
    }
  | {
      kind: 'unavailable';
      status: 503;
      error: CapturePreviewError;
    };

const RATE_LIMITED_ERROR: CapturePreviewError = {
  code: 'rate_limited',
  message: 'Website capture is temporarily limited. Try again shortly.',
  retryable: true,
};

const RATE_LIMIT_UNAVAILABLE_ERROR: CapturePreviewError = {
  code: 'capture_preview_unavailable',
  message: 'Website capture is temporarily unavailable.',
  retryable: true,
};

export function mapCapturePreviewRateLimit(
  data: unknown,
  rpcError: unknown,
): CapturePreviewRateLimitDecision {
  if (rpcError) return unavailableDecision();

  const row = rpcRow(data);
  if (
    !row
    || typeof row.allowed !== 'boolean'
    || typeof row.retry_after_seconds !== 'number'
    || !Number.isFinite(row.retry_after_seconds)
  ) {
    return unavailableDecision();
  }
  if (row.allowed) {
    return row.retry_after_seconds === 0
      ? { kind: 'allow' }
      : unavailableDecision();
  }

  return {
    kind: 'deny',
    status: 429,
    error: { ...RATE_LIMITED_ERROR },
    retryAfterSeconds: normalizeRetryAfter(row.retry_after_seconds),
  };
}

function unavailableDecision(): CapturePreviewRateLimitDecision {
  return {
    kind: 'unavailable',
    status: 503,
    error: { ...RATE_LIMIT_UNAVAILABLE_ERROR },
  };
}

function rpcRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : null
    : value;
  return row && typeof row === 'object' && !Array.isArray(row)
    ? row as Record<string, unknown>
    : null;
}

function normalizeRetryAfter(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.min(
    MAX_CAPTURE_PREVIEW_RETRY_AFTER_SECONDS,
    Math.max(1, Math.ceil(value)),
  );
}
