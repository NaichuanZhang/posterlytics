# Posterlytics capture-service

A headless-Chromium microservice that, for a given URL, returns **programmatic
design tokens** (read from viewport-visible `getComputedStyle` samples), a
weighted pixel palette and theme classification, plus a compressed
multi-viewport **style board**. Used by the `analyze` edge function to ground
poster agents in the site's actual rendered design.

It is **not** part of the Vite app or the Deno edge functions — it's a separate
Node container deployed as an InsForge compute (Fly) service, because Deno
Subhosting cannot run a browser.

## HTTP contract

| Route | Method | Auth | Body | Response |
|---|---|---|---|---|
| `/healthz` | GET | — | — | `200 ok` |
| `/capture` | POST | `Authorization: Bearer $CAPTURE_TOKEN` | `{ "url": "https://...", "color_scheme": "light" \| "dark" }` | `{ tokens, screenshot_b64, final_url, title }` |

- The container holds **no InsForge credentials** by design. It returns the
  board as base64; `analyze` uploads it to Storage. `screenshot_b64` is retained
  as the wire key so the capture service can deploy before the edge functions.
- `color_scheme` is optional and defaults to `light` for older callers.
- The top frame is captured first, followed when budget allows by frames at
  `0.8x` and `1.6x` viewport height, clamped and deduplicated near the page end.
- Optional sampling stops at a 10-second soft budget. A usable constrained
  capture returns normalized DOM tokens with the raw first JPEG as partial
  evidence, skipping Sharp merge and pixel extraction. Complete captures merge
  their frames into one compact JPEG with a weighted pixel palette.
- DOM style weights use only each element's visible intersection with the
  current frame. `tokens.colors.visualPalette` records pixel usage proportions;
  `tokens.colors.theme` is `light`, `dark`, or `mixed`.
- The service accepts traffic first and warms Chromium in the background, so a
  cold machine answers within its own deadline instead of stalling the caller.
  Page capture has a 13-second hard deadline below the edge caller's 15-second
  timeout and rejects private/reserved network targets, including redirects and
  subresources. The 10-second sampling budget starts once a browser exists, so a
  launch is never charged to page work.
- Failures return a non-2xx response with
  `{ "error": { "code", "message", "retryable" } }`. `analyze` records the
  structured error and falls back to HTML color extraction.

The browser readings are frequency-aggregated into compact raw tokens inside the
container, then normalized into the bounded `tokens` response before crossing
the service boundary.

## Layers (separation of concerns)

- `src/capture.ts` — Playwright orchestration and budget-aware frame capture.
- `src/captureEvidence.ts` — browser-free Sharp board/pixel finalization and the
  raw one-frame partial-evidence path.
- `src/captureLifecycle.ts` — pure timing, outcome classification, and
  privacy-safe capture log construction.
- `src/frameSampling.ts` — pure frame positioning and visible-area geometry.
- `src/pixelPalette.ts` — pure pixel clustering and theme classification.
- `src/captureOptions.ts` — request color-scheme validation.
- `src/buildRawTokens.ts` — **pure** aggregation of element samples → `RawTokens`
  (a unit-tested seam; no DOM, no I/O).
- `src/normalizeDesignTokens.ts` — **pure** normalization into the public response.
- `src/networkSafety.ts` — URL/DNS validation for SSRF protection.
- `src/server.ts` — Node `http` server, bearer auth, deadline, structured errors.

## Env

| Var | Required | Description |
|---|---|---|
| `CAPTURE_TOKEN` | yes | Shared bearer secret; the server fails closed if unset. |
| `PORT` | no | Default `8080`. |

## Develop / test

```bash
npm install
npm run build          # tsc -> dist/
npm test               # node --test on aggregation, normalization, and URL safety
npm run dev            # tsx src/server.ts (needs local Chromium: npx playwright install chromium)
```

## Deploy (InsForge compute / Fly)

Requires the latest CLI (the homebrew-pinned `0.1.40` has no `compute`):

```bash
npx -y @insforge/cli@latest compute deploy ./capture-service \
  --name posterlytics-capture --port 8080 \
  --env '{"CAPTURE_TOKEN":"<random-secret>"}'
npx -y @insforge/cli@latest compute list   # note the https://...fly.dev endpoint
```

Then register the function-runtime secrets the `analyze` function reads:

```bash
npx @insforge/cli secrets add CAPTURE_SERVICE_URL https://posterlytics-capture-<proj>.fly.dev
npx @insforge/cli secrets add CAPTURE_TOKEN        <same-random-secret>
```

Smoke test:

```bash
curl -s -X POST https://posterlytics-capture-<proj>.fly.dev/capture \
  -H "Authorization: Bearer <random-secret>" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://stripe.com","color_scheme":"dark"}' | head -c 400
```
