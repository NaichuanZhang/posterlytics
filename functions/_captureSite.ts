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

export async function captureSite(
  url: string,
  colorScheme: CaptureColorScheme = 'light',
): Promise<CaptureResult> {
  const serviceUrl = Deno.env.get('CAPTURE_SERVICE_URL');
  const token = Deno.env.get('CAPTURE_TOKEN');
  if (!serviceUrl || !token) {
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
    let targetHost = 'invalid';
    try {
      targetHost = new URL(url).hostname.toLowerCase();
    } catch {
      // The capture service remains the authoritative URL-validation boundary.
    }
    console.info(JSON.stringify({
      event: 'capture_site_request',
      timestamp: new Date().toISOString(),
      request_id: crypto.randomUUID(),
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
      return {
        tokens: null,
        styleBoardDataUrl: null,
        error: {
          code: result.error?.code ?? 'capture_http_error',
          message: result.error?.message
            ?? `Capture service failed (${response.status}).`,
          retryable: result.error?.retryable ?? response.status >= 500,
        },
      };
    }
    return {
      tokens: result.tokens ?? null,
      styleBoardDataUrl: result.screenshot_b64
        ? `data:image/jpeg;base64,${result.screenshot_b64}`
        : null,
      pageTitle: typeof result.title === 'string' ? result.title : null,
      finalUrl: typeof result.final_url === 'string' ? result.final_url : null,
      error: null,
    };
  } catch (error) {
    const timedOut = error instanceof DOMException
      && error.name === 'AbortError';
    return {
      tokens: null,
      styleBoardDataUrl: null,
      error: {
        code: timedOut ? 'capture_timeout' : 'capture_network_error',
        message: timedOut
          ? 'Capture request timed out.'
          : error instanceof Error
            ? error.message
            : String(error),
        retryable: true,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
