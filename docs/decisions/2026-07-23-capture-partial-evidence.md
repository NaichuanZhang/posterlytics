# Capture partial evidence

## Backlog item

**Capture service loses usable evidence near its deadline**

Stop optional sampling at a 10-second soft budget, return one-frame partial
evidence when usable, and preserve timeout ordering and observable outcomes.

## Decisions

1. Sample the top frame first and stop optional lower-frame work at a 10-second
   soft budget.
2. Return a successful partial response only when both normalized design tokens
   and a JPEG frame are available. Use the raw first JPEG and skip Sharp merge
   and pixel extraction on this constrained path.
3. Retain a 13-second hard service abort below the edge caller's unchanged
   15-second timeout.
4. Log one privacy-safe outcome for every accepted capture attempt with only
   the normalized target host, duration, outcome, frame count, and process
   uptime.

## Reasoning

Top-frame-first sampling preserves the highest-value evidence before optional
page-depth work consumes the budget. Requiring both tokens and an image keeps a
partial response adoptable by the existing eager-capture checks rather than
turning incomplete output into a misleading success.

The fast-path board is the raw 1280x800 quality-78 JPEG. It is slightly larger
than the 960-wide merged board, which is acceptable because downstream code
makes no dimension assumption. Skipping Sharp work protects the hard deadline,
while the 13-second and 15-second ordering leaves the edge caller time to
receive the service response.

Host-only structured logs distinguish complete, partial, timeout, and error
outcomes without exposing URL paths, queries, titles, error text, or page
content.

## Follow-ups

- Cold-start latency is not fully fixable in application code. Container
  minimum instances or synthetic warming remain operational levers to apply
  based on the new outcome and warm-duration logs.
- Best-effort navigation after a `goto` timeout, so a timed-out navigation can
  still attempt a top-frame screenshot, is deferred because it changes the
  current navigation failure contract.
