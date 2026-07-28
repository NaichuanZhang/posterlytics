import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const migration = readFileSync(
  new URL(
    '../migrations/20260719061604_use-case-foundation.sql',
    import.meta.url,
  ),
  'utf8',
)
const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')

const AMAZON_HOSTS = [
  'amazon.com',
  'www.amazon.com',
  'a.co',
  'amzn.to',
  'amzn.asia',
  'amzn.eu',
]
const HOST_PATTERN =
  '^https?://(?:[^/?#]*@)?([^:/?#]+)(?::[0-9]+)?(?:[/?#]|$)'

test('migration normalizes historical scenarios before classifying both tables', () => {
  const dropGuard = migration.indexOf(
    'DROP TRIGGER poster_generations_guard_update',
  )
  const normalizeCampaigns = migration.indexOf(
    "UPDATE public.campaigns\nSET scenario = 'product'\nWHERE scenario NOT IN ('product', 'event');",
  )
  const normalizeGenerations = migration.indexOf(
    "UPDATE public.poster_generations\nSET scenario = 'product'\nWHERE scenario NOT IN ('product', 'event');",
  )
  const backfillCampaigns = migration.indexOf(
    'UPDATE public.campaigns\nSET use_case = CASE',
  )
  const backfillGenerations = migration.indexOf(
    'UPDATE public.poster_generations AS generation\nSET use_case = CASE',
  )

  assert.ok(dropGuard >= 0 && dropGuard < normalizeCampaigns)
  assert.ok(normalizeCampaigns < normalizeGenerations)
  assert.ok(normalizeGenerations < backfillCampaigns)
  assert.ok(backfillCampaigns < backfillGenerations)
  assert.match(
    migration,
    /UPDATE public\.poster_generations AS generation[\s\S]*WHEN generation\.scenario = 'event' THEN 'event'[\s\S]*FROM public\.campaigns AS campaign[\s\S]*campaign\.id = generation\.campaign_id/,
  )
})

test('backfill uses event precedence and the exact Amazon hostname allowlist', () => {
  const backfills = [
    migrationSlice(
      'UPDATE public.campaigns\nSET use_case = CASE',
      'UPDATE public.poster_generations AS generation\nSET use_case = CASE',
    ),
    migrationSlice(
      'UPDATE public.poster_generations AS generation\nSET use_case = CASE',
      'ALTER TABLE public.campaigns\n  ALTER COLUMN use_case SET DEFAULT',
    ),
  ]

  for (const backfill of backfills) {
    assert.match(
      backfill,
      /WHEN (?:generation\.)?scenario = 'event' THEN 'event'/,
    )
    assert.match(backfill, /THEN 'amazon_listing'/)
    assert.match(backfill, /ELSE 'website_product'/)
    assert.match(backfill, new RegExp(escapeRegExp(HOST_PATTERN)))
    assert.deepEqual(
      [...backfill.matchAll(/'((?:www\.)?amazon\.com|a\.co|amzn\.(?:to|asia|eu))'/g)]
        .map((match) => match[1]),
      AMAZON_HOSTS,
    )
    assert.doesNotMatch(backfill, /poster_format|social_cover/)
  }

  const cases = [
    { scenario: 'event', url: 'https://example.com', expected: 'event' },
    { scenario: 'product', url: 'https://amazon.com/dp/1', expected: 'amazon_listing' },
    { scenario: 'product', url: 'HTTPS://WWW.AMAZON.COM/dp/2', expected: 'amazon_listing' },
    { scenario: 'product', url: 'https://a.co/d/example', expected: 'amazon_listing' },
    { scenario: 'product', url: 'https://amazon.com.evil.org/dp/1', expected: 'website_product' },
    { scenario: 'product', url: 'https://amazon.com@evil.org/dp/1', expected: 'website_product' },
    { scenario: 'product', url: 'https://smile.amazon.com/dp/1', expected: 'website_product' },
    { scenario: 'product', url: 'https://example.com/product', expected: 'website_product' },
  ] as const

  for (const row of cases) {
    assert.equal(classifyHistoricalRow(row.scenario, row.url), row.expected)
  }
})

