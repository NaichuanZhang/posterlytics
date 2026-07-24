# Social cover QR stitch

## Backlog item

**Social Cover QR Stitch**

Keep Social cover full bleed by default while offering an opt-in, destination-backed
QR footer with complete placement tracking.

## Decisions

1. `poster_format` is the single source of truth. Social cover OFF uses the
   existing `rednote_cover_3x4`; ON uses the existing QR-banded
   `rednote_3x4`. No boolean column, format slug, or geometry is added.
2. Tracking is centrally active only when
   `getUseCase(use_case).trackingEnabled` is true and `destination_url` is a
   nonblank string. Tabs, status badges, placement lifecycle, analytics,
   publishing, and tracked-link management use this predicate. QR rendering
   and tracked export additionally require a QR-banded poster descriptor.
3. The predicate preserves existing tracking behavior:

   | Use case | Destination contract | Format example | Tracking active |
   | --- | --- | --- | --- |
   | Website product | Required by `campaigns_source_urls_required` | Bandless `rednote_cover_3x4` | Yes |
   | Amazon listing | Required by `campaigns_source_urls_required` | Bandless `rednote_cover_3x4` | Yes |
   | Event | Required by `campaigns_source_urls_required` | Bandless `rednote_cover_3x4` | Yes |
   | Social cover OFF | Null | `rednote_cover_3x4` | No |
   | Social cover ON | Required and nonblank | `rednote_3x4` | Yes |
   | RedNote post | Ignored by disabled use-case policy | `rednote_cover_3x4` | No |

4. The wizard persists format and destination in one insert. The editor
   persists both in one update, then ensures and reloads placements before
   reloading the campaign. Generation remains blocked while the settings are
   dirty or a banded target lacks a placement.
5. Social cover placements and published visit attribution are permitted only
   with a nonblank destination. Destination-less Social cover and every
   RedNote placement or visit remain rejected by database policy.
6. Prompt action policy checks for a QR band before reference-only artwork
   policy. Full-bleed Social cover and RedNote prompt bytes remain unchanged;
   the new banded Social cover path gets QR-footer instructions in designer and
   hero. `_shared.ts` therefore requires designer, hero, and generation-worker
   rebuilds and redeployment.
7. RedNote keeps its one-option format select and remains untracked. The QR
   switch appears only for Social cover.
8. Reference-only analysis still emits an empty `qr_label`. Banded Social
   cover therefore uses the existing `Scan to start` footer fallback; a custom
   Social cover caption is not required for this slice.

## Reasoning

- Reusing the two established 1242x1656 descriptors keeps layout, export, and
  prompt geometry stable. A new slug or descriptor would duplicate geometry
  without representing a new shape.
- A persisted boolean was rejected because it could drift from
  `poster_format`. Deriving ON/OFF from the format makes save, draft restore,
  generation, and export agree.
- A generic format select (Option A) was rejected because Social cover has one
  product decision, not an open format choice: full bleed or tracked QR.
- Gating tracking on QR-band geometry was rejected because Website, Amazon,
  and Event campaigns can already use bandless formats while their tracked
  links remain valid. Destination presence is the actual link-validity
  invariant.
- Full tracking is required. Rendering a QR without provisioning a placement
  would produce a dead code, so migration, placement lifecycle, attribution,
  editor recovery, and rendering behavior ship together.
- The campaign write must precede placement creation because database policy
  requires the destination first. The format and destination must be atomic so
  the QR-destination check never observes an invalid intermediate row.
- Withholding a banded canvas until its placement code exists prevents an
  empty footer from appearing. Forced placement ensure clears its retry guard
  after failure, so the state remains recoverable.

## Follow-ups

- Deploy the database migration before the rebuilt functions and frontend.
- Rebuild and redeploy designer, hero, and generation-worker with the frontend
  release.
- Consider a Social cover-specific QR caption only if product copy needs to
  differ from the accepted `Scan to start` fallback.
