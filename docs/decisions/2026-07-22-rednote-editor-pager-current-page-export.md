# RedNote editor pager and current-page export

## Backlog item

**小红书post**

RedNote editor pager navigates all pages, exposes the selected-page transcript,
and exports the current page as PNG.

## Decisions

1. Keep page selection local to the editor and key it by generation. Reset to
   the cover on a version change and clamp it through one shared pure helper
   before preview, transcript, or export.
2. Show previous/next controls only for a valid marked RedNote plan whose hero
   background exists. Legacy RedNote and every other use case keep the existing
   single-poster canvas.
3. Render current-page exports through `PosterSurface` so valid marked records
   use DOM compositing while its legacy branch continues to use `AiPoster`.
4. Append an ordered `page-02-of-05` suffix only to composite page exports.
   Existing export filenames remain unchanged.
5. Keep strict render-model index validation. Component boundaries clamp before
   calling it so corrupt UI state cannot crash the editor.
6. Add a conservative terminal content-body size tier for maximum bounded CJK
   plans without changing the shipped cover sizing.

## Reasoning

1. Generation-keyed state prevents a page selected in one immutable generation
   from leaking into another and also handles defensive page-count shrinkage.
2. The persisted render marker remains the compatibility boundary. Requiring
   the hero also keeps controls aligned with the canvas surface actually shown.
3. Reusing the existing readiness and image-decode contract avoids a second
   export renderer and keeps scaled-band legacy exports on their established
   path.
4. Current-page PNG is independently useful and validates arbitrary-page
   rendering without introducing archive dependencies or multi-canvas memory
   pressure.

## Follow-ups

1. Add ordered all-page ZIP export with `fflate`, sequential page capture, and
   explicit per-page buffer cleanup.
2. Bundle CJK fonts and replace static tiers with measured text fitting.
3. Add exhaustive cross-font and cross-viewport Playwright coverage, then run a
   controlled live-generation rollout.
