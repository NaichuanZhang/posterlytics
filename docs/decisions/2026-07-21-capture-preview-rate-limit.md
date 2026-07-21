# Capture-preview server-side rate limit

## Backlog item

**Eager website capture and pre-generation asset preview**

Goal: put an authoritative per-user cost boundary in front of every paid
capture-preview Chromium attempt.

## Decisions

1. Enforce quota in `capture-preview` after authentication and request
   validation, but before recipe resolution and source acquisition. Invalid
   requests do not consume quota; every admitted capture attempt does, including
   attempts that later time out or degrade.
2. Allow six admitted preview captures in any rolling ten minutes and thirty in
   any rolling twenty-four hours per authenticated user. At the 15-second edge
   deadline, this bounds one user to 90 Chromium-seconds per ten minutes and 450
   seconds per day while leaving room for normal retries and URL iteration.
3. Record admitted attempts in `capture_preview_attempts`. Repeated normalized
   URL and color combinations count independently because this slice adds no
   preview cache. Delete attempts older than twenty-four hours opportunistically;
   denied checks insert nothing and cannot extend the lockout window.
4. Admit work only through the no-argument
   `consume_capture_preview_quota()` RPC. It derives identity from `auth.uid()`,
   rejects a missing identity, and takes a transaction-scoped advisory lock on a
   64-bit hash of that user before pruning, counting, or inserting.
5. Keep the RPC `SECURITY DEFINER` with
   `search_path = pg_catalog, public, pg_temp`. A PL/pgSQL function invocation
   runs inside one implicit database transaction, so the advisory transaction
   lock spans every statement and releases automatically when that transaction
   ends. The admitted row is inserted before `allowed = true` returns.
6. Enable RLS on the attempt table and revoke every table privilege from
   `PUBLIC`, `anon`, and `authenticated`. Grant authenticated users only RPC
   execution; the RPC returns only `allowed` and `retry_after_seconds`, never
   counts, thresholds, or remaining quota.
7. Return a sanitized retryable HTTP 429 with code `rate_limited` and a bounded
   `Retry-After` value when denied. Treat RPC errors and malformed or empty RPC
   results as a sanitized retryable HTTP 503 and fail closed before acquisition.
8. Keep preview optional in the wizard. Rate limiting shows dedicated friendly
   copy, never auto-retries, and never disables Generate. Analyze and the
   first-generation eager-capture reuse path are unchanged.

## Reasoning

An exact rolling attempt ledger avoids the boundary double-burst of fixed
windows. The per-user advisory lock serializes concurrent callers without
holding a database transaction across Chromium or HTML work. At most thirty
live rows are retained per active user, while denied scripts create no rows.

Consuming quota before the paid boundary is conservative: an edge failure after
admission can spend quota without completing capture, but no failure can create
unmetered work. Using `auth.uid()` and withholding table privileges prevents a
caller from charging another user or rewriting the ledger.

## Follow-ups

1. Add capture-preview operational metrics if traffic warrants a separate
   service-level objective.
2. A first-class persisted preview/cache remains a separate slice; this quota
   deliberately does not make repeated URL and color captures free.
