# Low-vision wizard reflow

## Backlog item

**Low-vision zoom/reflow: wizard summary and asset selection collide or clip under combined text enlargement**

Campaign-summary definition rows and the non-compact asset-selection control reflow within their clipped wizard surfaces under combined WCAG 1.4.12 text spacing and 200% text.

## Decisions

1. Replace the summary's fixed definition grid with wrapping flex rows, and allow terms and values to wrap without ellipsis.
2. Add two-level wrapping to the non-compact asset-selection control so its label and segmented group can reflow independently from the buttons within the group.
3. Keep button text on one line so constrained controls move whole buttons to a new flex line.
4. Scope the control change to the wizard variant; leave the generic segmented control, compact editor control, Campaigns filter, and workspace tabs unchanged.
5. Retain the wizard surfaces' overflow clipping for rounded-surface containment.
6. Cover normal-size layout and combined WCAG text spacing plus 200% text at 900px, one pixel above the two-column breakpoint, with geometry invariants.

## Reasoning

Flexible bases preserve the normal two-column summary appearance while allowing enlarged values to move below their terms and wrap inside the fixed 280px rail. Wrapping both the asset control and its nested segmented group handles the two independent constraints without changing shared controls or React behavior. This CSS-only follow-on to Order-106 fixes collision and clipping while leaving normal-size appearance unchanged.

## Follow-ups

None.
