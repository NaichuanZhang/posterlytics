// Startup ordering for the capture container.
//
// The service used to `await warmBrowser()` BEFORE calling listen(), so a cold
// machine accepted the TCP connection at the Fly proxy and then served nothing
// for the entire Chromium launch. The 13-second capture deadline is armed per
// request inside the handler, so it never ran during that window and the edge
// caller's 15-second abort fired first — the caller got an opaque timeout with
// no HTTP status instead of the structured, retryable 504 the ladder promises.
// Measured on the deployed container: GET /healthz, a route that only returns
// "ok", took 11.91s cold versus 0.17s warm.
//
// Listening first moves the launch inside the request's own deadline, so every
// caller gets a structured response. Warming still starts at boot and continues
// in the background; `getBrowser()` memoizes the launch, so a request arriving
// mid-warm awaits that same promise rather than starting a second Chromium.

export interface CaptureBootstrapDeps {
  /** Resolves once the HTTP server is accepting connections. */
  listen: () => Promise<void>;
  warmBrowser: () => Promise<void>;
  onWarmed: (durationMs: number) => void;
  onWarmFailed: (error: unknown) => void;
  now?: () => number;
}

/**
 * Brings the service up in the only order that keeps the timeout ladder honest:
 * accept traffic first, then warm. Never rejects — a warm-up failure is reported
 * and left to the per-request launch, because refusing to serve would turn a
 * recoverable cold start into an outage.
 */
export async function bootstrapCaptureService(
  deps: CaptureBootstrapDeps,
): Promise<void> {
  const now = deps.now ?? (() => performance.now());
  await deps.listen();

  const startedAt = now();
  try {
    await deps.warmBrowser();
    deps.onWarmed(Math.max(0, now() - startedAt));
  } catch (error) {
    deps.onWarmFailed(error);
  }
}
