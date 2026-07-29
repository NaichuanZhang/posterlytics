# Unified campaign creation

## Backlog item

**Unify campaign creation into ONE screen and delete the 4-type picker** — an eight-item epic
(items 1–7 implemented; item 8, multi-source capture fan-out, deferred).

Goal: replace the four-type use-case picker with a single creation screen, and align the poster
editor and the whole data model behind one notion of what a campaign is.

## Decisions verification forced

Four assumptions in the original epic plan were overturned by checking them against the code and the
database before implementing. Recording them so they are not re-litigated.

1. **`use_case` stays explicit and persisted — it is never derived from evidence.** The plan assumed
   the unified screen could infer `use_case` from the submitted evidence. It cannot: `social_cover`
   and `rednote_post` rows are byte-identical across every persisted evidence column, and their
   recipes differ only by a literal, so an evidence-only derivation mis-resolves the prompt goldens
   and makes RedNote take an unbudgeted designer call. `resolveCreationUseCase` maps an *explicit*
   intent — `hasSourceUrl`, `primarySourceUrlIsAmazon`, and an `outputKind` control — onto the
   literal, which is written once at INSERT, frozen by `campaigns_guard_source_intent_update`, and
   read only from the `poster_generations` snapshot. The `outputKind` segmented control (single
   poster vs multi-page post) is the *only* discriminator between a social cover and a RedNote post.

2. **The QR band is a property of the `poster_format` slug — there is no `qr_enabled` column.** "QR
   on/off" is not an independent axis: *has a QR band* is a property of the format. So a "QR off"
   poster needs a distinct bandless slug per aspect (`a4_2x3_cover`, `yt_thumb_16x9_cover`,
   `luma_1x1_cover` alongside the existing `rednote_cover_3x4`), the QR/destination/placement policy
   is keyed on the format's band via `campaigns_banded_format_destination_required`, and the band
   stays encoded in the immutable `poster_generations.poster_format` snapshot. The editor and wizard
   share one `qrPolicy` module so a QR toggle and a format select never disagree.

3. **The 2:3 bandless twin is a 2:3 full-bleed print, not A4.** A bandless descriptor cannot reuse
   the 1240×1754 A4 sheet: with no footer band to matte, artwork and sheet must be equal, so a
   bandless 2:3 twin is 980×1470 and is labeled a full-bleed print, not an A4 poster.

4. **Multi-source capture is deferred (item 8).** The screen accepts up to three source URLs, but
   only `source_urls[0]` is ever fetched or captured: `/capture` takes one scalar URL, there is no
   compositor to merge several style boards, and the style-board and eager-capture pointers are
   scalar. URLs 2–3 contribute declared textual context only.

## Additional decisions taken during implementation

- **"QR off clears the destination" was rejected.** Item 3's acceptance asked for it, but it
  violates the already-applied `campaigns_source_urls_required` and contradicts
  [2026-07-24-social-cover-qr-stitch](./2026-07-24-social-cover-qr-stitch.md), which had already
  ruled that destination presence — not band geometry — is the link-validity invariant. A bandless
  poster may belong to a campaign with a live tracked link.
- **Bandless campaigns may omit a destination** ([6a](../../migrations/20260729000000_bandless-optional-destination.sql)).
  The unified screen has no always-visible destination field — the destination is revealed by the QR
  toggle — so "paste a URL, leave QR off" must be legal. `campaigns_source_urls_required` keeps only
  its source-URL half; the destination requirement lives entirely in the banded-format CHECK. The
  placement guard then requires a destination for *any* placement, since a bandless campaign can now
  reach a placement path without one.
- **The creation use case keys on the FIRST source URL's host, not "all Amazon".** `product_url` is
  `source_urls[0]`; keying on "every URL is Amazon" would resolve a mixed set whose first URL is
  Amazon to `website_product` while persisting an Amazon `product_url` — a pair `useCaseSourceMismatch`
  rejects terminally.
- **Creation always runs the full pipeline (`yolo`).** The mid-pipeline asset-review preference lives
  only in the editor; on creation, submit always lands on the campaign poster.
- **The editor offers the composed QR + format control for every tracking-enabled use case**, not
  just `social_cover` (item 7). Without this, a bandless campaign switched to a banded format in the
  editor would write a banded slug with no destination and fail the CHECK.

## Follow-ups recorded elsewhere

- The campaign title is still not snapshotted onto `poster_generations`, so `utm_campaign` reflects
  the campaign's current name — see [2026-07-28-optional-campaign-title](./2026-07-28-optional-campaign-title.md).
- Multi-source capture fan-out (a compositor and plural style-board pointers) is epic item 8.
