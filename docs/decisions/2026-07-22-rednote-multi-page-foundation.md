# RedNote multi-page post foundation

## Backlog item

**小红书post**

Goal: establish a bounded multi-page copy contract and deterministic 3:4
composition geometry before wiring the RedNote generation and export workflow.

## Decisions

1. Store a versioned `RedNotePostPlan` under the existing
   `poster_content.rednote_post` JSONB value. Do not add a database column or
   migration for the foundation.
2. Bound a post to one leading cover plus one to eight content pages. Normalize
   model-shaped input defensively and use deterministic source-copy splitting
   when that input is unusable.
3. Reuse the registered `rednote_cover_3x4` format and type-anchor its exported
   format constant to `PosterSizeSlug`. Keep all page composition rectangles in
   one pure, unit-tested module.
4. Derive every fallback title and heading from caller-provided title, subtitle,
   or source copy. Empty caller input may produce empty visible fields; the
   foundation does not invent placeholder copy.
5. Keep this slice disconnected from use-case registration, edge functions,
   rendering, export, SQL, and i18n. Existing `social_cover` behavior remains
   unchanged.
6. `analyze` currently rebuilds `poster_content` from a fixed object literal on
   every run. The future pipeline slice must author `rednote_post` inside
   `analyze`'s normalize path; attaching it elsewhere would drop the plan on
   every regeneration.
7. Terminal poster generations are immutable. Multi-page plans cannot be
   backfilled onto finished generations; only generations created after the
   future pipeline wiring can contain the plan.

## Reasoning

1. `poster_content` already follows generation enqueue, retry, activation, and
   atomic campaign projection. A nested versioned value gains those guarantees
   without broad SQL function rewrites.
2. Pure normalization and geometry settle the contract shared by future prompt,
   renderer, and export work while changing no user-visible behavior.
3. Reusing the existing 1242x1656 bandless descriptor avoids a duplicate format
   and preserves the established RedNote cover geometry.
4. Source-derived fallbacks preserve user intent and keep generated visible text
   out of application source literals.
5. A foundation-only commit is independently testable and avoids half-wiring a
   workflow that still lacks model, renderer, and export support.
6. Recording the reconstruction and immutability boundaries prevents later work
   from relying on JSON merging or historical backfill behavior that does not
   exist.

## Follow-ups

1. Add a distinct `rednote_post` use case, append-only database policy changes,
   wizard/editor copy input, and strict English/Chinese message parity.
2. Extend `analyze` to optimize and split copy into `rednote_post`, make the
   designer stage deterministic for this use case, and make `hero` generate one
   reusable text-free background with one image-model call.
3. Add the multi-page preview renderer and editor navigation while leaving
   `AiPoster` and `social_cover` unchanged.
4. Add ordered multi-PNG ZIP export, CJK font verification, Playwright
   containment checks, and one controlled live generation after mocked call
   counting is green.
