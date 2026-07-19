# RedNote 3:4 artwork-only cover

## Backlog item

**Xiaohongshu post images - 3:4 cover**

Goal: export a full-bleed 1242x1656 Xiaohongshu cover without embedding a QR
code or tracked-link footer, while reusing the existing generation pipeline.

## Decisions

1. Add `rednote_cover_3x4` instead of changing `rednote_3x4`. The existing
   preset remains a placement-specific 3:4 poster with a QR band.
2. Replace the scale-only `qrBand` field with the discriminated union
   `{ mode: 'scaled', scale } | { mode: 'none' }`.
3. The new preset uses 1242x1656 artwork on a 1242x1656 sheet, provider ratio
   `3:4`, a 1x export, and no matte, margin, footer, or QR code.
4. Product designer and painter prompts branch on the descriptor. A bandless
   prompt never promises an external footer and still forbids painted QR codes,
   URLs, link calls to action, and button-like controls. The retained event path
   paints exact date, time, and location strings into bandless artwork because
   no real-text footer exists.
5. The format picker and export surfaces show one short caveat: artwork-only
   exports contain no QR code or placement tracking. Placements exposes one
   campaign-level cover export instead of repeating an identical export for
   every placement.
6. The existing `luma_1x1` preset is unchanged. A bandless square variant is
   deferred.

## Reasoning

1. A new slug preserves the meaning and immutable geometry of every historical
   generation. It also keeps placement-specific 3:4 output available for other
   surfaces.
2. A descriptor capability is deterministic across generation, preview, and
   export. A per-export toggle could make one generation's prompt disagree with
   its final composition; a campaign setting would duplicate the format
   snapshot contract.
3. Full-bleed geometry matches a social cover rather than carrying print-poster
   matte and footer framing into the image.
4. Prompt branching prevents the model from omitting content in anticipation of
   a footer that will not render, while preserving the restriction against
   external-link artwork.
5. Minimal contextual copy states the analytics limitation without turning
   format selection into a warning flow.
6. Square reuse already works through `luma_1x1`; adding another variant without
   a concrete placement need would expand the registry and schema prematurely.

## Follow-ups

- Add a bandless 1:1 descriptor only when a concrete social placement requires
  it.
- Carousel and multi-image Xiaohongshu posts remain a separate story; no
  carousel scaffolding is included here.
