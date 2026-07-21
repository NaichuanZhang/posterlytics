# Responsive public pages and touch targets

## Backlog item

**Responsive: 280px content clipping + sub-44px tap targets**

Goal: keep the landing and sign-in flows usable without clipping at 280px and give their named controls 44px touch targets.

## Decisions

1. Remove the global 320px document floor, preserve it on the authenticated `.app-shell`, and set public page roots to a supported 280px minimum.
2. Use a public-only breakpoint below 320px to tighten horizontal spacing, reduce the fixed hero heading size, wrap hero actions, and recover sign-in form width.
3. Size the actual public language selects, header links, and auth inline buttons to at least 44px in both dimensions instead of using overlapping pseudo-element hit areas.
4. Keep public buttons at least 44px tall on mobile and use 16px mobile auth inputs to avoid iOS focus zoom.
5. Extend the marketing Playwright smoke with 280px visibility and touch-target assertions plus overflow checks through 2560px.

## Reasoning

The document-level floor forced both public roots to render 40px wider than a Galaxy Fold cover viewport. Moving the existing authenticated constraint to its real owner preserves dashboard behavior while allowing public pages to reflow independently.

The sub-320 breakpoint isolates composition changes to the failing range. Actual control boxes provide deterministic pointer geometry and avoid adjacent targets competing for an expanded pseudo-element area. Targeted viewport assertions ensure `overflow-x: clip` continues to contain decorative poster art without masking clipped critical content.

## Follow-ups

None.
