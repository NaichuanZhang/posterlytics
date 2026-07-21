# Stateless website capture preview

## Backlog item

**Preview website evidence before generation**

Goal: let a creator inspect the visual evidence available from a website
without creating a campaign, generation, or stored asset.

## Decisions

1. Expose capture preview through an authenticated, stateless-evidence
   `capture-preview` edge function; it writes no preview, campaign, generation,
   or Storage objects. The later server-side quota slice records only bounded
   capture-admission rows.
2. Accept only `website_product` requests and reject invalid or Amazon sources
   before capture. Private-network enforcement remains inside the capture
   service, and those failures return as degraded HTTP 200 preview responses.
3. Reuse the existing capture service. Capture runs before HTML acquisition,
   and an unsuccessful capture skips the raw HTML fetch.
4. Return bounded source image URLs, normalized colors and fonts, capture
   provenance, design tokens, the requested color scheme, and the inline
   style-board data URL. Preview itself never calls evidence rehosting or
   style-board upload helpers.
5. Use the installed InsForge SDK's authenticated `rawFetch` surface so the
   client can pass an `AbortSignal`. Keep one request in flight and discard any
   response whose request token or source URL is stale.
6. Keep preview optional. Capture failure, missing evidence, and individual
   image load failures do not disable the Generate action. A later submit-time
   adoption step may persist complete matching evidence for first-generation
   reuse; the preview endpoint remains stateless.
7. Sanitize capture-service errors at the edge. The browser receives only the
   stable error code, retryability, and a generic safe message, never upstream
   hosts, URLs, ports, stack details, or Playwright text.
8. Enforce the hard server-side per-user quota recorded in
   `2026-07-21-capture-preview-rate-limit.md`. Client debounce, single-flight,
   cooldown behavior, and the capture deadline remain UX and defense-in-depth
   controls rather than the authoritative cost boundary.

## Reasoning

A stateless request gives creators immediate evidence before any campaign
exists. Submit-time adoption owns the later ownership, expiry, invalidation,
and cleanup contracts. Reusing the generation capture service keeps one SSRF
boundary and one rendering implementation; a separate preview service would
duplicate both.

Capture-first ordering avoids fetching a target after the browser service has
already rejected it. Returning capture errors as data preserves a useful,
retryable UI while distinguishing edge-detectable request mistakes from
service-level degradation.

## Follow-ups

1. Submit-time persistence, provenance, freshness, and first-generation reuse
   are recorded in `2026-07-21-single-paid-eager-capture.md`.
2. Add capture-preview operational metrics if traffic warrants a separate
   service-level objective.
