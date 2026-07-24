# Campaign-wide unique visitors

## Backlog item

**Analytics campaign-level Unique visitors sums per-placement uniques**

Compute campaign visits and distinct visitors from the same non-bot campaign
scan set by extending `campaign_breakdowns`, while retaining per-placement
uniqueness in the comparison table.

## Decisions

1. Return campaign-wide `visits` and `unique_visitors` from the existing
   `campaign_breakdowns` RPC.
2. Count both values over the RPC's non-bot `filtered` scan population.
3. Keep `placement_stats` and its per-placement distinct counts unchanged.
4. Use the campaign-wide counters for the summary and repeat-visit share.
5. Show unavailable summary values when the campaign breakdown request fails.

## Reasoning

The first-party visitor hash is derived only from the global visitor salt and
cookie, so one visitor retains the same hash across a campaign's placements.
Counting distinct hashes over the campaign therefore deduplicates
cross-placement scans.

The visit RPC derives each scan's placement, campaign, and owner identifiers
from the same placement row, and application roles cannot insert scans
directly. The non-bot campaign population is consequently the union of the
non-bot placement populations, so campaign visits equal summed placement
visits while campaign uniques cannot exceed campaign visits.

Extending the existing authenticated RPC avoids another request, another grant
surface, and duplicated filtering. Returning both summary counters from one
filtered set also keeps repeat-visit share internally consistent.

## Follow-ups

- A database constraint tying each scan's denormalized campaign and owner
  identifiers to its placement remains deferred because it is broader than
  this analytics correction.
