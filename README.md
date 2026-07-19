# Posterlytics

Posterlytics turns a product website into an on-brand advertising poster. Each
placement gets its own tracked QR and link, so the dashboard shows visits and
unique visitors by channel.

Live app: **https://3f9q2998.insforge.site**

## Product flow

1. Sign in, start a campaign, and choose Website product or Amazon listing.
2. For a website product, enter the website URL, campaign copy, destination,
   and optional generation context or reference images.
3. For an Amazon listing, enter a supported listing URL and supply listing copy
   plus product or brand images as the primary generation inputs.
4. `analyze` captures a theme-matched, multi-frame style board for websites, or
   uses seller-provided Amazon references without scraping the listing, and
   prepares source-grounded brand context and poster copy.
5. `designer` creates a structured layout for the campaign's selected format
   while preserving the source's visual treatment and density.
6. `hero` paints the poster through OpenRouter at the registered provider aspect
   using ordered visual references.
7. Add placements, publish, and export either a placement-specific QR poster or
   an artwork-only social cover.
8. A visit to the QR link is recorded and redirected to the destination URL.
9. Analytics reports visits, unique visitors, device, OS, and country.

New campaign creation exposes the website-product and Amazon-listing product
use cases. Existing event campaigns remain renderable and can be regenerated.

## Amazon seller reference mode

Amazon listing pages are not reliable automation sources: a raw request or
browser capture can return a CAPTCHA that looks like successful evidence.
Posterlytics therefore treats supported Amazon URLs as reference-only sources.

1. Use a URL on `amazon.com`, `www.amazon.com`, `a.co`, `amzn.to`,
   `amzn.asia`, or `amzn.eu` as the product source.
2. Add the relevant listing copy and up to five product or brand images in the
   promoted listing-input section, using files or public HTTPS URLs.
3. Use the listing URL, including any Amazon Attribution parameters, as the
   destination. Posterlytics preserves its existing query bytes and appends only
   missing placement UTM parameters.
4. Generate and export an existing off-Amazon poster format with its tracked QR.

This mode intentionally does not scrape the listing. Bare ASIN input, regional
Amazon storefronts, Sponsored Brands 1200x628, A+/lifestyle images, brand-store
banners, and Amazon policy validation are not supported yet.

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
  12-second deadline and blocks private-network targets. Classified Amazon
  sources bypass both this service and raw HTML acquisition.
- **Data:** Owner-only campaign data and visits-only analytics are exposed
  through RLS and narrow `SECURITY DEFINER` RPCs.
- **Poster formats:** `src/lib/posterSize.ts` is shared by the SPA and bundled
  edge functions. Campaigns store the next target format; generations snapshot
  the format used for historical render and export.
- **Use cases:** `src/lib/useCases.ts` defines creatable intent, input
  requirements, and allowed formats. Campaigns persist intent and generations
  snapshot it for server-side recipe selection.

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
