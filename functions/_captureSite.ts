import type { DesignTokens } from '../src/lib/types.ts';

export interface CaptureResult {
  tokens: DesignTokens | null;
  styleBoardDataUrl: string | null;
  pageTitle?: string | null;
  finalUrl?: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
}

export type CaptureColorScheme = 'light' | 'dark';

export function normalizeCaptureColorScheme(
  value: unknown,
): CaptureColorScheme | null {
  if (value === undefined || value === null) return 'light';
  return value === 'light' || value === 'dark' ? value : null;
}

/**
 * Emitted once per capture attempt, on EVERY outcome. The paired
 * `capture_site_request` records the attempt; without this the structured error
 * every failure path already builds was discarded at the source, so there was no
 * way to aggregate why captures fail. Correlate the pair on `request_id`.
 *
 * `outcome` is the failure `code` verbatim ('capture_unconfigured',
 * 'capture_http_error', 'capture_timeout', 'capture_network_error') or 'ok', so a
 * log query can group by it directly. Field names mirror the capture service's own
 * `capture_request_outcome` so both sides of the hop aggregate the same way. Only
 * the hostname is logged, never the full URL or any captured bytes.
 */
function logCaptureOutcome(entry: {
  requestId: string;
  targetHost: string;
  colorScheme: CaptureColorScheme;
  startedAtMs: number;
  outcome: string;
  retryable: boolean;
  detail?: string;
  httpStatus?: number;
  hasTokens?: boolean;
  hasStyleBoard?: boolean;
}): void {
  const line = JSON.stringify({
    event: 'capture_site_outcome',
    timestamp: new Date().toISOString(),
    request_id: entry.requestId,
    target_host: entry.targetHost,
    color_scheme: entry.colorScheme,
    duration_ms: Math.max(0, Math.round(Date.now() - entry.startedAtMs)),
    outcome: entry.outcome,
    retryable: entry.retryable,
    http_status: entry.httpStatus,
    has_tokens: entry.hasTokens,
    has_style_board: entry.hasStyleBoard,
    detail: entry.detail,
  });
  if (entry.outcome === 'ok') {
    console.info(line);
    return;
  }
  console.warn(line);
}

function captureTargetHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    // The capture service remains the authoritative URL-validation boundary.
    return 'invalid';
  }
}

export async function captureSite(
  url: string,
  colorScheme: CaptureColorScheme = 'light',
): Promise<CaptureResult> {
  const requestId = crypto.randomUUID();
  const targetHost = captureTargetHost(url);
  const startedAtMs = Date.now();
  const serviceUrl = Deno.env.get('CAPTURE_SERVICE_URL');
  const token = Deno.env.get('CAPTURE_TOKEN');
  if (!serviceUrl || !token) {
    logCaptureOutcome({
      requestId,
      targetHost,
      colorScheme,
      startedAtMs,
      outcome: 'capture_unconfigured',
      retryable: false,
      detail: 'Capture service is not configured.',
    });
    return {
      tokens: null,
      styleBoardDataUrl: null,
      error: {
        code: 'capture_unconfigured',
        message: 'Capture service is not configured.',
        retryable: false,
      },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    console.info(JSON.stringify({
      event: 'capture_site_request',
      timestamp: new Date().toISOString(),
      request_id: requestId,
      target_host: targetHost,
      color_scheme: colorScheme,
    }));
    const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/capture`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, color_scheme: colorScheme }),
    });
    const result = await response.json().catch(() => ({})) as {
      tokens?: DesignTokens | null;
      screenshot_b64?: string | null;
      title?: string | null;
      final_url?: string | null;
      error?: { code?: string; message?: string; retryable?: boolean };
    };
    if (!response.ok) {
      const code = result.error?.code ?? 'capture_http_error';
      const message = result.error?.message
        ?? `Capture service failed (${response.status}).`;
      const retryable = result.error?.retryable ?? response.status >= 500;
      logCaptureOutcome({
        requestId,
        targetHost,
        colorScheme,
        startedAtMs,
        outcome: code,
        retryable,
        httpStatus: response.status,
        detail: message,
      });
      return {
        tokens: null,
        styleBoardDataUrl: null,
        error: { code, message, retryable },
      };
    }
    const tokens = result.tokens ?? null;
    const styleBoardDataUrl = result.screenshot_b64
      ? `data:image/jpeg;base64,${result.screenshot_b64}`
      : null;
    // A 200 that carries neither tokens nor a style board is a success by HTTP
    // and a dead end for the pipeline, so it is logged distinctly rather than as
    // 'ok' — otherwise an all-green log hides the case that produces no evidence.
    logCaptureOutcome({
      requestId,
      targetHost,
      colorScheme,
      startedAtMs,
      outcome: !tokens && !styleBoardDataUrl ? 'capture_empty_evidence' : 'ok',
      retryable: false,
      httpStatus: response.status,
      hasTokens: !!tokens,
      hasStyleBoard: !!styleBoardDataUrl,
    });
    return {
      tokens,
      styleBoardDataUrl,
      pageTitle: typeof result.title === 'string' ? result.title : null,
      finalUrl: typeof result.final_url === 'string' ? result.final_url : null,
      error: null,
    };
  } catch (error) {
    const timedOut = error instanceof DOMException
      && error.name === 'AbortError';
    const code = timedOut ? 'capture_timeout' : 'capture_network_error';
    const message = timedOut
      ? 'Capture request timed out.'
      : error instanceof Error
        ? error.message
        : String(error);
    logCaptureOutcome({
      requestId,
      targetHost,
      colorScheme,
      startedAtMs,
      outcome: code,
      retryable: true,
      detail: message,
    });
    return {
      tokens: null,
      styleBoardDataUrl: null,
      error: { code, message, retryable: true },
    };
  } finally {
    clearTimeout(timeout);
  }
}
