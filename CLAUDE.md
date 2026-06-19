# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Posterlytics turns a product URL into an on-brand advertising poster, mints a **unique tracked QR/link per placement**, and reports **which placement drove conversions** (not just clicks). Per-placement attribution is the core value: same product → N unique codes → every scan/conversion logged. See `README.md` for the product walkthrough and screenshots.

## Commands

```bash
npm run dev      # Vite dev server on http://localhost:5173
npm run build    # tsc -b (project refs) + vite build
npm run lint     # tsc --noEmit  (type-check only; there is no ESLint/Prettier config)
npm test         # node --test on tests/*.test.ts (pure src/lib + functions/_shared helpers)
```

There is **no ESLint/Prettier**. `lint` is a type-check. `npm test` runs Node's built-in test runner over `tests/` — only **pure functions** are covered (`src/lib/{colorUtils,designTokens,landingHtml}`, plus the landing sanitize/inject helpers in `functions/_shared.ts`). `tests/register.mjs` is a loader hook that lets node import the Vite-style extensionless TS source and stub Deno `npm:` specifiers. There is no component/integration runner; UI changes are verified by running the app.

### Edge functions (Deno Subhosting)

```bash
node functions/build.mjs                 # build all → functions/dist/<slug>.ts
node functions/build.mjs view hero       # build a subset
npx @insforge/cli functions deploy view --file ./functions/dist/view.ts   # deploy one
```

The CLI may report a **deploy timeout** while the deploy actually succeeded — confirm with `functions list` (check the slug is `active`) rather than trusting the timeout.

### Capture service (`capture-service/`, InsForge compute / Fly)

A standalone Node + Playwright container — Deno edge functions can't run a browser. It exposes `POST /capture` (bearer-auth) → programmatic design tokens + screenshot. Requires the **latest** CLI (`compute` is absent from older pinned versions like the homebrew `0.1.40`):

```bash
npx -y @insforge/cli@latest compute deploy ./capture-service --name posterlytics-capture --port 8080 \
  --env '{"CAPTURE_TOKEN":"<secret>"}'
npx @insforge/cli secrets add CAPTURE_SERVICE_URL https://posterlytics-capture-<proj>.fly.dev
npx @insforge/cli secrets add CAPTURE_TOKEN        <same-secret>
cd capture-service && npm test     # pure token-aggregation tests
```

`analyze` calls it via `captureSite()` and **degrades gracefully** when `CAPTURE_SERVICE_URL`/`CAPTURE_TOKEN` are unset (falls back to regex color mining). See `capture-service/README.md`.

### Database

```bash
npx @insforge/cli db import db/01_campaigns.sql   # apply each db/NN_*.sql in numeric order (01 … 13)
npx @insforge/cli db tables && npx @insforge/cli db policies
```

Migrations are append-only and **redefine** RPCs/columns in later files (e.g. `log_scan` is redefined in `06` and `11`; `is_unique`/`visitor_hash`/`updated_at` columns are *dropped* in `11`). Read the highest-numbered file that touches a symbol for its current shape, not the first. `13` adds `design_tokens`, `screenshot_url/key`, `landing_html`, `landing_status`.

## Architecture

Two cooperating halves: a **Vite + React + TS SPA** (`src/`) and **Deno edge functions** (`functions/`), both talking to an **InsForge** backend (Postgres + RLS, Storage, Auth, AI proxy).

### Frontend (`src/`)
- **Routing** (`App.tsx`): `/` shows the marketing `LandingPage` to logged-out visitors and the campaigns dashboard to signed-in users (`HomeRoute`). Dashboard routes are wrapped in `RequireAuth`. `LandingPage` is also the public hosted poster page served by the SPA fallback (`vercel.json` rewrites all paths to `index.html`).
- **InsForge client** (`src/lib/insforge.ts`): one shared `insforge` client; `FUNCTIONS_HOST` is derived from `VITE_INSFORGE_URL` (`<appkey>.functions.insforge.app`) — that's where public `view`/`convert` live, a different host from the API base.
- **Data access** lives in hooks (`src/hooks/use*.ts`), not a repository layer. `src/lib/types.ts` mirrors the DB schema and is the source of truth for domain shapes.
- **Posters**: `Poster.tsx` dispatches on `poster_mode`/`poster_style` to one of `components/posters/` — `CozyPoster` (cozy_scrapbook), `SaasPoster` (saas_glassmorphism), or `AiPoster` (`poster_mode === 'image'`). All variants render at native 1080×1620 (2:3) and embed a real scannable `QrCode` (`buildViewUrl(code)`, `src/lib/landingUrl.ts`). `AiPoster` composites the QR onto `campaign.qr_zone` (the vision-detected calm box from `hero`); when that's null/invalid it falls back to per-style `ANCHORS`.
- **Export**: `PosterExportButton` renders the chosen variant offscreen at native size and captures it with `html-to-image` at pixelRatio 2. For AI mode it first fetches the cross-origin hero into a same-origin data URL and awaits `img.decode()` + `document.fonts.ready` to avoid a tainted/blank canvas — `index.html` preloads the template fonts for the same reason. `PosterEditorPage` and `PlacementsPage` both export **per selected placement** so each PNG carries that placement's unique QR.
- **Landing preview**: `LandingPreview.tsx` shows `campaign.landing_html` beside the poster in `PosterEditorPage` (side-by-side). It renders the **inert** form (`inertLandingHtml` in `src/lib/landingHtml.ts` — CTA → `#`, beacon stripped) in a `sandbox=""` `<iframe srcDoc>` scaled with the same outer-footprint / inner-native `transform:scale` idiom as `Poster.tsx`, so previewing never logs a scan.
- **Color/token libs**: `src/lib/colorUtils.ts` is the single source of the saturation/luminance "vividness" heuristic (previously triplicated; `posterColors.ts` imports it). `src/lib/designTokens.ts` (`normalizeDesignTokens`) turns the capture-service `RawTokens` into the bounded `DesignTokens`. Both are pure and unit-tested.

