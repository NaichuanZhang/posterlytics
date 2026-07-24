# Public view status accessibility

## Backlog item

**Order 132: Public /view status page recovery target and byline contrast**

Give the shared public `/view` recovery link a ≥44px tap target and render its secondary byline at 6.35:1 (solid `#5b5b5b`, dropping opacity) without changing copy or response behavior.

## Decisions

1. Size the recovery anchor itself with `inline-flex`, centered alignment, a 44px minimum height, 11px vertical padding, 16px horizontal padding, and border-box sizing.
2. Retain the recovery link's `#3d5f56` color, weight, spacing, URL, and localized text.
3. Remove the byline's group opacity and use solid `#5b5b5b` text on the existing `#faf7f1` background.
4. Keep the change inside the self-contained `statusHtml` template and leave statuses, headers, tracking, localization, and redirect behavior unchanged.
5. Cover every locale and status-kind combination with deterministic string-level assertions.

## Reasoning

The `/view` response has no external stylesheet, so sizing the actual inline-styled anchor applies the same 44px public-control convention without relying on the SPA. Border-box sizing keeps padding inside the minimum target while flex alignment centers both localized labels.

Solid `#5b5b5b` on `#faf7f1` has 6.35:1 contrast, above the 4.5:1 WCAG AA requirement for the 12.48px byline. The retained `#3d5f56` link has 6.61:1 contrast on the same background. A solid byline color is predictable and remains visually secondary to the `#444` body text.

## Follow-ups

None.
