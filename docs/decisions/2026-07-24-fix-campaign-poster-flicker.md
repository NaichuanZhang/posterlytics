# Eliminate Campaign Poster Flicker

## Backlog item

**Eliminate Campaign Poster Flicker** - Background refreshes retain the mounted
poster, and late QR eligibility samples the existing hero without replacing it.

## Decisions

1. Campaign and generation hooks show full loading state only until their
   current route ID has completed one SDK response. Both successful and returned
   query-error responses mark that ID as loaded.
2. Same-ID refreshes retain referential identity when their JSON-shaped response
   is deeply unchanged. Arrays remain order-sensitive and record key order is
   ignored.
3. `AiPoster` keeps one hero node per image source. One layout effect resets a
   changed source and samples an already-complete image when QR/footer eligibility
   arrives later.
4. The smoke backend can defer campaign and generation reads so initial loading
   and same-ID background refresh behavior are asserted while requests are
   pending.

## Reasoning

Per-ID loading preserves first-load and route-ID-change feedback without
unmounting a usable poster for background data refreshes. Marking returned
errors as completed preserves retry behavior after a transient query error;
thrown requests keep their existing behavior.

The merged image effect uses the intentionally narrow `[img,
shouldSampleFooter]` dependency list. Source claiming remains the idempotency
boundary, so unrelated renders cannot trigger another sample. This fixes the
production event amplifier identified but not located in
`docs/decisions/2026-07-20-fix-preview-sampling-idempotency.md`: loading state
and the eligibility-prefixed image key were replacing the hero around a late
footer.

Deep equality is a conservative identity win: it never suppresses a real JSON
change because every key, including `updated_at`, is compared. That guarantee
depends on `updated_at` being write-only, so a write changes the fetched value
even when other fields are stable.

## Follow-ups

None.
