# Campaign title is optional: NULL, not empty string

## Backlog item

**Make campaign title optional by allowing NULL product_name end to end** — a sub-item of
*Unify campaign creation into ONE screen and delete the 4-type picker*.

Goal: let a creator ship a campaign without naming it, without any downstream surface
rendering a blank or a literal `null`.

## Decisions

1. Drop `NOT NULL` from `campaigns.product_name`. NULL is the untitled representation.
2. **Never persist `''`.** The writer converts a blank input to NULL at the DB boundary. Every
   downstream fallback in the app uses `??` or `||`; `''` passes a `??` guard, so an empty string
   would have produced a blank prompt identity line, an export filename beginning with `-`, a
   RedNote cover plan its own validator rejects, and a squatted empty `utm_campaign=`.
3. Add **no** blank/whitespace CHECK. A CHECK would turn a legacy blank row into an update
   failure, and NULL already carries the meaning.
4. One shared `campaignDisplayName` / `displayNameOrUntitled` renders `Untitled campaign` at every
   UI surface. It uses `||`, not `??`, so a legacy `''` reads as untitled too. The i18n key already
   existed and was reused rather than re-added.
5. **Do not route poster transcripts or alt text through the placeholder.** `Untitled campaign` is
   not text the artwork contains; `derivePosterTranscript` already tolerates an absent title and
   returns its own generic short alt.
6. Search stays **locale-free**: `campaignFilters` matches the raw name, URL, id and status, never
   the translated placeholder, so results cannot depend on the active language. The campaign id was
   added to the match set so an untitled campaign remains findable.
7. Export filenames fall back to `campaign-<id>`, gated on **the sanitized stem being empty** rather
   than on the title being blank. `sanitizeFilenamePart` replaces `/\W+/g`, which is ASCII-only, so
   two different CJK titles already collapsed to the same separator-only stem. Gating on the
   sanitized result fixes that pre-existing collision as well. A title that survives sanitization is
   returned verbatim, so titled campaigns keep their exact filename bytes.
8. `utm_campaign` is **omitted** when the title is absent or blank, while `utm_source`,
   `utm_medium` and `utm_content` are still appended. This revises decision 2 of
   [2026-07-18-utm-passthrough](./2026-07-18-utm-passthrough.md), which assumed a stored
   `product_name` always exists.
9. `view` gates attribution on `placement_code` **alone**. Requiring a string `campaign_name` would
   have discarded the whole attribution object for an untitled campaign, silently dropping
   `utm_source`, `utm_medium` and `utm_content` — the per-placement join key — rather than just the
   campaign name. `log_visit_attributed`'s `jsonb_build_object` is untouched; it is byte-pinned.
10. `analyze` normalizes the title **once** into `(untitled)` for prompts, and separately into
    `this product` for persisted copy (`poster_content.headline` is typed `string`, and
    `brand_essence` is painted). Three prompt branches previously interpolated the raw value with no
    fallback at all, which would have told the model the product is named `null`.
11. `splitRedNoteSourceCopy` synthesizes a non-empty cover title. Punctuation-only draft copy yields
    no usable segments, so a blank title plus real-but-punctuation-only copy also produced a plan
    `parseRedNotePostPlan` rejects, rendering as `invalid`. The synthesized value is locale-free and
    deterministic because it runs in the Deno bundle and is persisted into
    `poster_content.rednote_post`.

## Reasoning

The untitled state has to be representable *and* distinguishable. NULL is both; `''` is neither,
because the codebase's fallback idiom (`??`) treats it as a present value. Every place the title is
consumed then divides cleanly into three groups: UI surfaces that need a human placeholder, machine
surfaces (filenames, search, UTM keys) that need a stable non-empty token or an omission, and
generated-content surfaces that need a value the pipeline's own validators accept.

Widening the type first made `tsc` enumerate 13 of the read sites. The remainder — three JSX children,
the edge functions, and the sole writer — are invisible to `tsc` (`functions/` and `tests/` are outside
every program, and JSX children accept `null`), so they were found by grep and by executing the
helpers directly.

## Known follow-up

The title is still not snapshotted onto `poster_generations`, so `utm_campaign` reflects the campaign's
*current* name rather than the name in force when a visit was logged. Renaming a campaign therefore
retroactively changes attribution. Unchanged by this item; recorded here and in
[2026-07-18-utm-passthrough](./2026-07-18-utm-passthrough.md).

An untitled product campaign still paints a placeholder identity (`this product`) into the fallback
poster zone when the model supplies no headline. Whether an untitled poster should instead omit its
identity zone is a product decision left open.
