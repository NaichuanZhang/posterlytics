# Analytics integrity

## Backlog item

**Analytics integrity - real country data + no bot inflation**

Goal: populate coarse visit geography and keep crawler traffic out of user-facing analytics while retaining the raw visit rows.

## Decisions

1. Resolve geography from request metadata before using an external service. Check the Cloudflare `cf-ipcountry`/`cf-ipcity` pair first, followed by equivalent Vercel, CloudFront, and `x-geo-*` pairs supported by the helper.
2. When no valid country header arrives, resolve the first proxy-provided client address through the HTTPS `ipwho.is` endpoint, requesting only `success`, `country_code`, and `city`.
3. Cap the fallback lookup at 800 ms, abort it at the deadline, and fail open to null geography on every lookup, parsing, or timeout failure.
4. Store an ISO 3166-1 alpha-2 country code and, when supplied at no additional lookup cost, a city capped at 120 characters. Do not retain latitude, longitude, the source address, or provider payload.
5. Continue writing bot scans, but exclude rows whose `device` is `bot` in `placement_stats` and every audience breakdown.
6. Add `bots_filtered` to the campaign breakdown JSON and render `Bots filtered: N` below the summary. Keep the `placement_stats` row shape unchanged.
7. Replace the four-argument `log_visit` function with a six-argument function whose trailing country and city arguments default to null. Let the new view function retry the old four-argument call only when its geo-aware call errors.

## Reasoning

1. CDN metadata is immediate and avoids disclosing an address to another processor. Deno Subhosting exposes request headers and a forwarded address but does not guarantee a dedicated geo API, so relying only on a geo header would leave some requests as Unknown; calling a provider first would disclose every address unnecessarily.
2. `ipwho.is` offers a keyless HTTPS lookup with country and city in one response and supports field selection. Country-only services would lose city despite no meaningful savings, while a paid database or bundled GeoIP dataset adds key management and update work that this traffic level does not justify.
3. The 800 ms deadline is well below the two-second ceiling and bounds redirect impact during provider failure. A two-second timeout would protect reliability but impose too much worst-case latency; an unbounded fetch could prevent the tracked redirect from completing.
4. Alpha-2 codes keep header and provider results consistent. City is useful and comes free in the selected response, while coordinates are more identifying and are not used by analytics. SQL validates country and bounds city again so direct RPC calls cannot bypass the edge normalization.
5. Query-time filtering preserves the complete raw event history and allows bot classification to improve later. Dropping bots during ingestion would make audits impossible, while counting them in totals or non-device breakdowns would continue inflating trusted analytics.
6. A campaign-wide count is the clearest low-cost trust signal. Adding bot counts to every placement row would change the stable table-returning RPC and clutter the comparison; omitting the count would hide why raw rows and displayed totals differ.
7. Defaulted trailing arguments keep an already-deployed four-field caller valid after the migration. The view-side retry also covers the inverse rollout order. Retaining an overloaded four-argument function would duplicate behavior and can make PostgREST overload resolution ambiguous.

## Follow-ups

- Monitor fallback latency and provider limits. Prefer a guaranteed first-party Subhosting geo header or a managed provider if traffic outgrows the keyless service.
- Existing Unknown geography is not backfilled because Posterlytics intentionally retained no source addresses from historical scans.
