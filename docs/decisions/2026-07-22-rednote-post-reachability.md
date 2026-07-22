# RedNote post reachability

## Backlog item

**小红书post**

Goal: register an honest single-cover RedNote workflow with required draft copy
and creative references, without implying that multi-page output exists.

## Decisions

1. `rednote_post` generates one 3:4 full-bleed cover today. Multi-page copy,
   presentation, rendering, paging, and export remain deferred.
2. Mirror the Social Cover acquisition and prompt recipe, changing only the
   recipe ID. Analyze, designer, and hero prompts remain byte-identical.
3. Require trimmed draft copy and at least one usable reference image for
   initial generation and retry.
4. Treat Social Cover and RedNote as reference-only through shared predicates.
   Every new version re-analyzes its references; retries preserve safe
   completed-selection resume behavior.
5. Keep URL, CTA, destination, QR, placement tracking, and analytics disabled.
   Allow and default only to `rednote_cover_3x4`.
6. Do not author `poster_content.rednote_post` and do not import the foundation
   module into the generation pipeline while no page consumer exists.
7. `guard_campaign_source_intent_update` is use-case-generic and needed no
   change.

## Reasoning

1. A valid cover makes the use case reachable now without storing dead
   multi-page state that no renderer or exporter can consume.
2. Shared reference-only predicates keep both workflows aligned and preserve
   Social Cover prompts byte-for-byte.
3. UI preflight and database validation enforce the same required inputs even
   when a caller bypasses native form validation.
4. `functions/_assetSelection.ts` already keys source behavior from
   `acquisitionMode`, so RedNote inherits the correct no-fetch path without an
   ID branch.
5. The source-intent guard freezes `product_url` and `use_case` after generation
   starts without a Social Cover exception, so extending it would add no
   protection.

## Follow-ups

1. Split and normalize draft copy into `poster_content.rednote_post.pages`
   inside `analyze`'s normalize path.
2. Add a deterministic RedNote designer branch.
3. Generate one reusable text-free background with one hero image call.
4. Add the multi-page renderer and pager.
5. Add ordered PNG ZIP export, CJK font verification, and Playwright
   containment coverage.
