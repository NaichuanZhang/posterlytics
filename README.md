# Posterlytics

Posterlytics turns a product website into an on-brand advertising poster. Each
placement gets its own tracked QR and link, so the dashboard shows visits and
unique visitors by channel.

Live app: **https://3f9q2998.insforge.site**

## Product flow

1. Sign in and create a product campaign.
2. Enter the product URL, campaign copy, destination, and optional generation
   context or reference images from files or public HTTPS URLs.
3. `analyze` captures a theme-matched, multi-frame style board and prepares
   source-grounded brand context and poster copy.
4. `designer` creates a structured layout for the campaign's selected format
   while preserving the source's visual treatment and density.
5. `hero` paints the poster through OpenRouter at the registered provider aspect
   using ordered visual references.
6. Add placements, publish, and export a PNG with each placement's QR.
7. A visit to the QR link is recorded and redirected to the destination URL.
8. Analytics reports visits, unique visitors, device, OS, and country.

New campaign creation is product-only. Existing event campaigns remain
renderable and can be regenerated.

## Architecture

- **App:** Vite, React, and TypeScript in `src/`.
- **Backend:** InsForge Postgres, RLS, Auth, Storage, edge functions, and
  frontend hosting.
- **Generation:** `analyze`, `designer`, and `hero` are authenticated Deno edge
  functions. `view` is the public tracked redirect.
- **AI:** Edge functions call OpenRouter directly with the server-only
  `OPENROUTER_API_KEY`.
- **Capture:** `capture-service/` is a Playwright + Sharp compute service that
  returns visible-DOM design tokens, a weighted pixel palette, theme
  classification, and a compressed three-frame style board. It enforces a
  12-second deadline and blocks private-network targets.
- **Data:** Owner-only campaign data and visits-only analytics are exposed
  through RLS and narrow `SECURITY DEFINER` RPCs.
- **Poster formats:** `src/lib/posterSize.ts` is shared by the SPA and bundled
  edge functions. Campaigns store the next target format; generations snapshot
  the format used for historical render and export.

## Develop

```bash
npm install
npm run dev
npm run lint
npm test
npm run build
```

Capture service:

```bash
cd capture-service
npm install
npm test
npm run build
```

Edge functions:

```bash
node functions/build.mjs
npx @insforge/cli functions deploy analyze --file functions/dist/analyze.ts
npx @insforge/cli functions deploy designer --file functions/dist/designer.ts
npx @insforge/cli functions deploy hero --file functions/dist/hero.ts
npx @insforge/cli functions deploy view --file functions/dist/view.ts
```

## Database

`db/schema.sql` is the current baseline for a fresh backend. Production changes
are applied through timestamped files in `migrations/`:

```bash
npx @insforge/cli db migrations list
npx @insforge/cli db migrations up --all
```

Do not apply the baseline to an existing project.

## Deploy

```bash
npm run build
npx @insforge/cli deployments env list
npx @insforge/cli deployments deploy .
```
