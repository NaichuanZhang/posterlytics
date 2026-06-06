# Posterlytics

Turn a product's own website into an on-brand **advertising poster**, mint a
**unique tracked QR/link per placement** (bulletin board, LinkedIn, IG story…),
and see **which placement actually drove conversions — not just clicks**.

Per-placement attribution is the moat: same product, N unique codes, every scan
and conversion logged, so the dashboard answers "the bulletin board out-pulled
LinkedIn" — which a generic shortener can't.

## How it works

1. **Sign in** (email + password, no verification).
2. **New campaign** — paste your product URL + GTM details (name, tagline, CTA,
   destination).
3. **Poster Agent** (`analyze` function) scrapes the site, pulls **real brand
   assets** (logo, og:image, product images → re-hosted in Storage), and uses
   gpt-4o to produce:
   - `poster_copy` — a scannable poster (hook + one-liner + top-3 features + CTA)
   - `landing_content` — the full story (features, how-it-works, why-use-it)
   - `style_profile` — the brand's palette / fonts / tone
   If no usable imagery is found, the `hero` function paints an AI fallback.
4. **Poster** — hybrid: real brand visual (or AI hero) + a crisp HTML/CSS overlay
   with the QR. Exportable to PNG per placement (`html-to-image`).
5. **Placements** — each mints a unique short code → unique QR/link.
6. **Publish** — activates the hosted landing page.
7. **Scan** → `view` logs the scan (device from UA, first-party visitor cookie,
   browser-side geo beacon) and serves the rich landing → CTA hits `convert`,
   which logs a conversion and 302s to the real product page.
8. **Dashboard** — per-placement scans / unique visitors / conversions / rate.

## Architecture

- **Frontend**: Vite + React + TypeScript SPA (`src/`). Auth-gated dashboard.
- **Backend**: InsForge (Postgres + RLS, Storage, Auth, edge functions).
- **Edge functions** (`functions/`, Deno): `view`, `convert`, `scan-geo`,
  `analyze`, `hero`. Source imports `_shared.ts`; `functions/build.mjs` inlines
  it into one deployable file per function (Subhosting uploads a single file).
- **AI**: InsForge AI proxy (`/api/ai/chat/completion`, `/api/ai/image/generation`)
  with the project key — no separate OpenRouter key needed.
- **Schema**: `db/*.sql` applied via `npx @insforge/cli db import`. Owner-only
  dashboard access; anon can read only published campaigns and write (not read)
  scans/conversions; uniqueness + stats via `SECURITY DEFINER` RPCs.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173  (.env.local has VITE_INSFORGE_URL / _ANON_KEY)
npm run build        # type-check + bundle
```

### Edge functions

```bash
node functions/build.mjs                 # build all → functions/dist/<slug>.ts
npx @insforge/cli functions deploy view --file ./functions/dist/view.ts
# repeat for convert, scan-geo, analyze, hero
```

### Database

```bash
npx @insforge/cli db import db/01_campaigns.sql   # in numeric order: 01→06
npx @insforge/cli db tables && npx @insforge/cli db policies
```

## Deploy

```bash
npm run build
npx @insforge/cli deployments env set VITE_INSFORGE_URL https://3f9q2998.us-east.insforge.app
npx @insforge/cli deployments env set VITE_INSFORGE_ANON_KEY <anon-key>
npx @insforge/cli deployments deploy .
```
