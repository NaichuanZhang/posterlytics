# Tracked redirect carries attribution: UTM passthrough

## Backlog item

**Tracked redirect carries attribution - UTM passthrough**

Goal: carry placement-level Posterlytics attribution through each QR redirect into the campaign owner's analytics.

## Decisions

1. Add `utm_source=posterlytics`, `utm_medium=qr`, `utm_campaign=<campaign name>`, and `utm_content=<placement code>`.
2. Use the campaign's stored `product_name` for `utm_campaign`. Preserve its human-readable form and let the URL API encode it.
3. Add each UTM key independently only when that exact key is absent. Existing destination query parameters, including owner-provided UTM values, remain authoritative.
4. Parse and serialize destinations with the platform `URL` API so query parameters are inserted before fragments. Return the original destination byte-for-byte when parsing or decoration throws.
5. Add `log_visit_attributed`, returning destination URL, campaign name, and placement code as JSON from the same transaction that logs the scan. Keep `log_visit` returning text as a wrapper around the new function.
6. Have the view try `log_visit_attributed`, then the geo-aware and original text `log_visit` contracts only when the newer call errors. The steady-state redirect remains one RPC round trip.
7. Keep the four-parameter template fixed for now. Owners can override any individual parameter by including it in the destination URL.

## Reasoning

1. The source and medium values make Posterlytics QR traffic consistent across customers, while campaign name and placement code provide the two useful attribution levels.
2. Campaign names are readable in GA and are fixed after creation in the current product UI. UUIDs are more technically stable but opaque to customers, while a separate slug would duplicate state without improving the current lifecycle.
3. Per-key preservation supports deliberate partial templates, such as an owner's existing `utm_campaign` combined with Posterlytics source, medium, and placement content. Replacing the full query or all UTM values would destroy owner intent.
4. Structured URL handling preserves query semantics and fragments without hand-built delimiter logic. Redirect availability is more important than attribution, so malformed or unusual unparseable values must fail open.
5. Replacing the return type of the deployed `log_visit` function would break the old view when the database migrated first. A named successor avoids PostgREST overload ambiguity, and the compatibility wrapper keeps one implementation of scan logging.
6. The retry sequence covers either deploy order. Fallback responses redirect without new UTM values during the brief mixed-version window rather than making a second campaign query or blocking a scan.
7. Configurable templates require persistence, validation, UI, and rules for required or duplicate keys. That complexity is not needed for the defined interoperability outcome, and existing destination parameters already provide an escape hatch.

## Follow-ups

- Reconsider a persisted tracking slug if campaign renaming becomes a supported workflow.
- Add configurable attribution templates only after customer demand establishes which fields and validation rules are needed.
