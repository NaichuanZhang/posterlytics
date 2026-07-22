import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const migration = readFileSync(
  new URL(
    '../migrations/20260721062511_single-paid-eager-capture.sql',
    import.meta.url,
  ),
  'utf8',
)
const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')

const EAGER_COLUMNS = [
  'eager_capture_url',
  'eager_capture_color_scheme',
  'eager_captured_at',
] as const
const EAGER_UPDATE_COLUMNS = [
  'design_tokens',
  'brand_assets',
  'screenshot_url',
  'screenshot_key',
  ...EAGER_COLUMNS,
]

test('migration adds only three nullable campaign markers and one exact update grant', () => {
  const statements = migration
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
  assert.equal(statements.length, 2)
  assert.match(statements[0], /^ALTER TABLE public\.campaigns/)
  assert.match(statements[1], /^GRANT UPDATE \(/)
  assert.doesNotMatch(migration, /poster_generations|CREATE (?:TABLE|FUNCTION|TRIGGER)|\bRPC\b/i)
  assert.doesNotMatch(migration, /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/m)

  for (const column of EAGER_COLUMNS) {
    assert.match(
      migration,
      new RegExp(`ADD COLUMN ${column} (?:TEXT|TIMESTAMPTZ)[,;]`),
    )
    assert.doesNotMatch(
      migration,
      new RegExp(`ADD COLUMN ${column}[^,;]*(?:NOT NULL|DEFAULT)`),
    )
  }
  assert.deepEqual(campaignUpdateGrantColumns(migration), EAGER_UPDATE_COLUMNS)
})

test('fresh-project schema aligns campaign columns and grants without generation columns', () => {
  const campaigns = tableDefinition(baseline, 'campaigns')
  const generations = tableDefinition(baseline, 'poster_generations')

  for (const column of EAGER_COLUMNS) {
    assert.match(
      campaigns,
      new RegExp(`\\b${column} (?:TEXT|TIMESTAMPTZ)[,\\n]`),
    )
    assert.doesNotMatch(
      campaigns,
      new RegExp(`\\b${column}[^,\\n]*(?:NOT NULL|DEFAULT)`),
    )
    assert.doesNotMatch(generations, new RegExp(`\\b${column}\\b`))
  }

  const baselineGrant = campaignUpdateGrantColumns(baseline)
  assert.deepEqual(baselineGrant, EAGER_UPDATE_COLUMNS)
})

test('enqueue inheritance and the frozen generation tuple remain byte-identical', () => {
  const enqueue = lastFunction(baseline, 'enqueue_poster_generation')
  const frozenGuard = lastFunction(baseline, 'guard_poster_generation_update')

  assert.equal(
    sha256(enqueue),
    '26ea6f19640d016da57a247e0071201985e6b4dabc9401d4994890e9c204e9a9',
  )
  assert.equal(
    sha256(frozenGuard),
    '6df3eb3502e90361751de954cb3244371029597b87bd0edc6a596cef65f340d4',
  )
  assert.match(
    enqueue,
    /CASE WHEN v_campaign\.current_generation_id IS NULL THEN v_campaign\.brand_assets ELSE v_parent\.brand_assets END,\s+CASE WHEN v_campaign\.current_generation_id IS NULL THEN v_campaign\.brand_essence ELSE v_parent\.brand_essence END,\s+CASE WHEN v_campaign\.current_generation_id IS NULL THEN v_campaign\.poster_spec ELSE v_parent\.poster_spec END,\s+CASE WHEN v_campaign\.current_generation_id IS NULL THEN v_campaign\.design_tokens ELSE v_parent\.design_tokens END,\s+CASE WHEN v_campaign\.current_generation_id IS NULL THEN v_campaign\.screenshot_url ELSE v_parent\.screenshot_url END,\s+CASE WHEN v_campaign\.current_generation_id IS NULL THEN v_campaign\.screenshot_key ELSE v_parent\.screenshot_key END,/,
  )
  assert.deepEqual(frozenTuple(frozenGuard), [
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

function campaignUpdateGrantColumns(sql: string): string[] {
  const grants = [
    ...sql.matchAll(
      /GRANT UPDATE \(([\s\S]*?)\) ON public\.campaigns TO authenticated;/g,
    ),
  ]
  const match = grants.at(-1)
  assert.ok(match, 'Missing authenticated campaign update grant')
  return match[1]
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean)
}

function tableDefinition(sql: string, table: string): string {
  const start = sql.indexOf(`CREATE TABLE public.${table} (`)
  const end = sql.indexOf('\n);', start)
  assert.ok(start >= 0 && end > start, `Missing table ${table}`)
  return sql.slice(start, end + 3)
}

function lastFunction(sql: string, name: string): string {
  const starts = [
    sql.lastIndexOf(`CREATE FUNCTION public.${name}(`),
    sql.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),
  ]
  const start = Math.max(...starts)
  const end = sql.indexOf('\n$$;', start)
  assert.ok(start >= 0 && end > start, `Missing function ${name}`)
  return sql.slice(start, end + 4)
}

function frozenTuple(guard: string): string[] {
  const tuple = guard.match(/IF \(\s*([\s\S]*?)\s*\) IS DISTINCT FROM \(/)
  assert.ok(tuple)
  return [...tuple[1].matchAll(/NEW\.([a-z_]+)/g)].map((match) => match[1])
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
