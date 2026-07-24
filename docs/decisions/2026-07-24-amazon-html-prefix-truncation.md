# Amazon HTML prefix truncation

## Backlog item

**Amazon HTML prefix truncation**

Amends the 2026-07-21 Amazon product-title assist decision so the 1 MB bounded reader truncates and parses the retained prefix instead of rejecting an otherwise usable oversized page.

## Decisions

1. Keep the Amazon raw HTML cap at 1 MB and retain only the response prefix up
   to that exact byte limit.
2. Drop the `Content-Length` rejection. Treat the response stream as the sole
   byte authority because the header is advisory.
3. Preserve every existing pre-read invariant: per-hop safe URL and public DNS
   validation, redirect limits, successful status, unchanged final ASIN, and
   HTML content type.
4. Keep lookup best-effort. Oversized pages resolve from their retained prefix
   to `found` or `unavailable`; they never become a hard lookup error.

## Reasoning

Amazon product titles can appear well before the end of pages larger than 1 MB.
Retaining the bounded prefix recovers that evidence without increasing memory
cost. Counting retained stream bytes avoids trusting inaccurate or missing
length headers, and cancelling at the cap releases the remaining response
stream.

The reader remains the final step after all redirect, network, identity, status,
and content-type checks, so truncation does not weaken the fetch boundary.
Existing concurrent all-settled lookup handling keeps raw or capture failures
on the ordinary `unavailable` path.

## Follow-ups

None.
