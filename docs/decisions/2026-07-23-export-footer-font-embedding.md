# Export footer font embedding

## Backlog item

**Exported PNG footer CTA overlaps "Point your camera here"**

PNG exports inline their used poster font, while the QR-footer CTA and helper
occupy fixed single-line lanes so export-time font substitution cannot wrap the
CTA into a vertical overlap. Preview appearance and footer geometry remain
unchanged.

## Decisions

1. Allow `html-to-image` to embed fonts through its default `toPng` behavior by
   removing `skipFonts`. Do not provide custom `fontEmbedCSS` or a preferred
   font format.
2. Give the footer copy column the full row space left after the QR chip,
   padding, and gap rather than retaining its intrinsic content width.
3. Keep the CTA and product helper on one line with clipped ellipsis overflow.
   Preserve their existing type scale, weight, line height, spacing, colors,
   text content, and footer geometry.
4. Leave event date, time, location, and host spans unchanged so those
   intentionally multi-line logistics can continue to wrap.
5. Verify every QR-footer preset with native DOM geometry and the real download
   path. Inspect the serialized export SVG for a Space Grotesk `data:` font URL,
   then decode the downloaded PNG and assert its registered raster dimensions.
6. Keep `rednote_cover_3x4` and `RedNotePostPage` out of scope because that
   renderer is full-bleed and has no QR footer.

## Reasoning

1. `skipFonts` was introduced in `2565da0` before the application declared a
   web font, so it was initially inert. Commit `0948bb5` later added the bundled
   Space Grotesk face, leaving the live document and isolated export SVG with
   different font resources.
2. `html-to-image` copies the live CTA's computed one-line height and tight
   flex-item width before serializing it into an SVG `foreignObject`. Without an
   embedded font, a wider fallback can wrap inside those frozen dimensions and
   paint under the helper. Waiting for `document.fonts.ready` cannot transfer
   the document font into the SVG image context.
3. Default embedding fetches the Vite-bundled, same-origin WOFF2 only for
   export and converts it to a data URL. If that fetch ever fails, the
   full-width nowrap lanes still prevent vertical overlap.
4. Growing the footer, reserving a permanent second CTA line, or changing
   z-order would alter registered composition or obscure text without restoring
   preview/export typography.
5. A live-DOM-only assertion cannot detect this regression. Auditing the exact
   SVG consumed by `toPng`, plus decoding the resulting PNG, covers the raster
   path without unstable anti-aliased glyph-pixel heuristics.

## Follow-ups

None.
