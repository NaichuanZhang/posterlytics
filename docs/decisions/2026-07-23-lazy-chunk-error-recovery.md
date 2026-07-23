# Lazy-chunk error recovery

## Backlog item

**Offline/lazy-chunk failure crashes app to blank root**

Catch post-mount lazy-import and network failures so the application remains
usable and can recover after connectivity returns.

## Decisions

1. Place one localized error boundary inside `I18nProvider` and above `App` so
   it covers both application branches, the lazy session shell, and all routes.
2. Treat browser connectivity as authoritative when choosing error copy:
   dynamic-import failures are connection errors only while the browser reports
   offline, and otherwise use the generic unexpected-error state.
3. Reload the document for chunk and connection retries because `React.lazy`
   caches rejected import promises; remount generic failures in place once.
4. Automatically reload on the first `online` event while a connection error is
   visible, and remove the listener when the boundary unmounts.
5. Swallow the decorative hero-motion import failure and leave the static hero
   in its settled layout.
6. Keep the Order-107 static first-paint shell, routing, backend, and deployment
   behavior unchanged.

## Reasoning

A boundary inside the router would miss failures in the session-shell import
and the public pre-router branch. Clearing boundary state cannot retry a
rejected module-scoped lazy component, while a document reload reconstructs
the module graph and preserves the current URL. Online-authoritative copy keeps
stale or missing chunks from being mislabeled as an offline connection.

## Follow-ups

None.
