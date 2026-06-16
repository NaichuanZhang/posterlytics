# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Posterlytics turns a product URL into an on-brand advertising poster, mints a **unique tracked QR/link per placement**, and reports **which placement drove conversions** (not just clicks). Per-placement attribution is the core value: same product → N unique codes → every scan/conversion logged. See `README.md` for the product walkthrough and screenshots.

## Commands

```bash
npm run dev      # Vite dev server on http://localhost:5173
npm run build    # tsc -b (project refs) + vite build
npm run lint     # tsc --noEmit  (type-check only; there is no ESLint/Prettier config)
```

There is **no test suite** — no test runner is configured. `lint` is a type-check, not a linter.

### Edge functions (Deno Subhosting)

```bash
node functions/build.mjs                 # build all → functions/dist/<slug>.ts
node functions/build.mjs view hero       # build a subset
npx @insforge/cli functions deploy view --file ./functions/dist/view.ts   # deploy one
```

### Database

```bash
npx @insforge/cli db import db/01_campaigns.sql   # apply each db/NN_*.sql in numeric order
npx @insforge/cli db tables && npx @insforge/cli db policies
```

## Architecture

Two cooperating halves: a **Vite + React + TS SPA** (`src/`) and **Deno edge functions** (`functions/`), both talking to an **InsForge** backend (Postgres + RLS, Storage, Auth, AI proxy).

### Frontend (`src/`)
- **Routing** (`App.tsx`): `/` shows the marketing `LandingPage` to logged-out visitors and the campaigns dashboard to signed-in users (`HomeRoute`). Dashboard routes are wrapped in `RequireAuth`. `LandingPage` is also the public hosted poster page served by the SPA fallback (`vercel.json` rewrites all paths to `index.html`).
- **InsForge client** (`src/lib/insforge.ts`): one shared `insforge` client; `FUNCTIONS_HOST` is derived from `VITE_INSFORGE_URL` (`<appkey>.functions.insforge.app`) — that's where public `view`/`convert` live, a different host from the API base.
- **Data access** lives in hooks (`src/hooks/use*.ts`), not a repository layer. `src/lib/types.ts` mirrors the DB schema and is the source of truth for domain shapes.
- **Posters**: `Poster.tsx` dispatches on `poster_mode`/`poster_style` to one of `components/posters/` — `CozyPoster` (cozy_scrapbook), `SaasPoster` (saas_glassmorphism), or `AiPoster` (AI image with the real QR composited onto a reserved zone). Export to PNG via `PosterExportButton` + `html-to-image`.

### Edge functions (`functions/`)
Each `.ts` (except `_shared.ts`, `build.mjs`) is one deployable function. **Subhosting uploads a single file and cannot resolve sibling imports**, so `build.mjs` inlines `_shared.ts` into each (stripping `export`/the import line) → `functions/dist/<slug>.ts`. **Always edit `functions/<slug>.ts` and rebuild — never edit `functions/dist/`.**

- `analyze` — Poster Agent: scrapes the site, mines the real CSS palette, re-hosts assets to Storage, calls the AI chat proxy to produce `poster_spec`/`landing_content`/`style_profile`. Auth-scoped.
- `hero` — paints the AI illustration poster. Auth-scoped.
- `view` — logs a scan (UA→device, first-party visitor cookie, geo beacon) and serves the landing. Anon.
- `convert` — logs a conversion, then 302s to the real product URL. Anon.
- `scan-geo` — browser-side geo beacon endpoint. Anon.

Two client factories in `_shared.ts`: `createAnonClient()` for public functions (sees only published campaigns + anon RPCs) and `createUserClient(req)` which forwards the caller's bearer token so owner RLS applies. **No raw IP is ever stored** — `visitorHash(salt, visitorId)` is SHA-256 of a salted first-party cookie.

### AI
Always via the **InsForge AI proxy** (`/api/ai/chat/completion`, `/api/ai/image/generation`) using the project key — no separate OpenRouter key. Helpers `aiChat`/`aiImage` in `_shared.ts`; models overridable via `OPENROUTER_CHAT_MODEL` / `OPENROUTER_IMAGE_MODEL` env. Models that wrap JSON in prose/fences are handled by `extractJson`.

### Security model (`db/*.sql`)
Owner-only dashboard access. Anon can **read only published campaigns/placements** and can **write but not read** scans/conversions. Uniqueness checks and aggregate stats run through `SECURITY DEFINER` RPCs (`log_scan`, `log_conversion`, `placement_stats`, `set_scan_geo`). Placement codes are base62 over crypto randomness (`src/lib/codes.ts`).

## Conventions
- **Immutable updates only** — never mutate objects in place; spread to copy.
- Many small, focused files; keep `src/lib/types.ts` in sync when the schema changes.
- DB migrations are append-only numbered files (`db/NN_*.sql`) applied in order.
- Secrets live in `.env.local` (gitignored). Do not hardcode keys.
