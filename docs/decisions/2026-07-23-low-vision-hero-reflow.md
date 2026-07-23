# Low-vision hero reflow

## Backlog item

**Low-vision zoom/reflow: hero H1 clips under WCAG text-spacing at 280px + overdraws artwork at 200%**

The landing hero H1 wraps under WCAG text spacing, and the <=767px hero becomes an in-flow grid so enlarged text reflows the poster stage instead of clipping or overdrawing it; the wizard selected label wraps and inputs use a minimum height. The change is CSS-only and leaves normal-size rendering unchanged.

## Decisions

1. Allow the landing H1 to wrap and remove fixed grid-track minimums so enlarged text remains inside the copy column.
2. Keep the mobile poster stage full-width and visually anchored 25px above the hero bottom, but place it in a second grid row so expanded copy pushes it down.
3. Retain public-surface clipping for intentional poster offsets and relax only the mobile hero's local clipping boundary.
4. Show the complete selected campaign type by wrapping it instead of truncating it.
5. Replace the shared input's fixed height with an intrinsic height and a 36px minimum.
6. Cover WCAG text spacing, text-only resizing, label wrapping, and input line-box containment with browser geometry assertions.

## Reasoning

Wrapping and in-flow layout address both narrow reflow and enlarged text without trying to detect browser zoom. Preserving the existing fractional tracks, stage dimensions, poster coordinates, and minimum control height keeps normal rendering stable. Invariant-based browser checks are more reliable than pixel snapshots across font-rendering environments.

## Follow-ups

Visually confirm that the poster stage and following section do not overlap at 320px with 200% text.
