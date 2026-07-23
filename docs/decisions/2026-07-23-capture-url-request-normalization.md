# Capture URL request normalization

## Backlog item

**Capture preview sends noncanonical website URLs**

Canonicalize valid website URLs before capture-preview requests while preserving
the existing invalid-input recovery and eager-capture persistence behavior.

## Decisions

1. Canonicalize valid website URLs with `normalizeCaptureUrl()` before the
   capture-preview POST.
2. Reject unnormalizable input locally without a network round-trip, using the
   existing `invalid_source_url` warning and non-blocking generation behavior.
3. Keep the raw URL prop snapshot as the request-staleness identity and do not
   write the normalized URL back into the controlled input.
4. Leave eager-capture persistence unchanged because the server already echoes
   the normalized URL as `preview.sourceUrl`.

## Reasoning

Sending the canonical URL removes avoidable server normalization differences
and gives capture and eager adoption the same identity. Comparing the current
raw prop with the raw request snapshot still detects real input edits; comparing
raw input with the normalized request would reject every successful response
whose input needed normalization. Local rejection preserves the existing
recoverable UX while avoiding a paid or rate-limited request that cannot
succeed. Keeping persistence sourced from the server response preserves its
existing byte-identical contract.

## Follow-ups

None.
