# Landing Analytics Copy Truthfulness

## Backlog item

**Landing Analytics Copy Truthfulness** - Align landing UI and metadata with tracked-link visits, estimated unique visitors, and available country data.

## Decisions

1. Replace scan-based landing claims with tracked-link visit language in the
   hero, analytics section, and deployed metadata.
2. Qualify unique visitors as estimated and country data as available in the
   analytics subhead and its Chinese translation.
3. Keep the analytics metric key labels and decorative sample-poster captions
   unchanged.
4. Pin the truthful English and Chinese copy in unit and marketing smoke tests.

## Reasoning

Posterlytics records a visit when a tracked link opens, so visit language
describes the measured event without claiming that every QR scan is observed.
Unique visitors are inferred, and country data may be unavailable, so the
analytics subhead carries those qualifiers in both languages.

The `Visits`, `Unique visitors`, `Devices`, `Operating systems`, and `Countries`
key labels are metric names that match the in-app analytics labels. The captions
in `SamplePoster.tsx:42-43` are decorative rather than analytics claims. Keeping
both concise preserves that consistency while the subhead supplies the
estimation and availability qualifiers.

## Follow-ups

- Defer the Social cover / RedNote workflow discoverability enhancement because
  it is outside Order 136.
- Stale build artifacts (`dist/index.html`, `test-results/`) are regenerated and
  must not be hand-edited.
