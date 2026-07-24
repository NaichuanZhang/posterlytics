import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const migration = readFileSync(
  new URL(
    '../migrations/20260722011444_rednote-post-use-case.sql',
    import.meta.url,
  ),
  'utf8',
)
const socialQrMigration = readFileSync(
  new URL(
    '../migrations/20260724070000_social-cover-qr-stitch.sql',
    import.meta.url,
  ),
  'utf8',
)
const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')

const REFERENCE_ONLY_IDS = /'social_cover', 'rednote_post'/
const TRACKING_FUNCTIONS = [
  'guard_placement_tracking_policy',
  'guard_campaign_tracking_policy',
  'log_visit_attributed',
] as const
const REDNOTE_FUNCTIONS = [
  'enqueue_poster_generation',
  'retry_poster_generation',
] as const

test('migration and baseline register RedNote in every use-case constraint', () => {
  for (const sql of [migration, baseline]) {
    for (const name of [
      'campaigns_use_case_valid',
      'poster_generations_use_case_valid',
    ]) {
      const constraint = namedConstraint(sql, name)
      for (const useCase of [
        'website_product',
        'amazon_listing',
        'social_cover',
        'rednote_post',
        'event',
      ]) {
        assert.match(constraint, new RegExp(`'${useCase}'`))
      }
    }

    assert.match(
      namedConstraint(sql, 'campaigns_source_urls_required'),
      REFERENCE_ONLY_IDS,
    )
    assert.match(
      namedConstraint(sql, 'campaigns_platform_hint_valid'),
      REFERENCE_ONLY_IDS,
    )
    assert.match(
      namedConstraint(sql, 'poster_generations_platform_hint_valid'),
      REFERENCE_ONLY_IDS,
    )
  }
})

test('new migration owns exact current policy and routing function bodies', () => {
  for (const name of TRACKING_FUNCTIONS) {
    assert.equal(
      normalizedFunction(socialQrMigration, name),
      normalizedFunction(baseline, name),
      `${name} drifted between QR migration and baseline`,
    )
  }
  for (const name of REDNOTE_FUNCTIONS) {
    assert.equal(
      normalizedFunction(migration, name),
      normalizedFunction(baseline, name),
      `${name} drifted between migration and baseline`,
    )
  }
})

test('RedNote migration historically rejected both reference-only use cases', () => {
  const placementGuard = lastFunction(
    migration,
    'guard_placement_tracking_policy',
  )
  assert.match(
    placementGuard,
    /IF v_use_case = 'social_cover' THEN[\s\S]*RAISE EXCEPTION 'Social cover campaigns cannot have placements\.'/,
  )
  assert.match(
    placementGuard,
    /ELSIF v_use_case = 'rednote_post' THEN[\s\S]*RAISE EXCEPTION 'RedNote post campaigns cannot have placements\.'/,
  )
  assert.match(
    lastFunction(migration, 'guard_campaign_tracking_policy'),
    /NEW\.use_case IN \('social_cover', 'rednote_post'\)/,
  )
  assert.match(
    lastFunction(migration, 'log_visit_attributed'),
    /v_campaign\.use_case IN \('social_cover', 'rednote_post'\)/,
  )
})

test('current tracking policy keeps every RedNote placement and visit rejected', () => {
  for (const sql of [socialQrMigration, baseline]) {
    const placementGuard = lastFunction(
      sql,
      'guard_placement_tracking_policy',
    )
    assert.match(
      placementGuard,
      /ELSIF v_use_case = 'rednote_post' THEN[\s\S]*RAISE EXCEPTION 'RedNote post campaigns cannot have placements\.'/,
    )
    assert.match(
      lastFunction(sql, 'guard_campaign_tracking_policy'),
      /ELSIF NEW\.use_case = 'rednote_post' THEN/,
    )
    assert.match(
      lastFunction(sql, 'log_visit_attributed'),
      /v_campaign\.use_case = 'rednote_post'/,
    )
  }
})

