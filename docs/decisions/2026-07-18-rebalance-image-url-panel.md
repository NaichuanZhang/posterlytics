# Rebalance Image URL panel

## Backlog item

**Visual fix: rebalance Image URL panel in reference picker**

Goal: make the URL option read as one balanced unit beside the image dropzone without clipping its placeholder.

## Decisions

1. Put the label on a full-width first row and group the link icon with the URL control on the second row.
2. Keep the panel at `min-height: 88px` with `13px` padding, and center the two-row group with `align-content: center`.
3. Keep the shared `34px` icon tile, `12px` row gap, and `32px` input/button height.
4. Shorten the placeholder to `https://…/pic.jpg`.
5. Reduce the plus glyph from `17px` at `2.5` stroke to `16px` at `2` stroke while retaining the `32px` button.

## Reasoning

1. The row structure aligns the icon directly with the input. An `align-self` or margin offset would only compensate for the current font metrics and would drift if the label or control changes.
2. Centering the group makes the top and bottom whitespace equal while preserving the dropzone's established height. Reducing the panel height or changing the sibling would disturb the paired layout.
3. Reusing the dropzone's icon geometry preserves equal visual weight between the two choices. Shrinking the tile or horizontal gap would buy little input width and make the pair less consistent.
4. The compact example leaves deliberate spare width at the grid's `220px` minimum. Widening the grid would affect responsive wrapping, while keeping the full domain would remain vulnerable to font and browser differences.
5. The glyph was the source of excess weight, not the control box. Shrinking the button would break the glued control alignment and reduce its target; muting the accent fill would weaken the add action.

## Follow-ups

- Automated screenshot regression coverage is deferred because the repository has no component visual-test harness; this change is checked in the running UI instead.
- Broader reference-picker sizing and responsive-layout changes are deferred because the paired-card structure already behaves correctly outside this local balance issue.
