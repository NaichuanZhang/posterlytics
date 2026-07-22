import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const migration = readFileSync(
  new URL(
    '../migrations/20260719091412_social-cover-use-case.sql',
    import.meta.url,
  ),
  'utf8',
)
const foundationMigration = readFileSync(
  new URL(
    '../migrations/20260719061604_use-case-foundation.sql',
    import.meta.url,
  ),
  'utf8',
)
const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')

test('social migration makes campaign URLs nullable only behind a use-case check', () => {
  assert.match(
    migration,
    /ALTER COLUMN product_url DROP NOT NULL,\s+ALTER COLUMN destination_url DROP NOT NULL/,
  )
  assert.match(baseline, /product_url TEXT,\s+product_name TEXT NOT NULL/)
  assert.match(baseline, /destination_url TEXT,\s+style_profile JSONB/)

  for (const [sql, referenceOnlyCheck] of [
    [migration, /use_case = 'social_cover'/],
    [baseline, /use_case IN \('social_cover', 'rednote_post'\)/],
  ] as const) {
    const constraint = namedConstraint(sql, 'campaigns_source_urls_required')
    assert.match(constraint, referenceOnlyCheck)
    assert.match(
      constraint,
      /product_url IS NOT NULL AND destination_url IS NOT NULL/,
    )
  }
})

test('both snapshot tables accept social_cover while preserving scenario equivalence', () => {
  for (const [prefix, sql] of [
    ['campaigns', migration],
    ['poster_generations', migration],
    ['campaigns', baseline],
    ['poster_generations', baseline],
  ] as const) {
    const constraint = namedConstraint(sql, `${prefix}_use_case_valid`)
    for (const useCase of [
      'website_product',
      'amazon_listing',
      'social_cover',
      'event',
    ]) {
      assert.match(constraint, new RegExp(`'${useCase}'`))
    }
  }

  for (const [prefix, sql] of [
    ['campaigns', foundationMigration],
    ['poster_generations', foundationMigration],
    ['campaigns', baseline],
    ['poster_generations', baseline],
  ] as const) {
    assert.match(
      sql,
      new RegExp(
        `CONSTRAINT ${prefix}_scenario_use_case_consistent\\s+CHECK \\(\\(scenario = 'event'\\) = \\(use_case = 'event'\\)\\)`,
      ),
    )
  }

  assert.doesNotMatch(
    migration,
    /DROP CONSTRAINT (?:campaigns|poster_generations)_scenario_use_case_consistent/,
  )
})

test('platform_hint is a nullable social-only campaign target and frozen snapshot', () => {
  assert.match(
    migration,
    /ALTER TABLE public\.campaigns[\s\S]*ADD COLUMN platform_hint TEXT/,
  )
  assert.match(
    migration,
    /ALTER TABLE public\.poster_generations\s+ADD COLUMN platform_hint TEXT/,
  )
  assert.match(baseline, /use_case TEXT NOT NULL DEFAULT 'website_product',\s+platform_hint TEXT/)

  for (const [sql, name, referenceOnlyCheck] of [
    [migration, 'campaigns_platform_hint_valid', /use_case = 'social_cover' OR platform_hint IS NULL/],
    [migration, 'poster_generations_platform_hint_valid', /use_case = 'social_cover' OR platform_hint IS NULL/],
    [baseline, 'campaigns_platform_hint_valid', /use_case IN \('social_cover', 'rednote_post'\) OR platform_hint IS NULL/],
    [baseline, 'poster_generations_platform_hint_valid', /use_case IN \('social_cover', 'rednote_post'\) OR platform_hint IS NULL/],
  ] as const) {
    const constraint = namedConstraint(sql, name)
    assert.match(constraint, /platform_hint = BTRIM\(platform_hint\)/)
    assert.match(constraint, /char_length\(platform_hint\) BETWEEN 1 AND 80/)
    assert.match(constraint, referenceOnlyCheck)
  }

  assert.match(
    migration,
    /GRANT INSERT \(platform_hint\) ON public\.campaigns TO authenticated/,
  )
  assert.match(
    migration,
    /GRANT UPDATE \(platform_hint\) ON public\.campaigns TO authenticated/,
  )
})

