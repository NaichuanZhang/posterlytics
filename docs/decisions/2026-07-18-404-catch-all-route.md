# 404 catch-all route

## Backlog item

**404 catch-all route**

Goal: give signed-in users a recoverable not-found view instead of a blank page for unknown URLs.

## Decisions

1. Add the final `*` route to `SessionApp` and wrap it in the existing `ProtectedPage`.
2. Render a focused `NotFoundPage` inside `AppShell` with Campaigns and Page not found breadcrumbs.
3. Reuse `EmptyState` with a file-question icon, concise explanatory copy, and a primary Back to campaigns link to `/`.
4. Lazy-load the page through the same authenticated activity scope as the other signed-in pages.
5. Extend the authenticated marketing UI smoke test to verify the not-found heading, preserved primary rail, lack of horizontal overflow, and working recovery link.
6. Name the rail's `<nav>` landmark Primary navigation instead of assigning that label to the surrounding `<aside>`.

## Reasoning

1. A final React Router wildcard handles every stale or mistyped application URL without changing explicit-route matching. Protecting it preserves the current signed-out redirect behavior; an unprotected shell would expose signed-in navigation to guests and bypass the authenticated activity context.
2. Pages in the signed-in application own their shell, and the breadcrumb treatment matches existing missing-campaign states. Putting the fallback outside `AppShell` would recreate the loss of navigation that this feature is intended to fix.
3. The shared empty-state component already defines the app's visual language for unavailable content. A custom 404 layout or new CSS would duplicate established styles, while an inline error notice would provide less visible recovery guidance.
4. Following the existing lazy page pattern avoids adding the fallback to the initial session bundle. Rendering it through `AuthenticatedPage` also keeps generation activity available in the rail.
5. This behavior depends on router, auth, provider, and navigation integration, which a pure helper test cannot exercise. The existing Playwright suite already covers guest and authenticated routing, so extending it gives direct coverage without introducing a component-test framework or a source-text assertion.
6. The primary links belong to a navigation landmark, while the rail also contains branding and account controls outside that landmark. Labeling the `<nav>` gives assistive technology and role-based tests the correct named landmark; labeling only the `<aside>` leaves the navigation unnamed.

## Follow-ups

None.
