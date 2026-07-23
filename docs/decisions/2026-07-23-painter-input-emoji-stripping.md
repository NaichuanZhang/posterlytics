# Painter input emoji stripping

## Backlog item

Order 124 strips decorative emoji from the fully assembled textual painter
prompt at the single `hero.ts` boundary with no allowlist, preserving upstream
source copy and byte-identical clean prompts; OCR/raster validation and the
raster-only duplicate-word artifact remain deferred because they need a new
validation service and latency policy unavailable in the Deno edge runtime.

## Decisions

- Strip decorative emoji from the fully assembled textual painter prompt at the
  single `hero.ts` boundary before tracing, payload assembly, image generation,
  and the returned prompt.
- Apply no source allowlist at this boundary: painted pixels never receive
  source-approved emoji.
- Preserve upstream `emojiSourceTexts` behavior and persisted copy, including
  deterministic RedNote fallback fields.
- Return clean prompts byte-for-byte unchanged. When emoji are present, repair
  horizontal whitespace only on lines changed by removal and preserve newlines.
- Leave adjacent-word duplicate handling unchanged.

## Reasoning

- Stripping the final prompt covers product layouts, fallback layouts, events,
  RedNote backgrounds, brand essence, and iteration context without duplicating
  rules across prompt builders.
- Removing the analyze/designer allowlist alone would miss exact protected
  strings, raw fallbacks, and unsanitized brand essence while also widening the
  behavior change to non-painter copy.
- A byte-identical no-match path keeps existing prompt goldens stable.

## Follow-ups

- OCR/raster validation and duplicated-word detection remain deferred because
  they require a new validation service, quality thresholds, retry limits, and
  a latency policy not available in the Deno edge runtime.
- Emoji or text inside reference-image pixels and image-model hallucinations
  remain residuals that a textual prompt boundary cannot reach.
