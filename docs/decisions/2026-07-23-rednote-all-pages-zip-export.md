# RedNote all-pages ZIP export

## Backlog item

**小红书post**

Marked RedNote editor posts export all persisted pages sequentially into one
deterministic zero-dependency STORE-only ZIP; current-page PNG and every
non-editor export remain unchanged.

## Decisions

1. Show the all-pages action only from the editor and only for a valid marked
   RedNote plan. Keep legacy RedNote, placements, and every other use case on
   their existing single-PNG export path.
2. Reuse the existing single-slot offscreen `PosterSurface` sequentially with a
   fresh attempt ID for every page. Fetch the shared hero once as a data URL and
   abort the archive if that fetch or any page capture fails.
3. Emit a deterministic ZIP32 archive with UTF-8 root filenames and STORE
   entries. Implement the bounded writer locally with complete local, central,
   and end-of-central-directory records plus CRC32 validation.
4. Retain only compressed PNG bytes between captures, download the finished ZIP
   through an object URL, and revoke that URL on the next task.
5. Validate archive compatibility with the system `unzip` implementation in
   addition to unit-level byte and round-trip assertions.

## Reasoning

1. The explicit editor prop prevents the shared export component from adding a
   bulk action to placement and icon-export surfaces.
2. Sequential capture preserves the renderer's readiness and CORS contracts
   without mounting multiple native-size posters or making per-page AI calls.
3. PNG data is already compressed, so DEFLATE adds CPU without meaningful size
   savings. A bounded STORE writer avoids dependency and lockfile churn while
   external-decoder tests cover binary-format compatibility.
4. Aborting on the first failed page prevents incomplete archives from looking
   successful.

## Follow-ups

1. Order 117 owns bundled CJK fonts and DOM-cover contrast sampling.
2. Measured text fitting, broader cross-browser Playwright coverage, and a
   controlled live rollout remain separate work.
3. The core RedNote roadmap is complete: generate, render, navigate, and export
   all pages.
