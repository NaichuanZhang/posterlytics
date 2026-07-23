# Analytics geo reliability

## Backlog item

**Analytics country is 100% Unknown in production**

Goal: Deno/GCP emits no geo header so every scan uses the forwarded-IP to `ipwho.is` path; add fail-open `request_geo` observability while keeping the 800 ms on-path timeout, and canonicalize country buckets at display time so Analytics merges legacy names with ISO-2 values and labels null geography `Location unavailable`.

## Decisions

1. Keep the on-path `ipwho.is` deadline at 800 ms and add structured `request_geo` events that distinguish resolved, missing-IP, timeout, HTTP, invalid-response, and request-error outcomes.
2. Use Deno's forwarded client address with the existing provider path. Do not add a fictional Deno geo header, another provider, or any raw address to logs, diagnostics, or storage.
3. Emit geo events only after a visit RPC returns a destination, and keep logging synchronous and fail-open so observability cannot alter the redirect.
4. Canonicalize country buckets at display time. Merge current ISO-2 values with known legacy English names, localize ISO-2 labels, and show null or `Unknown` geography as `Location unavailable`.
5. Do not migrate or rewrite historical scans. New writes already store validated ISO-2 values, while display-time aggregation preserves the raw audit history.
6. Rebuild and redeploy `analyze`, `capture-preview`, `designer`, `generation-worker`, `hero`, `reference-import`, and `view` whenever this shared-module change is released.

## Reasoning

1. Deno/GCP emits none of the four country headers currently checked, so every production scan depends on the forwarded-IP provider path. That path previously collapsed every failure to null, making its actual failure mode unknowable.
2. Geo resolution is awaited before the tracked 302. Raising the deadline before measuring outcomes would trade redirect latency for an unproven reliability gain; 800 ms remains the safer bound.
3. A second provider would expand address disclosure and availability dependencies without evidence that it fixes the production failure.
4. Current SQL accepts only two-letter country values, proving full-name rows are legacy. UI aggregation repairs mixed-format presentation without destructive data changes or a database rollout.
5. Raw IP remains request-local and is discarded after lookup. The event schema contains only coarse outcome metadata and timing.

## Follow-ups

- Measure the deployed `request_geo` outcome distribution before changing the timeout or provider.
- Expand the explicit legacy alias table only when additional historical values are observed.
