# Accessible poster copy

## Backlog item

Reuse persisted generation snapshots to expose intended poster text without schema changes.

## Decisions

- Derive a pure transcript from the selected campaign or generation snapshot. Do not persist a second copy model or fetch additional generation data.
- Treat ordered `poster_layout.zones[].content` as the primary product-poster text. Reuse the layout preview's band grouping, blank filtering, whitespace normalization, and exact first-wins deduplication.
- Use structured product content, legacy poster copy, then campaign name/tagline only when a snapshot has no usable layout text.
- Derive historical event artwork only from `poster_spec`: title, optional legacy hook, and host. Add date, time, and location to bandless artwork, and never expose price, URLs, or `poster_copy.hook`.
- Include composited footer text only when the caller requests it and the selected format has a QR band. Mirror the three painted English fallback literals exactly rather than localizing them.
- Show the full transcript as a bounded editor `figcaption`, use a localized 150-code-point summary for image alts, and keep the selected generation as the single source for the image, caption, and clipboard text.
- Keep exported PNG pixels unchanged. The off-screen export render has an empty alt and no transcript caption.
- Project the existing copy/layout columns on the campaign list so hero thumbnails can use derived short alts. Brand and source-image fallbacks remain decorative because the adjacent campaign link supplies the name.

## Reasoning

- Existing snapshots already preserve the text and layout used for each generation, so deriving at render time keeps version switching accurate without migrations or API expansion.
- Layout-zone order matches the actual designer and wireframe contract; a separate sort would drift on malformed or future band values.
- Event prompts have a different painting contract from product layouts. Strict `poster_spec` provenance avoids announcing copy that current event artwork never paints.
- A caption outside the canvas remains selectable, scrollable, and copyable while leaving native poster/export geometry untouched.

## Follow-ups

- Public share-page transcript.
- Text-override editing.
- OCR or generated-artifact text validation.
- RedNote multi-page copy beyond the currently rendered poster surface.