test('frozen-generation guard is the current body plus null-safe platform_hint', () => {
  const previous = lastFunction(
    foundationMigration,
    'guard_poster_generation_update',
  )
  const current = lastFunction(migration, 'guard_poster_generation_update')
  const withoutHint = current
    .replace(/\n\s+NEW\.platform_hint,/, '')
    .replace(/\n\s+OLD\.platform_hint,/, '')

  assert.equal(withoutHint, previous)
  assert.deepEqual(frozenTuple(current), [
    'id',
    'campaign_id',
    'user_id',
    'parent_generation_id',
    'generation_mode',
    'instruction',
    'reference_images',
    'poster_format',
    'scenario',
    'use_case',
    'platform_hint',
    'trace_schema_version',
    'asset_selection_mode',
    'created_at',
  ])
  assert.deepEqual(
    frozenTuple(lastFunction(baseline, 'guard_poster_generation_update')),
    frozenTuple(current),
  )
})

test('historical social enqueue stays pinned while the baseline extends it', () => {
  const historical = lastFunction(migration, 'enqueue_poster_generation')
  assert.match(historical, /IF v_campaign\.use_case = 'social_cover'/)
  assert.match(
    historical,
    /RAISE EXCEPTION 'Social cover generation requires at least one reference image\.'/,
  )
  assert.match(
    historical,
    /WHEN p_refresh_website OR v_campaign\.use_case = 'social_cover'\s+THEN 'website_refresh'/,
  )

  const current = lastFunction(baseline, 'enqueue_poster_generation')
  const campaignLookup = current.indexOf('SELECT *\n  INTO v_campaign')
  const minimumCheck = current.indexOf(
    "IF v_campaign.use_case IN ('social_cover', 'rednote_post')",
  )
  assert.ok(campaignLookup >= 0 && campaignLookup < minimumCheck)
  assert.match(
    current,
    /jsonb_array_length\(v_reference_images\) < 1[\s\S]*NULLIF\(BTRIM\(item\.value ->> 'url'\), ''\) IS NOT NULL/,
  )
  assert.match(
    current,
    /RAISE EXCEPTION 'Social cover generation requires at least one reference image\.'/,
  )
  assert.match(
    current,
    /v_campaign\.use_case IN \('social_cover', 'rednote_post'\)[\s\S]*THEN 'website_refresh'/,
  )

  for (const enqueue of [historical, current]) {
    assert.match(
      enqueue,
      /WHEN v_campaign\.current_generation_id IS NULL THEN v_campaign\.use_case\s+ELSE v_parent\.use_case\s+END,\s+v_campaign\.platform_hint,/,
    )
    assert.match(
      enqueue,
      /WHEN v_generation\.generation_mode = 'website_refresh' THEN 'analyze'/,
    )
  }
})

test('same-input retry copies the frozen platform hint instead of the mutable target', () => {
  for (const sql of [migration, baseline]) {
    const retry = lastFunction(sql, 'retry_poster_generation')
    assert.match(
      retry,
      /v_previous_generation\.use_case,\s+v_previous_generation\.platform_hint,\s+v_previous_generation\.event_details/,
    )
    assert.doesNotMatch(
      retry,
      /v_previous_generation\.use_case,\s+v_campaign\.platform_hint/,
    )
  }
})

