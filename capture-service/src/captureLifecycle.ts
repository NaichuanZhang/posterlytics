import type { CaptureOutcome } from './types.js';

export const SOFT_SAMPLING_BUDGET_MS = 10_000;
export const CAPTURE_DEADLINE_MS = 13_000;
export const EDGE_CAPTURE_TIMEOUT_MS = 15_000;
export const NAV_TIMEOUT_MS = 9_000;
export const POST_NAV_SETTLE_MS = 200;
export const FRAME_SETTLE_MS = 75;
export const TOP_FRAME_RESERVE_MS = 2_000;
export const OPTIONAL_FRAME_MIN_REMAINING_MS = 2_000;
export const FULL_FINALIZATION_MIN_REMAINING_MS = 1_000;

export class CaptureDeadlineError extends Error {
  constructor(message = 'Capture did not produce usable evidence before the deadline.') {
    super(message);
    this.name = 'CaptureDeadlineError';
  }
}

export interface CaptureTimer {
  elapsedMs(): number;
  remainingMs(budgetMs?: number): number;
  hasRemaining(minimumMs: number, budgetMs?: number): boolean;
}

export function startMonotonicTimer(
  now: () => number = () => performance.now(),
): CaptureTimer {
  const startedAt = now();
  const elapsedMs = (): number => Math.max(0, now() - startedAt);
  const remainingMs = (
    budgetMs = SOFT_SAMPLING_BUDGET_MS,
  ): number => Math.max(0, budgetMs - elapsedMs());

  return {
    elapsedMs,
    remainingMs,
    hasRemaining: (minimumMs, budgetMs) =>
      remainingMs(budgetMs) >= Math.max(0, minimumMs),
  };
}

export function classifyCaptureOutcome({
  completed,
  framesCaptured,
  failure,
}: {
  completed: boolean;
  framesCaptured: number;
  failure?: Extract<CaptureOutcome, 'timeout' | 'error'>;
}): CaptureOutcome {
  if (failure) return failure;
  if (framesCaptured <= 0) return 'timeout';
  return completed ? 'success' : 'partial';
}

export function extractTargetHostname(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    return new URL(candidate).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export interface CaptureOutcomeLog {
  event: 'capture_request_outcome';
  timestamp: string;
  target_host: string;
  duration_ms: number;
  outcome: CaptureOutcome;
  frames_captured: number;
  process_uptime_ms: number;
}

export function buildCaptureOutcomeLog({
  timestamp,
  targetUrl,
  durationMs,
  outcome,
  framesCaptured,
  processUptimeMs,
}: {
  timestamp: string;
  targetUrl: string;
  durationMs: number;
  outcome: CaptureOutcome;
  framesCaptured: number;
  processUptimeMs: number;
}): CaptureOutcomeLog {
  return {
    event: 'capture_request_outcome',
    timestamp,
    target_host: extractTargetHostname(targetUrl),
    duration_ms: nonNegativeInteger(durationMs),
    outcome,
    frames_captured: nonNegativeInteger(framesCaptured),
    process_uptime_ms: nonNegativeInteger(processUptimeMs),
  };
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}