test('enqueue validates RedNote inputs and forces reference-only refresh routing', () => {
  for (const sql of [migration, baseline]) {
    const enqueue = lastFunction(sql, 'enqueue_poster_generation')
    assert.match(
      enqueue,
      /IF v_campaign\.use_case IN \('social_cover', 'rednote_post'\)[\s\S]*NULLIF\(BTRIM\(item\.value ->> 'url'\), ''\) IS NOT NULL/,
    )
    assert.match(
      enqueue,
      /IF v_campaign\.use_case = 'social_cover'[\s\S]*RAISE EXCEPTION 'Social cover generation requires at least one reference image\.'[\s\S]*RAISE EXCEPTION 'RedNote post generation requires at least one reference image\.'/,
    )
    assert.match(
      enqueue,
      /IF v_campaign\.use_case = 'rednote_post' AND v_instruction IS NULL[\s\S]*RAISE EXCEPTION 'RedNote post generation requires draft copy\.'/,
    )
    assert.match(
      enqueue,
      /v_campaign\.use_case NOT IN \('social_cover', 'rednote_post'\)/,
    )
    assert.match(
      enqueue,
      /OR v_campaign\.use_case IN \('social_cover', 'rednote_post'\)\s+THEN 'website_refresh'/,
    )
  }
})

test('retry validates frozen RedNote inputs and preserves refresh routing', () => {
  for (const sql of [migration, baseline]) {
    const retry = lastFunction(sql, 'retry_poster_generation')
    assert.match(
      retry,
      /v_previous_generation\.use_case IN \('social_cover', 'rednote_post'\)[\s\S]*jsonb_array_elements\(v_previous_generation\.reference_images\)/,
    )
    assert.match(
      retry,
      /IF v_previous_generation\.use_case = 'social_cover'[\s\S]*RAISE EXCEPTION 'Social cover generation requires at least one reference image\.'[\s\S]*RAISE EXCEPTION 'RedNote post generation requires at least one reference image\.'/,
    )
    assert.match(
      retry,
      /v_previous_generation\.use_case = 'rednote_post'[\s\S]*NULLIF\(BTRIM\(v_previous_generation\.instruction\), ''\) IS NULL/,
    )
    assert.match(
      retry,
      /v_previous_generation\.use_case NOT IN \('social_cover', 'rednote_post'\)/,
    )
    assert.match(
      retry,
      /WHEN v_previous_generation\.use_case IN \('social_cover', 'rednote_post'\)\s+THEN 'website_refresh'/,
    )
    assert.match(
      retry,
      /WHEN v_reuse_selection AND v_previous_job\.stage IN \('designer', 'hero'\)\s+THEN v_previous_job\.stage/,
    )
  }
})

test('migration leaves generic source intent and frozen-generation guards alone', () => {
  assert.doesNotMatch(migration, /guard_campaign_source_intent_update/)
  assert.doesNotMatch(migration, /guard_poster_generation_update/)
  assert.doesNotMatch(migration, /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/m)
})

test('migration defensively restores the existing RPC privilege surface', () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.log_visit_attributed\(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT\) FROM PUBLIC/,
  )
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.enqueue_poster_generation\(UUID, TEXT, JSONB, BOOLEAN, TEXT, TEXT\) FROM PUBLIC/,
  )
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.retry_poster_generation\(UUID\) FROM PUBLIC/,
  )
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.log_visit_attributed\(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT\)\s+TO anon/,
  )
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.enqueue_poster_generation\(UUID, TEXT, JSONB, BOOLEAN, TEXT, TEXT\)\s+TO authenticated/,
  )
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.retry_poster_generation\(UUID\)\s+TO authenticated/,
  )
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

function normalizedFunction(sql: string, name: string): string {
  return lastFunction(sql, name).replace(
    /^CREATE(?: OR REPLACE)? FUNCTION/,
    'CREATE FUNCTION',
  )
}
