import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const migration = readFileSync(
  new URL('../migrations/20260718171249_utm-passthrough.sql', import.meta.url),
  'utf8',
)
const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')

function assertAttributedVisitContract(sql: string) {
  assert.match(
    sql,
    /CREATE FUNCTION public\.log_visit_attributed\([\s\S]*?\)\s+RETURNS JSONB/,
  )
  assert.match(
    sql,
    /jsonb_build_object\(\s+'destination_url', v_campaign\.destination_url,\s+'campaign_name', v_campaign\.product_name,\s+'placement_code', v_placement\.code/,
  )
  assert.match(
    sql,
    /SELECT public\.log_visit_attributed\([\s\S]*?\) ->> 'destination_url'/,
  )
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.log_visit_attributed\(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT\)\s+TO anon/,
  )
}

test('UTM migration adds an attributed RPC without removing the text RPC', () => {
  assertAttributedVisitContract(migration)
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.log_visit\([\s\S]*?\)\s+RETURNS TEXT/,
  )
})

test('fresh-project visit RPCs match the UTM migration contract', () => {
  assertAttributedVisitContract(baseline)
  assert.match(
    baseline,
    /CREATE FUNCTION public\.log_visit\([\s\S]*?\)\s+RETURNS TEXT/,
  )
})