test('NOT NULL is established before scenario and use-case checks', () => {
  const lastBackfill = migration.indexOf(
    'WHERE campaign.id = generation.campaign_id;',
  )
  const campaignsNotNull = migration.indexOf(
    'ALTER TABLE public.campaigns\n  ALTER COLUMN use_case SET NOT NULL;',
  )
  const generationsNotNull = migration.indexOf(
    'ALTER TABLE public.poster_generations\n  ALTER COLUMN use_case SET NOT NULL;',
  )
  const firstCheck = migration.indexOf(
    'ADD CONSTRAINT campaigns_scenario_valid',
  )

  assert.ok(lastBackfill >= 0 && lastBackfill < campaignsNotNull)
  assert.ok(campaignsNotNull < generationsNotNull)
  assert.ok(generationsNotNull < firstCheck)

  for (const [table, sql] of [
    ['campaigns', migration],
    ['poster_generations', migration],
  ] as const) {
    assert.match(
      sql,
      new RegExp(
        `ALTER TABLE public\\.${table}\\s+ALTER COLUMN use_case SET DEFAULT 'website_product'`,
      ),
    )
    assert.match(
      sql,
      new RegExp(
        `ALTER TABLE public\\.${table}\\s+ALTER COLUMN use_case SET NOT NULL`,
      ),
    )
  }
})

test('both tables constrain scenario, use_case, and their event equivalence', () => {
  for (const [table, prefix] of [
    ['campaigns', 'campaigns'],
    ['poster_generations', 'poster_generations'],
  ] as const) {
    assert.match(
      migration,
      new RegExp(
        `CONSTRAINT ${prefix}_use_case_valid\\s+CHECK \\(use_case IN \\('website_product', 'amazon_listing', 'event'\\)\\)`,
      ),
    )
    const baselineConstraint = constraintBody(
      baseline,
      `${prefix}_use_case_valid`,
    )
    for (const useCase of [
      'website_product',
      'amazon_listing',
      'social_cover',
      'rednote_post',
      'event',
    ]) {
      assert.match(baselineConstraint, new RegExp(`'${useCase}'`))
    }

    for (const sql of [migration, baseline]) {
      assert.match(
        sql,
        new RegExp(
          `CONSTRAINT ${prefix}_scenario_valid\\s+CHECK \\(scenario IN \\('product', 'event'\\)\\)`,
        ),
      )
      assert.match(
        sql,
        new RegExp(
          `CONSTRAINT ${prefix}_scenario_use_case_consistent\\s+CHECK \\(\\(scenario = 'event'\\) = \\(use_case = 'event'\\)\\)`,
        ),
      )
    }

    assert.match(
      baseline,
      new RegExp(
        `CREATE TABLE public\\.${table}[\\s\\S]*?use_case TEXT NOT NULL DEFAULT 'website_product'`,
      ),
    )
  }
})

