# Single-paid eager website capture

## Backlog item

**Eager website capture and pre-generation asset preview**

Goal: reuse confirmed preview evidence in the first generation so one creator
action produces exactly one paid Chromium capture.

## Decisions

1. Keep `capture-preview` stateless, but return capture provenance, the requested
   color scheme, full design tokens, and the inline JPEG style board needed for
   later adoption.
2. Adopt evidence only during wizard submit, after the draft campaign exists.
   Snapshot the device color scheme once and pass that same value to both
   adoption matching and `enqueue_poster_generation`.
3. Upload the adopted board from the authenticated SPA to the public `assets`
   bucket at
   `style-board/{campaignId}/eager/{captureId}.jpg`. Existing storage RLS permits
   owner writes without a key-prefix restriction.
4. Persist source URL snapshots in `brand_assets`, captured design tokens, board
   pointers, and three nullable campaign markers:
   `eager_capture_url`, `eager_capture_color_scheme`, and
   `eager_captured_at`. Grant authenticated users update access only to those
   evidence fields. Add no table, RPC, trigger, generation column, or frozen
   tuple field.
5. Reuse only for a first `website_refresh` generation with no parent, product
   scenario, `website_product` use case, website acquisition mode, an exact
   normalized URL and color match, a timestamp no more than 30 minutes old,
   usable complete tokens, safe matching board pointers under the eager key
   prefix, valid source assets, and value-identical campaign/generation
   snapshots.
6. Make reuse an additive analyze branch. It skips only `captureSite`; HTML
   fetch, asset extraction, source-snapshot fallback, and generation-scoped
   rehosting still run. Final poster assets therefore never hot-link adopted
   source URLs.
7. When a candidate is stale, mismatched, or incomplete, run the existing
   acquisition path and ignore first-generation eager board pointers. When no
   eager candidate exists, preserve the prior analyze output and trace shape.
8. Treat adoption and invalidation as best effort. Bound the upload/update flow
   to four seconds, log a stable warning code on failure, and enqueue normally
   so analyze performs its regular capture.
9. Clear eager fields when the wizard submits without an exactly matching
   preview, including after URL or use-case changes. A newer successful preview
   atomically replaces the campaign snapshot through one update.
10. Record `eager_capture_reused` and a reason code in the analyze trace when an
    eager candidate exists. Log each actual capture-service boundary call with
    host and color only, never the full URL or credentials.

## Reasoning

The enqueue RPC already copies campaign evidence into the first generation.
Using that inheritance avoids a schema or RPC expansion and lets analyze verify
that it received the exact adopted snapshot before skipping paid work.

Uploading at adoption is required because inline data URLs must not enter the
database. The authenticated storage path uses existing ownership controls and
keeps generation workers independent from browser memory.

The optimization deliberately retains cheap HTML acquisition and asset
rehosting. Reusing those outputs would either persist raw HTML or allow
short-lived, CORS-sensitive source URLs into poster generation. A conservative
gate costs an extra capture when uncertain but cannot reduce evidence quality.

Analyze owns freshness enforcement because it has the campaign, inherited
generation snapshot, actual queued color scheme, and final source-mode policy
at the point where capture would occur. Wizard clearing improves hygiene but is
not a security or correctness boundary.

## Follow-ups

1. A durable server-side per-user capture quota remains deferred. This slice
   does not add a capture entry point, and a process-local edge counter would
   not provide reliable enforcement.
2. Add lifecycle cleanup for superseded eager style-board objects if storage
   growth becomes material. Failed campaign updates already remove their newly
   uploaded object, but successful replacement uses a new provenance key.
3. Add capture-preview operational metrics if traffic warrants a separate
   service-level objective.
