import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const migration = readFileSync(
  new URL('../migrations/20260718151610_analytics-integrity.sql', import.meta.url),
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
