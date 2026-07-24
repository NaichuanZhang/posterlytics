# Public secondary tap targets

## Backlog item

**Order 126: Tap-target follow-up for secondary public controls**

Goal: raise every standalone public control to a real 44px minimum target without changing its visible typography or reintroducing horizontal overflow at 280px.

## Decisions

1. Treat Order 126 as a follow-up to Order 100 and retain its actual-element sizing approach instead of using pseudo-element hit areas.
2. Increase authentication-mode buttons from 38px to 44px tall.
3. Give "See the workflow" and both authentication back-control variants a 44px minimum size with vertical-only padding. Compensate the authentication back control with a negative top margin and reduced bottom margins so its text and surrounding spacing remain visually stable.
4. Treat the footer Posterlytics brand as a standalone link and include it in the existing 44px brand rule.
5. Leave the Shane Colella, Barcelona, and Kundan Ramisetti photography links unpadded because they are inline targets in one attribution block and qualify for the WCAG 2.5.5 inline-text exception.
6. Broaden the 280px marketing smoke's minimum-target selectors to every rendered standalone control, while keeping overlap checks scoped to neighboring header and authentication controls.
7. Exercise the normal back link and the password-recovery back button in the same responsive smoke.

## Reasoning

The named gaps are caused by the controls' actual boxes, so sizing those elements directly gives deterministic pointer geometry. Vertical-only padding preserves link width, and the compensated authentication margins avoid shifting its heading. Curated smoke selectors cover standalone controls without forcing the off-canvas skip link or inline footer attribution links into a 44px layout that would disrupt their intended flow.

## Follow-ups

None.
