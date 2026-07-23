# Automatic asset-selection copy

## Backlog item

**Creator-facing jargon in generation UI**

Display the persisted `yolo` asset-selection mode as "Automatic" / "自动" and
replace the Placements empty-state verb "mint" with "create"; keep the internal
value, enum, and database contract unchanged.

## Decisions

1. Present the existing `yolo` mode as "Automatic" in English and "自动" in
   Chinese wherever creators choose or review asset selection.
2. Keep "Editor" and both mode descriptions unchanged because they already
   explain the creator workflow in plain language.
3. Replace "mint" with "create" only in the Placements empty-state instruction.
4. Preserve the marketing Mint/signal language, sample-poster `signal` variant,
   internal `mintCode`, and Analytics "minted link" description.
5. Keep every persisted `yolo` value, API and database field, worker branch, and
   `validateYoloSelection` name unchanged.

## Reasoning

"Automatic" describes the current no-review behavior without exposing internal
engineering slang. Mapping only the display copy avoids a data migration and
preserves workspace, enqueue, retry, worker, and database compatibility.

"Create" is clearer task language in the application empty state. The landing
page and signal phrases are deliberate marketing voice, while the Analytics
description belongs to a broader attribution terminology pass.

## Follow-ups

1. Review "Traffic attributed to each minted link." with the rest of Analytics
   and attribution terminology.
2. Revisit marketing Mint/signal language only as part of an explicit brand
   voice review.
