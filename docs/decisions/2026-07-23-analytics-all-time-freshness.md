# Analytics all-time freshness

## Backlog item

**Label Analytics totals as All time and show view freshness**

Label Analytics totals as `All time` and show the locale-formatted completion time of the latest successful client fetch (`View updated: {date}`). This is client fetch-completion time, not server ingestion freshness.

## Decisions

1. Keep the existing campaign summary semantics and label its totals `All time`.
2. Set view freshness only when both client analytics requests transition from loading to complete without an error.
3. Clear freshness when the campaign changes, and do not advance it after a failed refresh.
4. Format the timestamp in the active locale and expose its ISO value through a semantic `time` element without another live-region announcement.
5. Retain the landing phrase `See what moved.`

## Reasoning

The label makes the current unbounded totals explicit. A successful load-transition timestamp tells the user when this browser view last completed fetching while avoiding a false claim about server ingestion or event recency. The existing refresh toast already announces manual completion, so a second live region would be redundant.

## Follow-ups

- Add server-backed time-series data and date ranges as a separate Vision item.
