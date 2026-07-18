export type WorkerStage = 'analyze' | 'assets' | 'designer' | 'hero';

export interface WorkerFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export function nextWorkerStage(
  stage: WorkerStage,
  scenario: unknown,
  traceSchemaVersion = 1,
): WorkerStage | null {
  if (stage === 'analyze') {
    if (traceSchemaVersion >= 2) return 'assets';
    return scenario === 'event' ? 'hero' : 'designer';
  }
  if (stage === 'assets') return scenario === 'event' ? 'hero' : 'designer';
  if (stage === 'designer') return 'hero';
  return null;
}

export function responseFailure(
  status: number,
  payload: unknown,
): WorkerFailure {
  const record = payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {};
  const message = typeof record.error === 'string'
    ? record.error
    : typeof record.message === 'string'
      ? record.message
      : `Generation stage returned HTTP ${status}.`;
  const code = typeof record.code === 'string'
    ? record.code
    : `stage_http_${status}`;
  const explicitRetryable = typeof record.retryable === 'boolean'
    ? record.retryable
    : null;
  return {
    code,
    message,
    retryable: explicitRetryable
      ?? (status === 408 || status === 429 || status >= 500),
  };
}

export function thrownFailure(error: unknown): WorkerFailure {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const status = typeof record.status === 'number'
      ? record.status
      : typeof record.statusCode === 'number'
        ? record.statusCode
        : undefined;
    const message = typeof record.message === 'string'
      ? record.message
      : String(error);
    const networkFailure = error instanceof TypeError
      || /network|fetch|socket|timed?\s*out|connection|econn/i.test(message);
    const explicitRetryable = typeof record.retryable === 'boolean'
      ? record.retryable
      : null;
    return {
      code: typeof record.code === 'string' ? record.code : 'worker_stage_error',
      message,
      retryable: explicitRetryable
        ?? (
          networkFailure
          || status === 408
          || status === 429
          || (status !== undefined && status >= 500)
        ),
    };
  }

  return {
    code: 'worker_stage_error',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}
