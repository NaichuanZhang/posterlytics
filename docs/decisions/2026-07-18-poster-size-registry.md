# Poster size registry and generation snapshots

## Backlog item

**Custom poster size support (size registry + per-campaign format)**

Goal: replace the fixed A4/2:3 assumption with one edge-safe format registry
while preserving the existing default output exactly.

## Decisions

1. `src/lib/posterSize.ts` is the dependency-free source of truth. Each
   `PosterSizeDescriptor` has a stable slug, typed catalog label, artwork width
   and height, output-sheet width and height, provider aspect string, export
   pixel ratio, filename suffix, and one QR-band scale.
2. `a4_2x3` remains the default and retains 980x1470 artwork, a 1240x1754
   sheet, and a 2x 2480x3508 export. This change also ships `rednote_3x4`
   (960x1280 artwork, 1242x1656 export), `yt_thumb_16x9` (800x450 artwork,
   1280x720 export), and `luma_1x1` (800x800 artwork, 1080x1080 export).
3. `campaigns.poster_format` is the editable target for the next generation.
   `poster_generations.poster_format` is the immutable snapshot of what a
   generation actually produced. Historical preview/export reads the snapshot;
   activating an old version does not rewrite the campaign target; retry copies
   the failed generation's snapshot.
4. Enqueue reads the campaign target inside the locked database path and writes
   it to the generation. Designer and hero resolve that snapshot through the
   same registry; a parent/target mismatch adds only the new frame and a request
   to recompose.
5. Every footer measurement, including margins, gap, footer height, QR size,
   padding, and type, scales from one preset scalar. Artwork and output-sheet
   dimensions remain explicit descriptor values.
6. Missing legacy slugs (`null` or `undefined`) resolve to `a4_2x3`. Any present
   empty or unknown slug throws, and database checks accept only registered
   slugs.
7. `story_9x16` and `share_1200x630` are not registered in this change.
   The former needs visual validation of the footer and QR treatment in an
   extreme portrait frame; the latter needs a confirmed provider strategy for
   its exact 40:21 aspect.

## Reasoning

1. A pure descriptor module can be imported by both Vite and bundled edge
   functions, preventing separate SPA and provider-format maps.
2. Shipping three materially different shapes exercises portrait, landscape,
   and square behavior without claiming support for formats whose rendering or
   provider contract is unresolved.
3. Separating target from snapshot keeps version history truthful. Deriving
   historical geometry from the mutable campaign would silently reshape old
   artwork and exports.
4. Snapshotting in the enqueue transaction removes client/edge timing races,
   while strict edge lookup turns registry/schema drift into an explicit
   failure.
5. One scalar preserves internal QR-band proportions and avoids independent
   constants drifting across aspect ratios.
6. Nullish fallback supports pre-migration data. Falling back for an unknown
   non-null slug would hide corruption and could send a different ratio to the
   image provider than the SPA renders.
7. Deferring 9:16 and 40:21 keeps the registry honest: a slug represents a
   verified render, export, and provider contract rather than a speculative
   label.

## Follow-ups

- Validate a 9:16 footer/QR composition before adding `story_9x16`.
- Confirm exact 40:21 image-provider behavior before adding
  `share_1200x630`.
