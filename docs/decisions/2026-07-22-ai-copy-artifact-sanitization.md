# AI copy artifact sanitization

## Backlog item

Remove model copy artifacts and painter-visible hex codes without rewriting user-authored copy or structured brand data.

## Decisions

- Sanitize model-authored poster copy when analysis output and designer zone output cross into persisted generation data. Campaign copy, generation instructions, and reference context are protection sources, not sanitizer inputs.
- Preserve exact protected copy and any adjacent doubled Latin phrase found inside protected source text. Collapse only unprotected duplicates.
- Remove decorative emoji only when they are actual color-emoji sequences: `Emoji_Presentation`, VS16-forced, keycap, regional-indicator pair, ZWJ, or modifier sequences. Text-default pictographic symbols remain copy.
- Convert painter-visible hex values to the nearest fixed English color name in OKLab. Analyze/designer chat prompts and persisted structured palettes retain exact hex values.
- Keep quoted zone content outside the hex backstop. Palette descriptions, `brand_essence`, iteration instructions, parent-layout JSON, supporting colors, and proportions use the backstop.
- Keep the analyze schema instruction for `brand_essence` to "name the hex." `brand_essence` is not copy-sanitized; the non-zone painter backstop converts any resulting hex before image generation.
- Guard golden updates by requiring freshly captured analyze and designer prompts to remain byte-identical. The updater can rewrite only hero entries and requires RedNote hero parity with social-cover hero.
- Functionally affected deployment bundles are `analyze`, `designer`, `hero`, and `generation-worker`. `view`, `capture-preview`, and `reference-import` bundle `_shared.ts` but are affected only incidentally at the bundle-byte level. `amazon-product-lookup` does not bundle `_shared.ts` and is excluded.

## Reasoning

- Boundary sanitization removes model artifacts before they spread while retaining user intent and deterministic event logistics.
- `Extended_Pictographic` alone includes text-default symbols such as `™`, `©`, `®`, `㊗`, and `㊙`; render-oriented emoji classes avoid destructive copy loss.
- English color names communicate palette intent to the image model without encouraging it to paint hex strings. Keeping structured hex preserves deterministic palette data for non-painter stages.
- Separating quoted zones from non-zone prompt context preserves legitimate hashtag-shaped and hex-like marketing copy verbatim.
- A hero-only updater makes prompt drift explicit instead of allowing snapshot regeneration to mask an analyze/designer regression.

## Follow-ups

- Add a separate raster validator using OCR and pixel checks, with retry-on-bad-pixels policy. It needs its own quality thresholds, latency budget, and retry decision.
