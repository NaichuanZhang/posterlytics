# AI copy artifacts and painter guard

## Backlog item

Order 113 fixes four deterministic sanitizer/painter boundary defects (4-digit RGBA hex, capitalized proper-name reduplication no longer collapsed, single trailing CJK em-dash preserved, sourced Sign Up/Get Started CTAs no longer rejected) and adds a best-effort painter prompt exclusion against decorative emoji + placeholder/slot-label words; finished-raster OCR/vision validation and bounded regeneration remain DEFERRED to a separately scoped backlog item.

## Decisions

- Consume 4-digit painter RGBA hex as its opaque 3-digit color before naming it.
- Collapse only unprotected, all-lowercase adjacent Latin duplicates; preserve sourced pairs and pairs containing uppercase or titlecase letters.
- Preserve pure trailing em-dash runs adjacent to CJK, including a single dash, while trimming Latin, middle-dot, pipe, and mixed trailing runs.
- Allow sole `Sign Up` and `Get Started` CTA copy only when a protected source mentions the phrase at token boundaries. Keep wrapped CTA labels and all structural placeholders rejected.
- Add a shared painter-only exclusion after quoted-text rules, with a no-exception variant for text-free RedNote backgrounds. Leave analyze and designer chat prompts unchanged.

## Reasoning

- These boundaries preserve valid source and proper-name copy without reopening generic placeholders or model stutters.
- Painter prompt exclusions are deterministic and low-risk, but image models can still produce visible artifacts despite prompt instructions.

## Follow-ups

- Defer finished-raster OCR/vision validation and bounded regeneration to a separately scoped backlog item with explicit quality thresholds and retry limits.
