# Amazon product-title assist

## Backlog item

**Amazon product-title assist**

Goal: reduce manual campaign setup by best-effort prefilling only the product
name from a supported Amazon product URL without turning listing content into
generation evidence.

## Decisions

1. Implement Verdict B: look up only the product title and offer it as a
   blank-field wizard prefill. Do not import bullets, descriptions, claims,
   prices, images, or listing text into generation context.
2. Keep lookup on a new `amazon-product-lookup` function path. It does not call
   or modify `_sourceAcquisition.ts`, `AMAZON_RECIPE`, or the Amazon branch in
   `analyze`; generation continues to say the Amazon URL was intentionally not
   fetched and continues to use seller-provided copy and images.
3. Require a ten-character ASIN in a supported Amazon product path. Convert the
   request to `https://www.amazon.com/dp/<ASIN>` before I/O. Existing supported
   short links remain valid campaign sources, but title assist degrades to
   manual entry when no ASIN can be derived.
4. Extract title evidence in this order: `#productTitle`, JSON-LD `Product.name`,
   then `og:title`. Reject CAPTCHA, robot-check, and automated-access block
   pages before considering any embedded title.
5. Run a bounded raw HTML fetch and the existing capture service concurrently.
   The raw path manually follows at most three redirects, validates HTTPS,
   exact Amazon host, public DNS, and port on every hop, requires the final ASIN
   to match, and reads at most 1 MB. Capture is fallback title evidence only
   when its existing `final_url` resolves to the same ASIN.
6. Extend the edge-side `CaptureResult` mapping to retain the capture service's
   existing `title` and `final_url` fields as optional `pageTitle` and
   `finalUrl`. Make no capture-service code or deployment change.
7. Authenticate and validate before calling the existing
   `consume_capture_preview_quota()` RPC. Invalid input consumes no quota; an
   admitted lookup consumes the same paid-capture budget as website preview.
   Add no migration or new quota state.
8. Expose only sanitized `found` or `unavailable` HTTP 200 bodies. Use bounded
   structured errors for 400, 401, 405, 422, 429, and 503; never return
   upstream URLs, status text, exception messages, or database details.
9. On URL blur, request a title only while Product name is blank. Deduplicate by
   ASIN, abort stale work on URL/use-case/manual-name changes, and re-check both
   URL and blankness before applying a response. A miss is localized inline
   guidance; Product name stays required and lookup can never block generation.
10. Persist no lookup response and add no automatic retry. The seller remains
    responsible for confirming or replacing the suggested title.

## Reasoning

A title removes the highest-friction repetitive input while avoiding the
quality, policy, and provenance risks of treating a retail page as creative
evidence. A separate endpoint makes the exception explicit and testable without
weakening the established no-I/O generation boundary.

Canonicalization removes tracking and attacker-controlled path/query bytes
before fetch. Per-hop network checks and final-ASIN matching protect both the
raw and browser fallback paths from redirects changing the target. Concurrent
capture keeps fallback latency bounded, while the existing quota supplies one
authoritative per-user cost limit.

Blank-only, stale-safe prefill preserves user intent. Returning unavailable as
ordinary data keeps Amazon blocking behavior from becoming a campaign-creation
failure.

## Follow-ups

- Measure lookup success, block rate, and quota pressure before expanding the
  extracted fields or adding cache/persistence.
- Product Advertising API integration still requires an eligible Associates
  account and a separate credential, data-use, and retention review.
- Regional marketplace and bare-ASIN support remain out of scope until their
  marketplace-resolution contracts are explicit.
