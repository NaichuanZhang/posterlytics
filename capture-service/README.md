# Posterlytics capture-service

A headless-Chromium microservice that, for a given URL, returns **programmatic
design tokens** (read from real `getComputedStyle`) plus an above-the-fold
**screenshot**. Used by the `analyze` edge function to ground style extraction
and the landing-page agent in the site's actual rendered design.

It is **not** part of the Vite app or the Deno edge functions — it's a separate
Node container deployed as an InsForge compute (Fly) service, because Deno
Subhosting cannot run a browser.

## HTTP contract

| Route | Method | Auth | Body | Response |
|---|---|---|---|---|
| `/healthz` | GET | — | — | `200 ok` |
| `/capture` | POST | `Authorization: Bearer $CAPTURE_TOKEN` | `{ "url": "https://..." }` | `{ raw_tokens, screenshot_b64, final_url, title, error? }` |

- The container holds **no InsForge credentials** by design. It returns the
  screenshot as base64; `analyze` (which has `API_KEY`) uploads it to Storage.
- The screenshot is a viewport-clipped JPEG (q70, 1280×800) to stay under the
  AI proxy's ~750KB vision data-URL ceiling.
- Failures degrade gracefully: a capture error returns `200` with empty
  `raw_tokens` and `screenshot_b64: null` so `analyze` falls back to its legacy
  regex extraction.

`raw_tokens` is frequency-aggregated and compact; the edge side
(`normalizeDesignTokens`) turns it into the final bounded `DesignTokens`.

## Layers (separation of concerns)

- `src/capture.ts` — Playwright orchestration + the in-browser DOM collector.
- `src/buildRawTokens.ts` — **pure** aggregation of element samples → `RawTokens`
  (the unit-tested seam; no DOM, no I/O).
- `src/server.ts` — Node `http` server, bearer auth, graceful degradation.

## Env

| Var | Required | Description |
|---|---|---|
| `CAPTURE_TOKEN` | yes | Shared bearer secret; the server fails closed if unset. |
| `PORT` | no | Default `8080`. |

## Develop / test

```bash
npm install
npm run build          # tsc -> dist/
npm test               # node --test on the pure aggregation layer
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
  -d '{"url":"https://stripe.com"}' | head -c 400
```
