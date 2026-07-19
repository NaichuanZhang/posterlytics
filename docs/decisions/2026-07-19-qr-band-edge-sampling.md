# QR-band edge-pixel color sampling

## Backlog item

**QR footer band blends with artwork - deterministic edge-pixel color sampling**

Goal: derive QR-band presentation from the painted hero's bottom edge without
an AI call, while preserving QR scannability and preview/export identity.

## Decisions

1. Sample the full-width bottom 3% of the hero's intrinsic pixel dimensions.
   Draw that source rectangle 1:1 into a strip-sized offscreen canvas, with no
   CSS-size, viewport, device-pixel-ratio, or export-pixel-ratio input.
2. Reduce the strip with fixed 32-value RGB bins. Select by highest pixel
   count, then proximity to the strip-wide mean, then lowest numeric bin key.
   Return the integer-rounded RGB mean of the winning bin.
3. Choose footer text polarity using WCAG relative luminance and contrast.
   Secondary text must retain at least 4.5:1 contrast. Keep the preferred brand
   accent only at 3:1 or better; otherwise use the selected text color for the
   hairline. The white QR chip and black-on-white QR modules do not change.
4. `AiPoster` is the only canvas sampler. Preview samples its loaded Storage
   image; each export mounts a fresh `AiPoster` using the existing CORS-fetched
   data URL and waits for that clone's source-keyed sampled or fallback style
   to commit before capture.
5. Sampling failure preserves the existing footer contract byte-for-byte:
   `pc.ink`, `#ffffff`, `rgba(255,255,255,0.72)`, and `pc.accent`.
6. Sampling applies only to formats with a rendered QR band. Artwork-only
   formats, the palette-derived matte, QR geometry, and persisted campaign data
   remain unchanged.
7. The appearance change is intentionally retroactive. Existing generated
   artwork is not repainted, but future previews and exports of every existing
   QR-band poster derive their footer from its stored hero pixels.

## Reasoning

1. Three percent is thick enough to absorb isolated edge noise while remaining
   local to the visual surface that meets the footer. Intrinsic 1:1 sampling
   avoids interpolation differences and keeps preview scale out of the result.
2. A global average can invent a muddy color that is absent from a gradient or
   split-color edge. A dominant quantized bin chooses a color family actually
   present in the artwork, while the explicit tie-breaks remove scan-order and
   map-order ambiguity.
3. Sampled artwork can be light or dark, unlike the former fixed dark footer.
   Polarity selection, a 4.5:1 supporting-text floor, and a 3:1 non-text accent
   gate protect readability without changing the QR's established quiet zone.
4. Passing preview state through editor and placement pages would add cache
   invalidation and would not cover placement exports that have no mounted
   preview. Re-sampling the same image bytes in the canonical poster renderer
   keeps both paths self-contained and identical.
5. CORS, tainted-canvas, decode, and unsupported-canvas failures must not make
   existing posters unusable or visually unpredictable. The old values remain
   the complete fallback rather than being reprocessed by the new contrast
   policy.
6. Identical decoded RGBA guaranteed; cross-browser decoder drift softened by
   quantization but not mathematically eliminated.
7. Dynamic composition is the product behavior: applying the fix to historical
   posters is the intended polish improvement and avoids a migration or another
   stored derivative.

## Follow-ups

None.
