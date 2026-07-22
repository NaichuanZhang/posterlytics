# RedNote AI copy plan

## Backlog item

**小红书post**

Goal: use the existing RedNote analyze call to persist a normalized
AI-optimized multi-page plan and project its cover into the current
single-cover pipeline; defer background stitching and multi-page delivery.

## Decisions

1. Give only the RedNote recipe a fresh analyze policy with
   `outputMode: rednote-post-v1`; Social Cover retains byte-identical prompts.
2. Use the existing analyze chat call to optimize draft copy into one cover and
   one to eight ordered content pages. Do not add a copy-planning or per-page
   model call.
3. Treat generation instructions as the sole factual copy source and references
   as visual evidence. Preserve source language and meaningful CJK punctuation.
4. Normalize and bound model fields through the shared RedNote plan contract.
   Deterministic fallback text bypasses model-copy sanitization.
5. Project the optimized cover and up to six content headings into the existing
   `poster_content` fields after analyze repair/fallback resolution. Preserve
   normal style, essence, legacy copy, and poster-spec normalization.
6. Keep designer, hero, rendering, export, SQL, and visible UI unchanged in this
   slice. The current pipeline still makes one hero image.
7. Pin the new RedNote analyze prompt separately. Its updater must prove all
   other prompt goldens and RedNote downstream parity before writing that one
   fixture.

## Reasoning

1. A persisted, immediately consumed plan adds optimized cover copy without
   exposing a partial multi-page UI.
2. Post-fallback projection guarantees every RedNote generation has a bounded
   plan, including double model failure, while preserving the established
   designer dependencies.
3. Isolating the output mode avoids mutating the Analyze object shared by the
   shallow Social Cover recipe spread.
4. JSONB already carries `poster_content` through generation completion, so no
   schema change is required.

## Follow-ups

1. Add a deterministic RedNote designer and one text-free reusable background
   from the existing single hero image call.
2. Add a client DOM multi-page renderer, pager, transcript integration, and
   current-page PNG export.
3. Add ordered PNG ZIP export with bundled CJK fonts and deterministic fitting.
4. Add Playwright containment/export coverage and a controlled live rollout.