test('historical tracking guards stay social-only while the baseline extends them', () => {
  for (const [sql, useCaseCheck, message] of [
    [migration, /v_use_case = 'social_cover'/, /Social cover campaigns cannot have placements\./],
    [baseline, /v_use_case = 'social_cover'/, /Social cover campaigns cannot have placements\./],
  ] as const) {
    const placementGuard = lastFunction(sql, 'guard_placement_tracking_policy')
    assert.match(placementGuard, /FROM public\.campaigns/)
    assert.match(
      placementGuard,
      /WHERE id = NEW\.campaign_id\s+AND user_id = NEW\.user_id\s+FOR UPDATE/,
    )
    assert.match(
      placementGuard,
      /IF NOT FOUND THEN\s+RAISE EXCEPTION 'placement campaign not found or not owned by placement user'\s+USING ERRCODE = '23503'/,
    )
    assert.match(placementGuard, useCaseCheck)
    assert.match(placementGuard, message)
    assert.match(
      sql,
      /BEFORE INSERT OR UPDATE OF campaign_id ON public\.placements/,
    )

    const campaignGuard = lastFunction(sql, 'guard_campaign_tracking_policy')
    assert.match(
      campaignGuard,
      sql === migration
        ? /NEW\.use_case = 'social_cover'/
        : /NEW\.use_case IN \('social_cover', 'rednote_post'\)/,
    )
    assert.match(campaignGuard, /FROM public\.placements/)
    assert.match(
      sql,
      /BEFORE UPDATE OF use_case ON public\.campaigns/,
    )
  }
})

test('visit attribution stays historically social-only and extends the baseline', () => {
  for (const [sql, guardText] of [
    [migration, "v_campaign.use_case = 'social_cover'"],
    [baseline, "v_campaign.use_case IN ('social_cover', 'rednote_post')"],
  ] as const) {
    const logVisit = lastFunction(sql, 'log_visit_attributed')
    const guard = logVisit.indexOf(guardText)
    const insert = logVisit.indexOf('INSERT INTO public.scans')
    assert.ok(guard >= 0 && guard < insert)
    assert.match(logVisit, /v_campaign\.destination_url IS NULL/)
  }
})

test('activity and every baseline generation insert carry the new snapshots', () => {
  for (const sql of [migration, baseline]) {
    const activity = lastFunction(sql, 'generation_activity')
    assert.match(activity, /g\.use_case/)
    assert.match(activity, /'use_case', use_case/)
  }

  const inserts = baseline.match(/INSERT INTO public\.poster_generations \(/g) ?? []
  const snapshotInserts = baseline.match(
    /INSERT INTO public\.poster_generations \([\s\S]*?\buse_case,\s+platform_hint,\s+event_details/g,
  ) ?? []
  assert.equal(inserts.length, 5)
  assert.equal(snapshotInserts.length, inserts.length)
})

test('migration relies on the platform transaction and contains no manual transaction', () => {
  assert.doesNotMatch(migration, /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/m)
})

function namedConstraint(sql: string, name: string): string {
  const start = sql.lastIndexOf(`CONSTRAINT ${name}`)
  assert.ok(start >= 0, `Missing constraint ${name}`)
  const nextConstraint = sql.indexOf('CONSTRAINT ', start + 1)
  const statementEnd = sql.indexOf(';', start)
  const end = nextConstraint >= 0 && nextConstraint < statementEnd
    ? nextConstraint
    : statementEnd
  return sql.slice(start, end)
}

function lastFunction(sql: string, name: string): string {
  const starts = [
    ...sql.matchAll(
      new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\(`, 'g'),
    ),
  ]
  const start = starts.at(-1)?.index ?? -1
  const end = sql.indexOf('\n$$;', start)
  assert.ok(start >= 0 && end > start, `Missing function ${name}`)
  return sql.slice(start, end + 4)
}

function frozenTuple(guard: string): string[] {
  const tuple = guard.match(/IF \(\s*([\s\S]*?)\s*\) IS DISTINCT FROM \(/)
  assert.ok(tuple)
  return [...tuple[1].matchAll(/NEW\.([a-z_]+)/g)].map((match) => match[1])
}
