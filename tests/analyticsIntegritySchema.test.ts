import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const migration = readFileSync(
  new URL('../migrations/20260718151610_analytics-integrity.sql', import.meta.url),
  'utf8',
)
const campaignTotalsMigration = readFileSync(
  new URL(
    '../migrations/20260724185425_campaign-wide-analytics-totals.sql',
    import.meta.url,
  ),
  'utf8',
)
const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')

function assertAnalyticsIntegrity(sql: string) {
  assert.match(sql, /p_country TEXT DEFAULT NULL,\s+p_city TEXT DEFAULT NULL/)
  assert.match(sql, /country,\s+city,\s+visitor_hash/)
  assert.match(sql, /AND s\.device IS DISTINCT FROM 'bot'/)
  assert.match(sql, /FROM owned_scans\s+WHERE device IS DISTINCT FROM 'bot'/)
  assert.match(sql, /'bots_filtered', \(\s+SELECT COUNT\(\*\)\s+FROM owned_scans\s+WHERE device = 'bot'/)
}

test('analytics integrity migration adds optional coarse geo without deleting raw visits', () => {
  assert.match(
    migration,
    /DROP FUNCTION IF EXISTS public\.log_visit\(TEXT, TEXT, TEXT, TEXT\)/,
  )
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.log_visit\(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT\) TO anon/,
  )
  assert.doesNotMatch(migration, /DELETE FROM public\.scans/)
  assertAnalyticsIntegrity(migration)
})

test('fresh-project analytics functions match the migration contract', () => {
  assertAnalyticsIntegrity(baseline)
  assert.doesNotMatch(
    baseline,
    /GRANT EXECUTE ON FUNCTION public\.log_visit\(TEXT, TEXT, TEXT, TEXT\) TO anon/,
  )
})

test('campaign totals are global while placement uniques remain per placement', () => {
  const migrationBreakdowns = lastFunction(
    campaignTotalsMigration,
    'campaign_breakdowns',
  )
  const baselineBreakdowns = lastFunction(baseline, 'campaign_breakdowns')

  assert.equal(
    normalizeFunction(migrationBreakdowns),
    normalizeFunction(baselineBreakdowns),
    'campaign_breakdowns drifted between migration and baseline',
  )

  for (const sql of [migrationBreakdowns, baselineBreakdowns]) {
    assert.match(
      sql,
      /LANGUAGE sql\s+STABLE\s+SECURITY DEFINER\s+SET search_path = pg_catalog, public, pg_temp/,
    )
    assert.match(sql, /SELECT s\.device, s\.os, s\.country, s\.visitor_hash/)
    assert.match(sql, /AS country,\s+visitor_hash\s+FROM owned_scans/)
    assert.match(
      sql,
      /totals AS \(\s+SELECT\s+COUNT\(\*\) AS visits,\s+COUNT\(DISTINCT visitor_hash\) AS unique_visitors\s+FROM filtered\s+\)/,
    )
    assert.match(
      sql,
      /'visits', \(SELECT visits FROM totals\),\s+'unique_visitors', \(SELECT unique_visitors FROM totals\)/,
    )
    assert.match(sql, /FROM owned_scans\s+WHERE device IS DISTINCT FROM 'bot'/)
    assert.doesNotMatch(sql, /GROUP BY (?:s\.)?placement_id|GROUP BY pl\.id/)
    assert.doesNotMatch(sql, /SUM\s*\([^)]*unique_visitors/)
  }

  const migratedPlacementStats = lastFunction(migration, 'placement_stats')
  const baselinePlacementStats = lastFunction(baseline, 'placement_stats')
  assert.equal(
    normalizeFunction(migratedPlacementStats),
    normalizeFunction(baselinePlacementStats),
    'placement_stats must remain unchanged',
  )
  assert.match(
    baselinePlacementStats,
    /COUNT\(DISTINCT s\.visitor_hash\) AS unique_visitors/,
  )
  assert.match(
    baselinePlacementStats,
    /AND s\.device IS DISTINCT FROM 'bot'/,
  )
  assert.match(
    baselinePlacementStats,
    /GROUP BY pl\.id, pl\.label, pl\.code, pl\.created_at/,
  )
})

test('campaign totals migration is append-only and preserves existing grants', () => {
  assert.doesNotMatch(
    campaignTotalsMigration,
    /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/m,
  )
  assert.doesNotMatch(campaignTotalsMigration, /\bGRANT\b|\bREVOKE\b/)
  assert.doesNotMatch(
    campaignTotalsMigration,
    /FUNCTION public\.placement_stats/,
  )
  assert.match(
    baseline,
    /REVOKE ALL ON FUNCTION public\.campaign_breakdowns\(UUID\) FROM PUBLIC;/,
  )
  assert.match(
    baseline,
    /GRANT EXECUTE ON FUNCTION public\.campaign_breakdowns\(UUID\) TO authenticated;/,
  )
})

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