### Edge functions (`functions/`)
Each `.ts` (except `_shared.ts`, `build.mjs`) is one deployable function. **Subhosting uploads a single file and cannot resolve sibling imports**, so `build.mjs` inlines `_shared.ts` into each (stripping `export`/the import line) → `functions/dist/<slug>.ts`. **Always edit `functions/<slug>.ts` and rebuild — never edit `functions/dist/`.**

- `analyze` — Poster Agent: scrapes the site, extracts/re-hosts real brand assets to Storage, **calls the capture-service (`captureSite`) for programmatic `design_tokens` + a screenshot** (re-hosted to Storage as `screenshot_url`), mines the CSS palette as a fallback seed, and (honoring an optional forced `posterStyle`) calls the AI chat proxy to write back `poster_style`, `poster_spec`, `brand_essence`, `landing_content`, and `style_profile`. The captured computed palette/fonts **outrank** the model's guesses in `normalize()`. Auth-scoped.
- `hero` — paints the AI illustration poster (2:3) from `poster_spec`/`brand_essence`, dispatching the prompt on `poster_style`. Then runs a **vision pass (`detectQrZone`)** to find the calm region for the QR and persists `hero_image_url`/`hero_image_key`/`qr_zone`. Auth-scoped.
- `landing` — **Landing-page agent**: plan → draft full HTML → **vision self-critique** vs the captured screenshot → refine (≤2 rounds), then `sanitizeLandingHtml` (strips all model JS/handlers, guarantees the `{{CTA_HREF}}`/`{{SCAN_BEACON}}` placeholders) and persists `landing_html` + `landing_status`. The model authors design/copy; tracking is injected later. Auth-scoped.
- `view` — logs a scan (UA→device via `parseUA`, first-party `plv` visitor cookie, browser geo beacon) and serves the landing. If `landing_html` is present it serves that via **`injectLandingRuntime`** (replaces the placeholders with the per-request tracked `/convert?code=` CTA + geo beacon); otherwise it falls back to the legacy `landingHtml()` template. Anon.
- `convert` — logs a conversion, then 302s to the real product URL. Anon.
- `scan-geo` — receives the browser-side geo beacon and fills geo on the just-created scan via `set_scan_geo`. Anon.

Two client factories in `_shared.ts`: `createAnonClient()` for public functions (sees only published campaigns + anon RPCs) and `createUserClient(req)` which forwards the caller's bearer token so owner RLS applies. Other shared helpers: `parseUA`, `visitorHash`, `readCookie`, `aiChat`, `aiImage`, `detectQrZone`, `extractJson`, `dataUrlToBlob`, `jsonResponse`, `env`, `captureSite`, `normalizeDesignTokens`, `sanitizeLandingHtml`, `injectLandingRuntime`. **No raw IP is ever stored** — `visitorHash(salt, visitorId)` is SHA-256 of a salted first-party cookie.

**Generated-landing tracking integrity**: the agent's HTML is stored with placeholders and is *inert* on its own. The tracked CTA href and the geo-beacon script are **injected by `view.ts` per request** — the model can never break or forge tracking, and `sanitizeLandingHtml` guarantees no model-authored script ever runs. These pure helpers live in `_shared.ts` (canonical) and are mirrored read-only in `src/lib/landingHtml.ts` for the preview; both are unit-tested in `tests/landingHtml.test.ts`.

### Programmatic style vs agentic landing (separation)
**Programmatic, deterministic, testable**: the capture-service reads real computed styles → `RawTokens`; `normalizeDesignTokens` → `DesignTokens`; `analyze` derives `style_profile` from them. No LLM touches color/font extraction. **Agentic, LLM**: the `landing` function authors the landing HTML with vision self-critique. The seam between them is always a pure function (normalize / sanitize / inject).

### AI
Always via the **InsForge AI proxy** (`/api/ai/chat/completion`, `/api/ai/image/generation`) using the project key — no separate OpenRouter key. Helpers `aiChat`/`aiImage` in `_shared.ts`; defaults are `openai/gpt-4o` (chat + vision — used by `detectQrZone` and the `landing` critique loop) and `google/gemini-2.5-flash-image` (image), overridable via `OPENROUTER_CHAT_MODEL` / `OPENROUTER_IMAGE_MODEL` env. Vision images are passed **by URL** (the proxy data-URL ceiling is ~750KB). Models that wrap JSON in prose/fences are handled by `extractJson`.

### Security model (`db/*.sql`)
Owner-only dashboard access. Anon can **read only published campaigns/placements** and can **write but not read** scans/conversions. All writes and aggregate stats run through `SECURITY DEFINER` RPCs: anon-granted `log_scan`, `log_conversion`, `set_scan_geo`, `link_status` (returns only `missing`/`unpublished`/`published`, never leaking draft content); owner-granted `placement_stats` and `campaign_breakdowns` (device/OS/country aggregation). Placement codes are base62 over crypto randomness (`mintCode` in `src/lib/codes.ts`).

## Conventions
- **Immutable updates only** — never mutate objects in place; spread to copy.
- Many small, focused files; keep `src/lib/types.ts` in sync when the schema changes.
- DB migrations are append-only numbered files (`db/NN_*.sql`) applied in order.
- Secrets live in `.env.local` (gitignored). Do not hardcode keys.
