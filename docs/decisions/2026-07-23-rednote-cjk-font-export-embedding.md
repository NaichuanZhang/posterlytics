# RedNote CJK font export embedding

## Backlog item

**RedNote DOM cover: bundle CJK (+RTL) fonts so non-Latin covers do not render
as tofu**

RedNote preview and export use a scoped, actively awaited common Simplified
Chinese font subset without making every poster export embed a full CJK face.

## Decisions

1. Commit one Noto Sans SC 500 WOFF2 containing GB2312 Level-1's 3,755 common
   Han characters plus CJK punctuation. Generate it reproducibly from pinned
   development packages and reject output above 1,228,800 bytes.
2. Declare the face only from `RedNotePostPage` with a project-specific family,
   no `local()` source, and a CJK `unicode-range`. Latin continues to use Arial.
3. Derive exact per-page code points from persisted DOM strings and the page
   marker. Actively load the specific face with those CJK characters before
   render readiness; `document.fonts.ready` alone is not sufficient.
4. Build export CSS directly from the committed WOFF2, validate its signature
   and size, convert it to one cached data URL, and pass it as `fontEmbedCSS`
   only for CJK RedNote pages.
5. Pass an empty `fontEmbedCSS` for Latin-only RedNote pages so html-to-image
   embeds no web font. Omit the option for every non-RedNote export so the
   Order-109 QR-footer font policy remains unchanged.
6. Reuse the same bounded CSS across sequential ZIP pages. The base64 font is
   transient SVG input and is not stored in the resulting PNG or ZIP.

## Reasoning

1. A runtime subsetter would add a full source font and WASM to the critical
   render path. A full bundled face would recreate multi-megabyte export work.
2. GB2312 Level-1 covers the confirmed common Simplified Chinese case in one
   reviewable slice while keeping the WOFF2 near the target 700 KB.
3. Constructing export CSS from the known asset avoids CSSOM scraping and
   guarantees that only the intended face can enter a RedNote export.
4. Page-specific detection prevents English RedNote pages from paying the CJK
   embedding cost, while caching avoids repeated font fetch and base64 work.
5. A typical CJK page therefore adds about 700 KB of WOFF2 input, or about
   0.93 MB after base64 encoding, while html-to-image builds its transient SVG.
   Generation and runtime validation hard-limit this to 1,228,800 font bytes
   and 1,638,400 base64 characters (1.56 MB) plus at most 1,024 CSS characters.
   The encoded font is not retained in the final raster PNG.

## Follow-ups

1. GB2312 Level-2 and rare Han characters need broader coverage or exact
   per-plan dynamic subsetting.
2. Japanese and Korean require their own measured glyph coverage.
3. Arabic and Hebrew require fonts plus `dir`/alignment and shaping tests; RTL
   is not provided by this Chinese-font change.
4. Runtime exact subsetting remains deferred until its WASM, latency, and
   browser compatibility costs are justified.
5. The single 500 face means 700/800 headings and page markers use
   browser-synthesized bold. A second weight would approximately double the
   bounded font and export payload.
