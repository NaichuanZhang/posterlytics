import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const migration = readFileSync(
  new URL('../migrations/20260717165727_generation-stage-traces.sql', import.meta.url),
  'utf8',
)
const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')

test('trace migration enforces owner isolation, cascade cleanup, and stage uniqueness', () => {
  assert.match(migration, /CREATE TABLE public\.generation_stage_traces/)
  assert.match(
    migration,
    /generation_id UUID NOT NULL\s+REFERENCES public\.poster_generations\(id\) ON DELETE CASCADE/,
  )
  assert.match(migration, /UNIQUE \(generation_id, stage\)/)
  assert.match(migration, /ALTER TABLE public\.generation_stage_traces ENABLE ROW LEVEL SECURITY/)
  assert.match(
    migration,
    /generation_stage_traces_owner_read[\s\S]*user_id = \(SELECT auth\.uid\(\)\)/,
  )
  assert.match(migration, /REVOKE ALL ON public\.generation_stage_traces FROM anon, authenticated/)
  assert.doesNotMatch(migration, /GRANT (?:SELECT|UPDATE|INSERT|DELETE)[^;]* TO anon/)
})

test('trace migration makes terminal rows immutable and validates lifecycle states', () => {
  assert.match(migration, /OLD\.status IN \('succeeded', 'failed', 'skipped'\)/)
  assert.match(migration, /terminal generation stage traces are immutable/)
  assert.match(migration, /status IN \('pending', 'running', 'succeeded', 'failed', 'skipped'\)/)
  assert.match(migration, /poster_generations_finalize_unreached_stage_traces/)
  assert.match(migration, /generation_failed_before_stage/)
})

test('legacy generations stay distinguishable while future generations initialize all stages', () => {
  assert.match(migration, /ADD COLUMN trace_schema_version SMALLINT/)
  assert.match(migration, /ALTER COLUMN trace_schema_version SET DEFAULT 1/)
  assert.match(migration, /VALUES[\s\S]*'analyze'[\s\S]*'designer'[\s\S]*'hero'/)
  assert.match(migration, /website_refresh_not_requested/)
  assert.match(migration, /event_layout_is_deterministic/)
})

test('fresh-project baseline contains the same trace table and guards', () => {
  assert.match(baseline, /trace_schema_version SMALLINT NOT NULL DEFAULT 1/)
  assert.match(baseline, /CREATE TABLE public\.generation_stage_traces/)
  assert.match(baseline, /CREATE POLICY generation_stage_traces_owner_read/)
  assert.match(baseline, /terminal generation stage traces are immutable/)
})
