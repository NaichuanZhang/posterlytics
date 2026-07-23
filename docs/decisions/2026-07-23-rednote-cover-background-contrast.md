# RedNote cover background contrast

## Backlog item

RedNote cover text polarity now follows `palette_roles.bg` and the scrim is
strengthened to a deterministic AA floor computed against the adverse
worst-case pixel, guaranteeing >=4.5:1 cover-text contrast over any generated
background without image sampling. Bundled CJK fonts are DEFERRED to a
dedicated export-aware follow-up.

## Decisions

- Choose `#111111` or `#ffffff` by whichever has higher WCAG contrast against
  the persisted background role, not against the text role.
- Compute the scrim floor synchronously in one-percent alpha steps against both
  the background role and the adverse RGB extreme.
- Reach that floor at 50% of the frame, before the cover-copy reserve, while
  preserving the existing 0%, 34%, and 100% gradient behavior.
- Keep content-page palette resolution, rendering, exports, server layout
  generation, schemas, fonts, and dependencies unchanged.

## Reasoning

- `palette_roles.bg` is already required, persisted, and supplied to the image
  model as the background direction, so it is the deterministic client signal.
- A black scrim's worst case is a white pixel and a white scrim's worst case is
  a black pixel. Passing that extreme guarantees AA over every underlying RGB
  pixel without cross-origin canvas sampling.
- Retaining the existing midpoint and endpoint opacities limits visual change
  while the added 50% stop protects all cover text and the page marker.

## Follow-ups

- Bundle CJK fonts in a separate item. A new CJK dependency is multi-megabyte
  and, after Order 109 removed `skipFonts`, `html-to-image` would base64-inline
  it into every RedNote PNG and ZIP export page.
- The font follow-up must choose code-point subsetting or scoped/lazy loading,
  define an explicit export-embedding policy, and add a fontless-client
  tofu/glyph smoke test.
