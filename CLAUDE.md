# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Posterlytics turns a product URL into an on-brand advertising poster, mints a **unique tracked QR/link per placement**, and reports visits and unique visitors by channel. New campaign creation is product-only; existing event campaigns remain compatible. Live app: https://3f9q2998.insforge.site

**Project management:** the [Posterlytics Notion hub](https://www.notion.so/alexhomebase/Posterlytics-38412ea3d4678044b95ae6a93cad0159) is the central PM page — the product roadmap (a Backlog / In-Progress / Done sprint board), status snapshot, and backlog all live there.

## Commands

```bash
npm run dev      # Vite dev server on http://localhost:5173
npm run build    # tsc -b (project refs) + vite build
npm run lint     # tsc --noEmit  (type-check only; there is no ESLint/Prettier config)
npm test         # node --test on tests/*.test.ts (pure src/lib + functions/_shared helpers)
```

There is **no ESLint/Prettier**. `lint` is a type-check. `npm test` runs Node's built-in test runner over pure helpers in `src/lib/` and `functions/_shared.ts`. The capture service has its own Node tests for aggregation, normalization, popup handling, and URL safety. Run one app test with `node --test --import ./tests/register.mjs tests/<name>.test.ts`; one capture-service test with `cd capture-service && node --import tsx --test test/<name>.test.ts`. There is no component test runner; verify UI changes in the running app.

### Frontend deploy (InsForge hosting)

```bash
npm run build && npx @insforge/cli deployments deploy .
```

`vercel.json` supplies the SPA fallback rewrite; `.vercelignore` keeps backend-only directories (functions, migrations, capture-service, docs) out of the upload.

### Edge functions (Deno Subhosting)

```bash
node functions/build.mjs                 # build all → functions/dist/<slug>.ts
node functions/build.mjs view hero       # build a subset
npx @insforge/cli functions deploy view --file ./functions/dist/view.ts   # deploy one
```

The CLI may report a **deploy timeout** while the deploy actually succeeded — confirm with `functions list` (check the slug is `active`) rather than trusting the timeout.

### Capture service (`capture-service/`, InsForge compute / Fly)

A standalone Node + Playwright + Sharp container — Deno edge functions can't run a browser. It exposes `POST /capture` (bearer-auth) with `{ url, color_scheme? }` and returns visible-DOM design tokens plus a compressed three-frame style board in the backward-compatible `screenshot_b64` field. It enforces a **12-second capture deadline** (`server.ts`) and **blocks private-network targets** (`networkSafety.ts`) — keep both when touching capture code. Requires the **latest** CLI (`compute` is absent from older pinned versions like the homebrew `0.1.40`):

```bash
npx -y @insforge/cli@latest compute deploy ./capture-service --name posterlytics-capture --port 8080 \
  --env '{"CAPTURE_TOKEN":"<secret>"}'
npx @insforge/cli secrets add CAPTURE_SERVICE_URL https://posterlytics-capture-<proj>.fly.dev
npx @insforge/cli secrets add CAPTURE_TOKEN        <same-secret>
cd capture-service && npm test     # capture aggregation, normalization, and URL-safety tests
```

`analyze` calls it via `captureSite()` and **degrades gracefully** when `CAPTURE_SERVICE_URL`/`CAPTURE_TOKEN` are unset (falls back to regex color mining). See `capture-service/README.md`.

### Database

```bash
npx @insforge/cli db migrations list
npx @insforge/cli db migrations up --all
```

`db/schema.sql` is the current fresh-project baseline and must not be applied to an existing backend. Timestamped files in `migrations/` are production history and are append-only once applied.

## Architecture

Two cooperating halves: a **Vite + React + TS SPA** (`src/`) and **Deno edge functions** (`functions/`), both talking to an **InsForge** backend (Postgres + RLS, Storage, Auth, and hosting). `AGENTS.md` lists the installed InsForge skills (`insforge`, `insforge-cli`, `insforge-debug`) — use them for SDK/CLI specifics instead of guessing the API.

### Frontend (`src/`)
- **Routing** (`App.tsx`): `/` redirects logged-out visitors to `/signin` and shows campaigns to signed-in users. Dashboard routes are wrapped in `RequireAuth`; `vercel.json` provides the SPA fallback.
- **InsForge client** (`src/lib/insforge.ts`): one shared `insforge` client; `FUNCTIONS_HOST` is derived from `VITE_INSFORGE_URL` (`<appkey>.functions.insforge.app`) — that's where the public `view` function lives, a different host from the API base.
- **Data access** lives in hooks (`src/hooks/use*.ts`), not a repository layer. `src/lib/types.ts` mirrors the DB schema and is the source of truth for domain shapes.
- **Campaign creation**: the wizard creates products only. The `scenario` and event types remain so historical event rows can still render and regenerate.
- **References**: `GenerationReferences` accepts context plus up to five JPEG/PNG/WebP files or public HTTPS image URLs. URLs preview from their source, then `reference-import` copies them into Storage before generation. Storage keys and public URLs are persisted in `campaigns.reference_images`.
- **Posters**: every poster is the AI-painted `AiPoster`, fixed at 1080x1620 in `src/lib/posterSize.ts`. A real scannable `QrCode` is composited in a branded bottom band.
- **Export**: `PosterExportButton` renders offscreen at native size and captures with `html-to-image` at pixel ratio 2. It converts the cross-origin hero to a data URL and awaits image/font readiness to avoid a tainted or blank canvas.

### Edge functions (`functions/`)
Each `.ts` (except `_shared.ts`, `build.mjs`) is one deployable function. **Subhosting uploads a single file and cannot resolve sibling imports**, so `build.mjs` inlines `_shared.ts` into each (stripping `export`/the import line) → `functions/dist/<slug>.ts`. **Always edit `functions/<slug>.ts` and rebuild — never edit `functions/dist/`.**

- `analyze` — scrapes product copy/assets, captures the creator's light/dark page variant, sends the style board as primary multimodal evidence, and persists richer optional `style_profile`/`design_tokens` JSON. Raw HTML color mining is capture-failure-only. A new board is persisted before the campaign pointer changes; the prior object is removed only after that update succeeds. Historical event rows use the retained bounded Luma parser. Auth-scoped.
- `designer` — designs a source-grounded, 3-7-zone poster layout (`poster_layout`) from the style board, weighted palette, source density, `poster_content`, and `style_profile`; `hero` then paints from it. Runs for every product campaign (the only mode). Auth-scoped.
- `hero` — paints the AI illustration poster (2:3): product references are ordered style board, user images, logo, then product assets, capped at six and labeled by purpose. Products compile `poster_layout` via the pure `compileLayoutPrompt`; events retain their bespoke prompt/reference path. Persists `hero_image_url`/`hero_image_key`. Auth-scoped.
- `reference-import` — validates campaign ownership and securely copies public HTTPS JPEG/PNG/WebP references into the `assets` bucket. Rejects private/reserved targets on every redirect hop and enforces redirect, timeout, and byte limits. Auth-scoped.
- `view` — the public QR target. It logs one visit through `log_visit`, then redirects to `destination_url`. `link_status` distinguishes missing and unpublished codes without exposing draft data.

Two client factories in `_shared.ts`: `createAnonClient()` for `view` and `createUserClient(req)` for authenticated generation. Shared helpers include OpenRouter calls, capture, image upload conversion, poster-layout normalization, bounded legacy-event parsing, and structured `logPipelineEvent` JSON logs. **No raw IP is stored**; `visitorHash` hashes a first-party cookie identifier with a secret salt.

### Programmatic style vs agentic poster (separation)
**Programmatic, deterministic, testable**: the capture-service samples visible computed styles across three frames, merges a style board, clusters its weighted pixels, and normalizes `RawTokens` into `DesignTokens`. No LLM authors color/font extraction. **Agentic, LLM**: `analyze` describes observed visual treatment and authors copy, `designer` adapts that evidence into a poster layout, and `hero` paints it. The seams are pure normalizers and prompt compilers.

### AI
`aiChat` and `aiImage` call OpenRouter directly from edge functions. `OPENROUTER_API_KEY` is server-only; model defaults can be overridden with `OPENROUTER_CHAT_MODEL` and `OPENROUTER_IMAGE_MODEL`. Generated images are copied into InsForge Storage before their URLs are persisted.

### Security model (`db/schema.sql`)
Campaigns, placements, and visits are owner-only through RLS. Anon has no table access; it can only execute `log_visit` and `link_status`. Authenticated analytics use owner-checking `placement_stats` and `campaign_breakdowns`. Reference and generated assets are public-read but owner-write. Placement codes use base62 over cryptographic randomness.

## Conventions
- **Immutable updates only** — never mutate objects in place; spread to copy.
- Many small, focused files; keep `src/lib/types.ts` in sync when the schema changes.
- Applied timestamped migrations are append-only. Keep `db/schema.sql` aligned with the final schema for fresh projects.
- Secrets live in `.env.local` (gitignored). Do not hardcode keys.
