// Minimal HTTP server for the capture container (Node built-ins only).
//   GET  /healthz   -> 200 "ok"            (compute liveness)
//   POST /capture   -> { tokens, screenshot_b64, final_url, title }
//     Auth: Authorization: Bearer <CAPTURE_TOKEN>
//     Body: { "url": "https://...", "color_scheme"?: "light" | "dark" }
//     Up to three frames use a 10-second soft sampling budget; a 13-second
//     hard deadline may still return usable one-frame partial evidence.
//
// Only the `analyze` edge function calls this, presenting the shared bearer
// token. The container holds NO InsForge credentials by design — it returns
// the style board as base64 and `analyze` stores it.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { captureUrl, warmBrowser } from './capture.js';
import {
  InvalidColorSchemeError,
  normalizeColorScheme,
  type ColorScheme,
} from './captureOptions.js';
import {
  CAPTURE_DEADLINE_MS,
  CaptureDeadlineError,
  buildCaptureOutcomeLog,
  classifyCaptureOutcome,
  startMonotonicTimer,
} from './captureLifecycle.js';
import { UnsafeTargetError } from './networkSafety.js';
import type {
  CaptureErrorBody,
  CaptureExecutionResult,
  CaptureOutcome,
} from './types.js';

const PORT = Number(process.env.PORT) || 8080;
const CAPTURE_TOKEN = process.env.CAPTURE_TOKEN || '';
const MAX_BODY_BYTES = 16 * 1024; // request bodies are tiny ({url})

class BodyTooLargeError extends Error {}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  retryable = false,
): void {
  const body: CaptureErrorBody = { error: { code, message, retryable } };
  send(res, status, body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLargeError('Request body is too large.'));
        req.destroy();
        return;
      }
      data += chunk.toString('utf8');
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function authorized(req: IncomingMessage): boolean {
  // If no token is configured, refuse everything (fail closed).
  if (!CAPTURE_TOKEN) return false;
  const header = req.headers['authorization'] || '';
  return header === `Bearer ${CAPTURE_TOKEN}`;
}

async function captureWithDeadline(
  url: string,
  colorScheme: ColorScheme,
): Promise<CaptureExecutionResult> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new CaptureDeadlineError('Capture exceeded the 13 second deadline.'));
    }, CAPTURE_DEADLINE_MS);
  });

  try {
    return await Promise.race([captureUrl(url, colorScheme, controller.signal), deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      return send(res, 200, 'ok');
    }

    if (req.method === 'POST' && (req.url === '/capture' || req.url?.startsWith('/capture?'))) {
      if (!authorized(req)) {
        return sendError(res, 401, 'unauthorized', 'A valid bearer token is required.');
      }

      let url: string;
      let colorScheme: ColorScheme;
      try {
        const parsed = JSON.parse((await readBody(req)) || '{}');
        url = String(parsed.url || '').trim();
        colorScheme = normalizeColorScheme(parsed.color_scheme);
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          return sendError(res, 413, 'body_too_large', error.message);
        }
        if (error instanceof InvalidColorSchemeError) {
          return sendError(res, 400, 'invalid_color_scheme', error.message);
        }
        return sendError(res, 400, 'invalid_json', 'The request body must be valid JSON.');
      }
      if (!url) return sendError(res, 400, 'missing_url', 'The request must include a URL.');

      const attemptTimer = startMonotonicTimer();
      try {
        const result = await captureWithDeadline(url, colorScheme);
        logCaptureOutcome(
          url,
          attemptTimer.elapsedMs(),
          result.outcome,
          result.framesCaptured,
        );
        return send(res, 200, result.response);
      } catch (err) {
        const outcome = classifyCaptureOutcome({
          completed: false,
          framesCaptured: 0,
          failure: err instanceof CaptureDeadlineError ? 'timeout' : 'error',
        });
        logCaptureOutcome(url, attemptTimer.elapsedMs(), outcome, 0);
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof UnsafeTargetError) {
          return sendError(res, 422, 'unsafe_target', message);
        }
        if (err instanceof CaptureDeadlineError) {
          return sendError(res, 504, 'capture_timeout', message, true);
        }
        return sendError(res, 502, 'capture_failed', message, true);
      }
    }

    return sendError(res, 404, 'not_found', 'Route not found.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return sendError(res, 500, 'internal_error', message);
  }
});

function logCaptureOutcome(
  targetUrl: string,
  durationMs: number,
  outcome: CaptureOutcome,
  framesCaptured: number,
): void {
  console.log(JSON.stringify(buildCaptureOutcomeLog({
    timestamp: new Date().toISOString(),
    targetUrl,
    durationMs,
    outcome,
    framesCaptured,
    processUptimeMs: process.uptime() * 1000,
  })));
}

async function startServer(): Promise<void> {
  const warmTimer = startMonotonicTimer();
  try {
    await warmBrowser();
    console.log(JSON.stringify({
      event: 'capture_browser_warmed',
      timestamp: new Date().toISOString(),
      duration_ms: Math.round(warmTimer.elapsedMs()),
      process_uptime_ms: Math.round(process.uptime() * 1000),
    }));
  } catch (error) {
    console.error(JSON.stringify({
      event: 'capture_browser_warm_failed',
      message: error instanceof Error ? error.message : String(error),
    }));
  }

  server.listen(PORT, () => {
    console.log(`capture-service listening on :${PORT}`);
  });
}

void startServer();
