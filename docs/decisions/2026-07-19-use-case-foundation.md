# Persisted use-case foundation

## Backlog item

**Use-case foundation: persisted intent column, backfill, snapshot plumbing,
registry**

Goal: persist campaign and generation intent without changing the current
wizard, editor, or generation recipes.

## Decisions

1. `use_case` records intent (`website_product`, `amazon_listing`, or `event`);
   `scenario` remains the legacy pipeline-shape discriminator (`product` or
   `event`). Both tables enforce `scenario = 'event'` if and only if
   `use_case = 'event'`.
2. Historical rows classify as `event` when `scenario = 'event'`, as
   `amazon_listing` only when an HTTP(S) URL has one of the exact supported
   Amazon hostnames, and as `website_product` otherwise. The migration first
   normalizes any unrecognized scenario to `product`. Poster format never
   infers intent.
3. Enqueue copies `poster_format` from the campaign target on every generation,
   but copies `use_case` with the scenario rule: campaign on the first version,
   parent generation on iterations. Retry copies the failed generation's
   snapshot.
4. Authenticated clients receive both INSERT and UPDATE column grants for
   `use_case`, matching the wizard's shared insert/update payload. A
   `SECURITY DEFINER` trigger allows `product_url` and `use_case` corrections
   only until the first generation row exists; generation snapshots freeze
   both `scenario` and `use_case`.
5. `src/lib/useCases.ts` is the dependency-free registry for input
   requirements, allowed/default poster formats, and tracking policy. It does
   not contain or accept prompt recipes.
6. `social_cover` is reserved for a later vertical slice and is not accepted by
   this cycle's database checks or registry.

## Reasoning

1. Separating intent from pipeline shape preserves event routing while removing
   URL classification as the eventual source of runtime intent.
2. Exact-host classification reproduces historical Amazon behavior without
   accepting lookalike domains. Defensive scenario normalization closes the
   pre-existing unconstrained client-write hole before constraints validate
   production rows.
3. Scenario-style inheritance keeps an iteration tied to the intent of the
   version it extends, while format remains the explicitly editable next-output
   target.
4. Granting UPDATE avoids breaking the wizard's unconditional second write.
   The cross-row trigger provides the required correction window and serializes
   safely with enqueue's campaign row lock.
5. A pure registry can be shared by the SPA and bundled edge code in later
   ranks without creating separate policy maps.
6. Social covers need URL-less input, recipe, format, and tracking changes that
   cannot be inferred safely from existing full-bleed rows.

## Follow-ups

- Resolve generation recipes from the persisted snapshot on the server.
- Split the wizard and editor by use case.
- Ship `social_cover` only with its source, prompt, format, and tracking
  behavior.
