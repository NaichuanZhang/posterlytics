# Stateless website capture preview

## Backlog item

**Preview website evidence before generation**

Goal: let a creator inspect the visual evidence available from a website
without creating a campaign, generation, or stored asset.

## Decisions

1. Expose capture preview through an authenticated, stateless
   `capture-preview` edge function; it writes no database rows or Storage
   objects.
2. Accept only `website_product` requests and reject invalid or Amazon sources
   before capture. Private-network enforcement remains inside the capture
   service, and those failures return as degraded HTTP 200 preview responses.
3. Reuse the existing capture service. Capture runs before HTML acquisition,
   and an unsuccessful capture skips the raw HTML fetch.
4. Return only bounded source image URLs, normalized colors and fonts, and the
   inline style-board data URL. Preview never calls evidence rehosting or
   style-board upload helpers.
5. Use the installed InsForge SDK's authenticated `rawFetch` surface so the
   client can pass an `AbortSignal`. Keep one request in flight and discard any
   response whose request token or source URL is stale.
6. Keep preview optional and independent from generation. Capture failure,
   missing evidence, and individual image load failures do not disable the
   Generate action.
7. Sanitize capture-service errors at the edge. The browser receives only the
   stable error code, retryability, and a generic safe message, never upstream
   hosts, URLs, ports, stack details, or Playwright text.
8. Deliberately defer a hard server-side per-user rate limit or quota because
   this stateless slice has no database-backed counter. Current cost controls
   are authentication, an explicit capture button, client debounce,
   single-flight and cooldown behavior, and the capture service deadline. A
   durable per-user quota must land with the persistence slice.

## Reasoning

A stateless request gives creators immediate evidence without introducing
ownership, expiry, invalidation, or cleanup contracts. Reusing the generation
capture service keeps one SSRF boundary and one rendering implementation; a
separate preview service would duplicate both.

Capture-first ordering avoids fetching a target after the browser service has
already rejected it. Returning capture errors as data preserves a useful,
retryable UI while distinguishing edge-detectable request mistakes from
service-level degradation.

## Follow-ups

1. Consider optional preview persistence only if a later workflow needs reuse,
   provenance, or freshness guarantees.
2. Add capture-preview operational metrics if traffic warrants a separate
   service-level objective.
3. Keep analyze preview reuse deferred until durable invalidation semantics
   exist.
4. Add a durable per-user capture quota with the persistence slice; do not rely
   on a process-local edge counter.
