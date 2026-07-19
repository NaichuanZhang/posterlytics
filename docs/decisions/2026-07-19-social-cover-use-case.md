# Social cover URL-less use case

## Backlog item

**Social cover use case - URL-less vertical slice**

Goal: create full-bleed social artwork from references and creative direction,
with an optional platform hint, bandless output, and no tracking surface.

## Decisions

1. `campaigns.product_url` and `destination_url` become nullable. A conditional
   check still requires both for every non-`social_cover` campaign; sentinels
   are not stored.
2. `social_cover` uses `scenario = 'product'`. Scenario remains the stage-graph
   discriminator, while `use_case` selects the reference-only recipe. The
   existing event equivalence invariant remains unchanged.
3. `platform_hint` is a mutable campaign target and an immutable generation
   snapshot, matching the existing `poster_format` target/snapshot model. It is
   nullable, trimmed, limited to 80 characters, and must be null outside
   `social_cover`.
4. The platform input offers RedNote / 小红书, YouTube, Luma, and Instagram,
   plus free-text Other. Stored values remain canonical text rather than a
   database enum.
5. Social cover uses `reference-only` acquisition: no fetch and no capture.
   Every ordinary social version enters analyze again, and enqueue requires at
   least one usable reference image. The wizard and editor enforce the same
   minimum before the server check.
6. `trackingEnabled: false` suppresses default placement creation, campaign
   tabs, tracking controls, analytics queries, and direct tracking routes.
   Database triggers reject placements for social campaigns and reject
   conversion of a campaign that still has placements; visit attribution also
   rejects social campaigns and null destinations defensively.
7. Social cover allows and defaults to `rednote_cover_3x4`, currently the only
   bandless format. Platform names remain platform hints and never become
   format names.

Post-deploy verification is pre-claim only: create a real social cover through
the picker, upload at least one reference, enqueue, verify that the job remains
queued and unclaimed, inspect the generation's `scenario`, `use_case`,
`platform_hint`, format, and references plus the campaign's null URL fields,
then delete the test campaign before a worker can claim the job. Do not run an
AI generation.

## Reasoning

1. Null accurately represents an absent URL and keeps URL-specific behavior
   behind use-case policy instead of leaking a sentinel through redirects,
   UTM decoration, UI, and types.
2. Social artwork uses the product analyze/assets/designer/hero graph without
   the website acquisition step. Adding another scenario would duplicate
   routing state and weaken the existing scenario/use-case invariant.
3. A campaign target lets the editor change the next version's intent, while a
   frozen snapshot makes retries and prompt traces reproducible.
4. Presets make common choices fast, while bounded free text supports new
   platforms without schema churn.
5. User references are the source of truth. Re-analysis ensures reference,
   creative-context, and platform changes affect each new version.
6. Owner RLS alone cannot prevent a determined owner from inserting a
   placement. UI suppression and database integrity are both required for a
   genuine no-tracking use case.
7. A bandless-only registry allowance prevents tracking composition from
   leaking into social artwork and reuses the existing filtering and
   grandfathering machinery.

## Follow-ups

- Run the pre-claim production verification above after deployment; this
  repository task performs no deploy and incurs no AI generation cost.
