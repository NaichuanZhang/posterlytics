## Backlog item

小红书post — RedNote uses one text-free AI background plus marker-gated client DOM cover compositing (Commit A: generation, cover renderer, and thumbnails); pager, content-page navigation, current-page/ZIP export, and bundled CJK fonts remain Commit B.

## Decisions

- `rednote_post` alone carries `artworkMode: rednote-background-v1`; the Social Cover recipe and every existing prompt remain unchanged.
- RedNote generation uses one analyze chat, deterministic asset selection in YOLO mode, a model-free designer stage, and one hero image call.
- The designer persists a deterministic layout directly with `render_mode: rednote-background-v1`, empty-content visual zones, palette roles, style-derived background direction, and the cover text-safe rectangle.
- Hero accepts only the marker, a valid 2-9 page RedNote plan, and `rednote_cover_3x4`; it emits a prompt that excludes campaign copy and prohibits all writing, identity marks, UI, and faux glyphs.
- Legacy parent artwork is excluded unless its layout carries the same marker. User references remain visual evidence with explicit no-text purpose instructions.
- Client rendering dispatches only marked records to DOM compositing. Unmarked RedNote records and all other use cases retain `AiPoster`; malformed marked records show a localized error and never reveal the raw background.
- `RedNotePostPage` accepts any valid page index, but this slice passes only page `0`. The editor, campaign list, version history, and wizard success surface therefore show the composite cover only.
- Marked RedNote PNG export is disabled until the page-aware export contract ships.

## Reasoning

- Background generation and the minimum cover compositor are atomic: either half alone produces a blank-looking cover or duplicate text.
- A persisted marker isolates new background-only assets from historical text-baked RedNote covers without heuristics or a schema migration.
- Keeping the designer stage preserves worker progression and trace semantics while removing a model call and retaining an auditable layout artifact.
- Fetching the completed campaign for wizard success avoids changing the activity RPC and supplies the content/layout required to composite safely.
- Strict persisted-plan parsing prevents corrupt marked rows from silently falling back to a raw text-free image.

## Follow-ups

- Commit B: editor previous/next pager and localized page position, content pages 2-N, current-page PNG export, ordered ZIP export, bundled CJK fonts, measured fitting, and Playwright containment/export coverage.
- Later roadmap: richer per-page templates, optional page-specific backgrounds derived from the single source background without additional AI calls, and authoring controls for page copy and hierarchy.
