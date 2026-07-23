# Poster export run snapshot

## Backlog item

**Per-page PNG export does not freeze render inputs**

Each export click freezes one generation-scoped run before asynchronous work so
single-page PNG and all-pages ZIP output cannot mix poster versions.

## Decisions

1. Capture the campaign, poster size, hero, placement, version, raster options,
   naming inputs, and page metadata once before the first export `await`.
2. Store the complete run on every offscreen render attempt. Render readiness,
   image decoding, `toPng`, and filename construction read only from that run.
3. Reuse the same run object for every ZIP page; only the attempt ID and page
   metadata vary across the sequential captures.
4. Keep version navigation enabled. The run snapshot is the correctness
   boundary even when the selected generation changes during export.
5. Preserve the existing hero-fetch fallback, readiness timeout, font
   embedding, QR wait, raster dimensions, download, and cleanup behavior.

## Reasoning

1. React keeps the asynchronous click closure but re-renders the offscreen
   element with current component props. A state-held run gives the clone the
   same immutable generation inputs as the closure.
2. Explicit primitive capture fields prevent dimensions, QR requirements, or
   filenames from drifting even when a later version has a different format or
   placement.
3. Disabling navigation would only hide one trigger and add cross-component
   state plumbing; it would not make the export operation intrinsically safe.
4. Keeping the existing renderer and `toPng` configuration protects footer
   font embedding and RedNote contrast behavior.

## Follow-ups

1. ZIP filename deduplication by encoded UTF-8 bytes remains a separate Minor.
   Poster export names are currently sanitized to ASCII.
