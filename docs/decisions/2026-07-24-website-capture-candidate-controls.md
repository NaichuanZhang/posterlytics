# Website capture candidate controls

## Backlog item

**Website capture-preview candidate controls**

Keep degraded website evidence visible but disable and explain candidate curation,
and prevent included-candidate controls from clipping at 390px.

## Decisions

1. Keep degraded style boards, candidates, colors, and fonts visible as read-only
   evidence.
2. Disable every candidate curation button when the capture status is not ready,
   and associate those controls with one visible degraded-evidence explanation.
3. Keep the normal candidate instructions for ready evidence and replace them
   with the degraded explanation when curation is unavailable.
4. At `max-width: 520px`, wrap the candidate toggle to a full-width row below
   the priority arrows without changing the evidence grid.
5. Preserve the existing submit contract: error-bearing preview evidence remains
   excluded from eager reuse and clears any eager snapshot at submit.

## Reasoning

An error-bearing response already publishes `null` through `onPreviewChange`, so
the wizard never submits that preview for eager adoption. Allowing its controls
to appear enabled misrepresents both local behavior and the reuse contract.
Native disabled buttons prevent interaction while the visible cards still provide
useful context.

The story's claim that the grid had no responsive reduction was stale. The grid
already changes from four columns to two at `max-width: 700px`, but two columns
still leave insufficient room for two arrows and a labeled toggle at 390px.
Wrapping only the controls at the existing 520px breakpoint preserves the compact
mobile grid, desktop four-column layout, and featured two-column span.

## Follow-ups

None.