test('generation guard is swapped around backfill and the baseline adds platform_hint', () => {
  const drop = migration.indexOf('DROP TRIGGER poster_generations_guard_update')
  const backfill = migration.indexOf('UPDATE public.campaigns\nSET use_case = CASE')
  const reinstall = migration.indexOf(
    'CREATE TRIGGER poster_generations_guard_update',
  )

  assert.ok(drop >= 0 && drop < backfill)
  assert.ok(backfill < reinstall)

  assert.deepEqual(frozenTuple(migration), [
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
    'trace_schema_version',
    'asset_selection_mode',
    'created_at',
  ])
  assert.deepEqual(frozenTuple(baseline), [
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
})

test('campaign source intent is correctable only before the first generation', () => {
  // The historical migration is an immutable record of the two-column intent it
  // shipped; the baseline has since gained source_urls (see sourceUrls.test.ts).
  for (const [sql, watchedColumns] of [
    [migration, 'product_url, use_case'],
    [baseline, 'product_url, use_case, source_urls'],
  ] as const) {
    const guard = lastFunction(sql, 'guard_campaign_source_intent_update')
    const noOp = guard.indexOf('NEW.product_url')
    const generationLookup = guard.indexOf(
      'FROM public.poster_generations\n    WHERE campaign_id = OLD.id',
    )

    assert.match(guard, /SECURITY DEFINER/)
    assert.match(guard, /SET search_path = pg_catalog, public, pg_temp/)
    assert.ok(noOp >= 0 && noOp < generationLookup)
    assert.doesNotMatch(guard, /status IN/)
    assert.match(
      sql,
      new RegExp(
        `BEFORE UPDATE OF ${watchedColumns} ON public\\.campaigns`,
      ),
    )
    assert.match(
      sql,
      /GRANT INSERT \([\s\S]*?use_case[\s\S]*?\) ON public\.campaigns TO authenticated/,
    )
    assert.match(
      sql,
      /GRANT UPDATE \([\s\S]*?use_case[\s\S]*?\) ON public\.campaigns TO authenticated/,
    )
  }
})

test('enqueue distinguishes campaign format from scenario-style use_case copying', () => {
  for (const sql of [migration, baseline]) {
    const enqueue = lastFunction(sql, 'enqueue_poster_generation')

    assert.match(
      enqueue,
      /v_campaign\.poster_format,\s+CASE\s+WHEN v_campaign\.current_generation_id IS NULL THEN v_campaign\.scenario\s+ELSE v_parent\.scenario\s+END,\s+CASE\s+WHEN v_campaign\.current_generation_id IS NULL THEN v_campaign\.use_case\s+ELSE v_parent\.use_case\s+END,/,
    )
    assert.doesNotMatch(
      enqueue,
      /current_generation_id IS NULL THEN v_campaign\.poster_format/,
    )
  }
})

test('retry copies format, scenario, and use_case from the failed generation', () => {
  for (const sql of [migration, baseline]) {
    const retry = lastFunction(sql, 'retry_poster_generation')

    assert.match(
      retry,
      /v_previous_generation\.poster_format,\s+v_previous_generation\.scenario,\s+v_previous_generation\.use_case,/,
    )
  }
})

test('every fresh-baseline generation insert writes explicit use_case and platform snapshots', () => {
  const inserts = baseline.match(/INSERT INTO public\.poster_generations \(/g) ?? []
  const useCaseColumns = baseline.match(
    /INSERT INTO public\.poster_generations \([\s\S]*?\buse_case,\s+platform_hint,\s+event_details/g,
  ) ?? []

  assert.equal(inserts.length, 5)
  assert.equal(useCaseColumns.length, inserts.length)
})

function migrationSlice(startMarker: string, endMarker: string): string {
  const start = migration.indexOf(startMarker)
  const end = migration.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start)
  return migration.slice(start, end)
}

function constraintBody(sql: string, name: string): string {
  const start = sql.indexOf(`CONSTRAINT ${name}`)
  const end = sql.indexOf('CONSTRAINT', start + 1)
  assert.ok(start >= 0)
  return sql.slice(start, end > start ? end : undefined)
}

function frozenTuple(sql: string): string[] {
  const guard = lastFunction(sql, 'guard_poster_generation_update')
  const tuple = guard.match(/IF \(\s*([\s\S]*?)\s*\) IS DISTINCT FROM \(/)
  assert.ok(tuple)
  return [...tuple[1].matchAll(/NEW\.([a-z_]+)/g)].map((match) => match[1])
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

function classifyHistoricalRow(
  scenario: string,
  productUrl: string,
): 'event' | 'amazon_listing' | 'website_product' {
  if (scenario === 'event') return 'event'
  const hostname = new RegExp(HOST_PATTERN).exec(productUrl.trim().toLowerCase())?.[1]
  return hostname && AMAZON_HOSTS.includes(hostname)
    ? 'amazon_listing'
    : 'website_product'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
