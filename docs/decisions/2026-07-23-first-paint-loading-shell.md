# First-paint loading shell

## Backlog item

**First-paint loading shell**

Serve a brand-matched accessible loading shell + noscript fallback in static HTML so first byte paints something for both / and /signin, then reuse a localized React equivalent across both sign-in Suspense boundaries — no SSR, no routing/preload changes.

## Decisions

1. Put a lightweight accessible status shell and a JavaScript-disabled fallback directly in the static HTML.
2. Reuse visually identical localized React markup for the outer session boundary and the sign-in route boundary.
3. Let React clear the root container atomically on its first commit instead of manually removing the static shell.
4. Keep routing, image preloads, authenticated loading states, and skeleton regions unchanged.

## Reasoning

Static HTML can paint before the application bundle executes and works for both SPA entry paths without adding server rendering. Reusing the same shell across the two first-paint Suspense boundaries avoids a visual transition while preserving localization once React mounts. React-owned replacement avoids a blank interval or competing DOM ownership.

## Follow-ups

1. Evaluate full SSR or prerendering separately.
2. Add immutable-cache and Brotli delivery tuning at the hosting layer.
3. Consider route-aware prefetching after measuring route chunk latency.
4. Replace eligible anchors with client navigation in a separate routing change.
