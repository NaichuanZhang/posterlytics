# Pre-generation asset-selection handoff

## Backlog item

**Pre-seed captured website candidates before generation**

Goal: let creators include, exclude, and prioritize captured source images before
enqueue without adding schema or changing normal source acquisition.

## Decisions

1. Keep selection in the existing eager snapshot by adding an optional
   `eager_selection` sibling inside `brand_assets`; add no migration, RPC, or
   generation column.
2. Preserve every captured URL in `brand_assets.images`. Put included images
   first in creator priority order, retain excluded images afterward for
   validation, and point `primary_image_url` at the first included image.
3. Store marker version `1`, excluded product URLs, and the logo-excluded flag.
   Validate selection against the captured universe with the existing
   four-product preview limit and a defensive six-selection limit.
4. Apply the marker only after the existing eager-reuse gate succeeds. Included
   eager candidates precede fresh extraction, excluded URLs are removed from
   both sources, and excluding the captured logo suppresses all fresh logo
   candidates.
5. Treat an absent, malformed, unknown-version, or out-of-universe marker as
   legacy full inclusion. Eager snapshot eligibility and the existing
   fresh-then-eager order remain unchanged in that case.
6. Describe controls as candidate inclusion and priority. Editor still provides
   final review, Yolo may omit or reorder candidates, the model is not promised
   to use them, and existing user-reference priority and generation limits stay
   unchanged.
7. Record only selection-applied, excluded-count, and logo-excluded trace
   metadata. Never record source URLs in traces.

## Reasoning

Encoding order in the inherited JSON snapshot uses the existing value-equality
gate and enqueue copy without widening the database contract. Retaining excluded
URLs makes server subset validation possible and prevents a rediscovered HTML
URL from bypassing the creator's choice.

Failing open to legacy behavior keeps an optional preference from disabling a
valid eager optimization. Restricting selection-aware merging to the eligible
eager branch leaves normal website analysis and every non-website recipe
unchanged.

## Follow-ups

None.
