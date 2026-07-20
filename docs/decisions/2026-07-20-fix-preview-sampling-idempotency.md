# Make preview edge sampling idempotent

## Root cause

Cycle 16 attached bottom-edge sampling directly to the hero image's `load`
event. Every event synchronously allocated and read the full intrinsic-width
strip, then stored a fresh `ImageRenderState` object even when the source,
sampled color, and status were unchanged. An initial load followed by eight
synthetic duplicate loads reproduced nine `600 x 27` `getImageData` calls; a
late error produced a tenth state update and replaced the sampled footer with
the fallback. The intrinsic-resolution strip work therefore grew linearly
without a source-level bound.

The preview path does not create that event stream by itself. `Poster` does not
pass `onRenderReady`, and the hero `src` and React key stay stable across
`PosterCanvas` resize updates. A parent resize alone does not reload the image.
The blank report does not identify the production event amplifier, but
duplicate load/error delivery demonstrably amplified into repeated
intrinsic-resolution strip work and visible sampled/fallback changes before
this fix.

## Decision

1. `AiPoster` keeps a ref for the settled image source and claims the source
   before sampling or applying the error fallback. Further load/error events
   for that source are ignored.
2. A layout effect clears the claim only when the resolved image source
   changes. A new hero therefore gets one independent sampling attempt.
3. The `setImageRender` functional update compares `imageSrc`, `sampledColor`,
   and `status`, returning the existing state object when all three match.
4. `PosterExportButton` memoizes render readiness resolution and exposes one
   stable callback for each export attempt, so parent updates cannot retrigger
   the clone's readiness effect through callback identity alone.
5. Sampling arithmetic, fallback bytes, footer styling, QR geometry, and the
   independent preview/export sampling contract remain unchanged.

## CORS finding

`crossOrigin="anonymous"` was introduced in commit `dd942d15`, before cycle 16;
commit `83c8093` added the sampler and event handlers but did not add the CORS
attribute. It is therefore not a cycle-16 regression. A missing
`Access-Control-Allow-Origin` response would still be a separate hard image
load failure, not merely a tainted-canvas fallback.

Live InsForge headers could not be verified in the implementation sandbox:
outbound DNS is disabled, and `@insforge/cli` is not installed locally. The
orchestrator must request a current persisted hero URL with the deployed
site's `Origin` header and confirm `Access-Control-Allow-Origin` permits that
origin (or `*`). Do not infer CORS health from the canvas fallback.

```bash
curl -sS -D - -o /dev/null \
  -H 'Origin: https://3f9q2998.insforge.site' \
  "$HERO_URL"
```

## Regression guard

`assetReviewUiSmoke.mjs` wraps only the edge fixture's exact `600 x 27`
`getImageData` call. It waits for the sampled preview, dispatches eight
duplicate loads and a late error, performs a viewport resize, and requires the
count to remain one with the sampled footer intact. Export must add exactly one
clone sample and retain exact preview/export footer-pixel equality. The
bandless fixture must perform zero samples.

The real event handlers measured `9` samples and `10` state updates before the
fix, then `1` sample and `1` state update after it for the same event sequence.
Existing `posterEdgeColor` unit tests continue to pin strip rounding,
quantization, tie-breaking, contrast thresholds, and fallback-independent
color arithmetic.
