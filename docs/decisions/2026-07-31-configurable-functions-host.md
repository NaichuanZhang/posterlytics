# Configurable functions host: movable by config, but printed QR codes are permanent

## Backlog item

**Order-155** — *PRODUCTION OUTAGE: all 8 edge functions return `DEPLOYMENT_NOT_FOUND` — Deno
Deploy Classic sunset killed the serving layer, so every printed QR redirect (`/view`) is dead
and no poster can be generated.*

This ADR covers only the **SPA-side** half of that item. The backend migration
(`projects update-version`) restarts the production instance and is a maintainer action.

## Verified before implementing

- **The outage is real and total.** All eight functions (`view`, `analyze`, `designer`, `hero`,
  `generation-worker`, `capture-preview`, `reference-import`, `amazon-product-lookup`) return
  HTTP 404 with `DEPLOYMENT_NOT_FOUND` on `<appkey>.functions.insforge.app`. Edge traffic
  stopped at `2026-07-31T06:05:49Z`; the SPA and the Fly capture container are unaffected.
- **The replacement tier exists and is live but empty.** `<appkey>.function2.insforge.app`
  resolves via CloudFront and returns a *different* body — "The requested deployment was not
  found." with a Deno trace id — versus Classic's sunset text. Two distinct errors on two
  domains is what proves the v2 tier is serving and simply has nothing deployed to it.
- **Code upload still succeeds while nothing serves.** `functions deploy` prints
  `{"code":"projectSunset"}` / "updation failed", yet `functions code <slug>` returns the new
  source and `function-deploy.logs` says "Packaging complete". The deployed `painterRule` was
  md5-identical to the local bundle. So `functions code` is **not** deploy verification — it
  passes during a total outage. Only an HTTP probe of the endpoint distinguishes the two.
- **The host was a bare literal in one place**, `src/lib/insforge.ts`, with **no env override**.
  Grepping `src/ functions/ tests/ db/ migrations/ docs/` found that literal as the only
  hardcoded reference in the repo, so repointing the SPA required a code edit and a rebuild.

## Decisions

1. **`VITE_INSFORGE_FUNCTIONS_HOST` takes precedence, with the derived host unchanged as the
   default.** A provider domain change is now a configuration change. Existing deployments
   behave exactly as before until the override is set, so this is safe to ship *during* the
   outage and independently of the backend migration.
2. **The derivation moves into a pure `resolveFunctionsHost` module** rather than staying inline.
   It is the seam that makes the precedence testable without a browser or a Vite build — the
   inline literal could not express "ignore an unusable override" at all.
3. **An unusable override falls back; it is never concatenated.** Blank, whitespace, malformed,
   and non-HTTP(S) values (`javascript:`, `data:`, `file:`) resolve to the derived host. This is
   not theoretical hardening: `buildViewUrl` feeds this string straight into a **rendered QR
   code** (`AiPoster.tsx:309`, `PlacementsPage.tsx:212`) and into clipboard copies, so a
   surviving `javascript:` origin would be printed onto physical media.
4. **A missing or malformed API base still yields `''`.** Callers already treat an empty host as
   "functions unavailable" (`capturePreview.ts:52`, `amazonProductLookup.ts:61`); half-building
   `https://undefined.functions.insforge.app` would look valid and fail only at request time.

## Rejected

- **Hand-setting `FUNCTIONS_DOMAIN` on the backend and redeploying**, without first running
  `projects update-version`. The v2.2.0 backend still calls the Classic deploy API surface, so
  it would deploy to an endpoint Deno no longer serves regardless of the env var.
- **Deriving `function2` unconditionally.** That would hard-code the *next* domain as firmly as
  the last one, reintroducing the same defect one migration later. The point is that the host is
  not knowable from the repo.
- **Rewriting existing `placements` rows to the new host.** See the constraint below — it cannot
  work, and attempting it would rewrite owner data for no benefit.

## Known limitation (deliberate, and the reason this needs saying out loud)

**Moving the host does not repair QR codes already printed.** `buildViewUrl` bakes the absolute
host into the QR at mint time, so every poster already exported or printed encodes
`…functions.insforge.app` permanently. Restoring service on `function2` fixes *new* QRs, the
app's own calls, and copy-link — it does **not** revive codes in the wild unless the Classic
hostname is made to redirect, which is outside this repo.

The durable fix is for the QR to encode a **domain-agnostic** target the owner controls (a
first-party path that redirects), so a provider change can never again invalidate physical media.
That is a schema-and-routing change well beyond this outage's scope; recorded here so the next
host migration does not rediscover it the same way.
