# Campaign rename: editable after creation, forward-only for artwork

## Backlog item

**Order-147** — *A campaign name can never be changed after creation — no rename anywhere,
`/edit` + `/settings` 404 — yet the name is baked into printed posters, export filenames and
`utm_campaign`, so a typo is only escapable by deleting the campaign.*

## Verified before implementing

- The write path already existed and is RLS-covered. `product_name` is nullable
  (`db/schema.sql`) with no CHECK, and appears in both the INSERT and UPDATE column grants for
  `authenticated`. **No migration is required** — the affordance was the only missing piece.
- The ticket's route probes were accurate: `/campaigns/:id/edit` and `/campaigns/:id/settings`
  do not exist. `App.tsx` delegates to `SessionApp.tsx`, whose only campaign routes are
  `/campaigns/new`, `/campaigns/:id`, `.../placements`, `.../analytics` and a `*` catch-all.
- No ADR rejects a rename. `2026-07-28-optional-campaign-title` constrains *how* the title is
  written (NULL, never `''`) and its "known follow-up" section already anticipated this item.

## Decisions

1. **One control, in the editor toolbar**, beside `Delete campaign` — where every other
   campaign-field mutation already lives (`poster_format`, `platform_hint`, QR settings,
   `status`). It reuses the existing `toolbar-confirm-wrap` / `toolbar-confirmation` popover
   pattern rather than introducing a new interaction idiom.
2. **Not an inline-editable breadcrumb**, which the ticket floated as an alternative. The name
   renders in the shared `campaign-bar` (`AppShell.CampaignTabs`), and `.campaign-identity` is
   `display: none` below 700px — an affordance placed only there would silently not exist on
   mobile. Because all three campaign surfaces read that same bar, one write still renames the
   editor, placements and analytics together.
3. **The writer is shared with the wizard.** `normalizeCampaignTitleWrite` is the single
   normalizer for `campaigns.product_name`; the wizard's inlined `productName.trim() || null`
   now calls it. Two independent writers of a column whose empty representation is load-bearing
   would eventually drift, and `''` is exactly the value the prior ADR went to some length to
   keep out of the database.
4. **The field is seeded with the RAW stored title, never the rendered label.** Seeding from
   `campaignDisplayName` would put the translated `Untitled campaign` placeholder into the input,
   and saving it would persist a *different literal string per active language* as a real title.
5. **Save is disabled unless the NORMALIZED value differs** (`campaignTitleWriteChanged`). This
   makes trimming-only edits and a legacy `''` row both correctly no-ops, so opening the popover
   and pressing Save cannot issue a pointless write. Clearing a real title *is* a change, and
   persists NULL.
6. **Forward-only for artwork, and the copy says so.** Existing `poster_generations` keep the
   pixels they were painted with; the popover states *"Posters already generated keep their
   current text."* This matches the immutability of generation snapshots everywhere else.
7. Focus moves into the input on open, and Escape closes. The trigger opens a panel whose sole
   purpose is text entry, so leaving focus on the trigger would repeat the defect class of
   Orders 111 / 123 / 150.

## The ticket's one unachievable clause

The ticket asked for a deliberate choice between retro-applying and forward-only `utm_campaign`,
and recommended forward-only. **Forward-only `utm_campaign` is not reachable from a UI change.**
`log_visit` builds attribution by reading `v_campaign.product_name` **live** at redirect time
(`db/schema.sql:893`), and `log_visit_attributed`'s `jsonb_build_object` is byte-pinned. So a
rename necessarily changes the `utm_campaign` of *future* visits to already-printed codes.

Renaming therefore does not rewrite history — visits already logged keep their recorded values —
but it does change attribution for future scans of existing posters. That is a pre-existing
property of the schema, recorded as a known follow-up in
[2026-07-28-optional-campaign-title](./2026-07-28-optional-campaign-title.md) and
[2026-07-18-utm-passthrough](./2026-07-18-utm-passthrough.md), and is unchanged by this item.
Making it truly forward-only requires snapshotting the title onto `poster_generations` or
`placements` and reading it there — a schema change, deliberately out of scope for a UI fix.

## Not done

Placements still cannot be renamed (noted in Order-144 and reconfirmed by Order-147). The
placement label is a different column on a different table with its own creation flow; it is not
folded in here.
