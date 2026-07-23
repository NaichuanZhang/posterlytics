# Session expiry recovery

## Backlog item

**Recover cleanly when an authenticated session expires**

Detect terminal refresh failures globally, return the user to sign-in with
context, and preserve local work without exposing backend errors.

## Decisions

1. Detect terminal InsForge refresh failures at the shared SDK fetch boundary
   using a cross-origin-safe pathname match.
2. Synchronize React auth state to signed out with a `session_expired` reason,
   then redirect protected and home routes to `/signin` while preserving `next`.
3. Preserve owner-scoped local drafts on involuntary expiry. Only explicit
   sign-out clears drafts.
4. Show localized session-expiry guidance and never surface raw InsForge error
   text from the campaigns query.

## Reasoning

All SDK HTTP paths, including PostgREST retries and refresh, use the configured
fetch adapter. Matching `/api/auth/refresh` by pathname rather than document
origin works when the app and InsForge API are on different production origins.
The adapter observes only the URL and status and returns the original response
without consuming its body.

A single publisher avoids divergent expiry detection. Its idempotent,
sticky-until-consumed bus lets an early refresh failure reach a later
`AuthProvider` subscriber without duplicate state transitions. Reasoned routes
retain the interrupted destination, while owner-scoped draft envelopes remain
safe for the same user after signing in again.

## Follow-ups

- Cold-load session-ended guidance is covered alongside in-tab expiry.
- Other authenticated pages inherit the global fetch-boundary recovery without
  page-specific error-handling changes.
