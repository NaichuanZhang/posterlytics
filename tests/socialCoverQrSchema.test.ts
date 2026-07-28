import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const migration = readFileSync(
  new URL(
    '../migrations/20260724070000_social-cover-qr-stitch.sql',
    import.meta.url,
  ),
  'utf8',
)
const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')

test('the social-cover QR migration remains a record of its shipped rule', () => {
  // Historical only. The baseline has since replaced this constraint with the
  // format-keyed campaigns_banded_format_destination_required — see
  // tests/bandedFormatQrPolicySchema.test.ts.
  assert.doesNotMatch(baseline, /campaigns_social_cover_qr_destination_required/)
  for (const sql of [migration]) {
    const constraint = namedConstraint(
      sql,
      'campaigns_social_cover_qr_destination_required',
    )
    assert.match(constraint, /use_case <> 'social_cover'/)
    assert.match(
      constraint,
      /poster_format IS DISTINCT FROM 'rednote_3x4'/,
    )
    assert.match(
      constraint,
      /NULLIF\(BTRIM\(destination_url\), ''\) IS NOT NULL/,
    )
  }
})

test('the migration records the social-only placement policy it shipped', () => {
  for (const sql of [migration]) {
    const guard = lastFunction(sql, 'guard_placement_tracking_policy')
    assert.match(
      guard,
      /SELECT use_case, destination_url\s+INTO v_use_case, v_destination_url/,
    )
    assert.match(
      guard,
      /v_use_case = 'social_cover'\s+AND NULLIF\(BTRIM\(v_destination_url\), ''\) IS NULL/,
    )
    assert.doesNotMatch(
      guard,
      /v_use_case = 'social_cover' THEN\s+RAISE EXCEPTION 'Social cover campaigns cannot have placements\.'/,
    )
    assert.match(
      guard,
      /ELSIF v_use_case = 'rednote_post' THEN[\s\S]*RedNote post campaigns cannot have placements/,
    )
  }
})

test('use-case switches keep valid social placements but reject destination-less social and all RedNote', () => {
  for (const sql of [migration, baseline]) {
    const guard = lastFunction(sql, 'guard_campaign_tracking_policy')
    assert.match(guard, /NEW\.use_case IS DISTINCT FROM OLD\.use_case/)
    assert.match(
      guard,
      /NEW\.use_case = 'social_cover'\s+AND NULLIF\(BTRIM\(NEW\.destination_url\), ''\) IS NULL/,
    )
    assert.match(
      guard,
      /ELSIF NEW\.use_case = 'rednote_post' THEN[\s\S]*Remove campaign placements before switching to RedNote post/,
    )
  }
})

test('visit attribution permits published destination-backed social and still rejects OFF social and RedNote', () => {
  for (const sql of [migration, baseline]) {
    const rpc = lastFunction(sql, 'log_visit_attributed')
    const guard = rpc.slice(
      rpc.indexOf('IF v_campaign.status'),
      rpc.indexOf('INSERT INTO public.scans'),
    )
    assert.match(guard, /v_campaign\.status <> 'published'/)
    assert.match(guard, /v_campaign\.use_case = 'rednote_post'/)
    assert.match(
      guard,
      /NULLIF\(BTRIM\(v_campaign\.destination_url\), ''\) IS NULL/,
    )
    assert.doesNotMatch(guard, /use_case IN \('social_cover', 'rednote_post'\)/)
    assert.doesNotMatch(guard, /use_case = 'social_cover'/)
  }
})

test('migration owns the exact baseline bodies it still governs, and is append-only', () => {
  // guard_placement_tracking_policy has since been generalized to any banded
  // format; the newer migration owns the baseline copy of it.
  for (const name of [
    'guard_campaign_tracking_policy',
    'log_visit_attributed',
  ]) {
    assert.equal(
      normalizeFunction(lastFunction(migration, name)),
      normalizeFunction(lastFunction(baseline, name)),
      `${name} drifted between migration and baseline`,
    )
  }
  assert.doesNotMatch(migration, /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/m)
  assert.doesNotMatch(migration, /\bGRANT\b|\bREVOKE\b/)
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

function normalizeFunction(value: string): string {
  return value.replace(
    /^CREATE(?: OR REPLACE)? FUNCTION/,
    'CREATE FUNCTION',
  )
}
