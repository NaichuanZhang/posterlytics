import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const migration = readFileSync(
  new URL(
    '../migrations/20260721074237_capture-preview-rate-limit.sql',
    import.meta.url,
  ),
  'utf8',
)
const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')

test('migration and baseline define the same private capture-attempt ledger', () => {
  for (const [name, sql] of [
    ['migration', migration],
    ['baseline', baseline],
  ] as const) {
    const table = tableDefinition(sql, 'capture_preview_attempts')
    assert.match(table, /\bid UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/, name)
    assert.match(
      table,
      /\buser_id UUID NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/,
      name,
    )
    assert.match(
      table,
      /\battempted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp\(\)/,
      name,
    )
    assert.match(
      sql,
      /CREATE INDEX idx_capture_preview_attempts_user_attempted_at\s+ON public\.capture_preview_attempts\(user_id, attempted_at\);/,
      name,
    )
    assert.match(
      sql,
      /ALTER TABLE public\.capture_preview_attempts ENABLE ROW LEVEL SECURITY;/,
      name,
    )
    assert.match(
      sql,
      /REVOKE ALL ON TABLE public\.capture_preview_attempts\s+FROM PUBLIC, anon, authenticated;/,
      name,
    )
    assert.equal(
      statements(sql).some((statement) =>
        statement.startsWith('CREATE POLICY ')
        && /\bON public\.capture_preview_attempts\b/.test(statement)
      ),
      false,
      `${name} must not define table policies`,
    )
    assert.equal(
      statements(sql).some((statement) =>
        statement.startsWith('GRANT ')
        && /\bON (?:TABLE )?public\.capture_preview_attempts\b/.test(statement)
      ),
      false,
      `${name} must not grant direct table access`,
    )
  }

  assert.equal(
    tableDefinition(baseline, 'capture_preview_attempts'),
    tableDefinition(migration, 'capture_preview_attempts'),
  )
})

test('quota RPC serializes and records admitted attempts in exact rolling windows', () => {
  const migrationFunction = lastFunction(
    migration,
    'consume_capture_preview_quota',
  )
  const baselineFunction = lastFunction(
    baseline,
    'consume_capture_preview_quota',
  )
  assert.equal(baselineFunction, migrationFunction)

  for (const sql of [migrationFunction, baselineFunction]) {
    assert.match(
      sql,
      /consume_capture_preview_quota\(\)\s+RETURNS TABLE \(\s*allowed BOOLEAN,\s*retry_after_seconds INTEGER\s*\)/,
    )
    const returnColumns = sql.match(
      /RETURNS TABLE \(([\s\S]*?)\)\s+LANGUAGE plpgsql/,
    )
    assert.ok(returnColumns)
    assert.deepEqual(
      returnColumns[1]
        .split(',')
        .map((column) => column.trim().split(/\s+/, 1)[0]),
      ['allowed', 'retry_after_seconds'],
    )
    assert.match(sql, /LANGUAGE plpgsql/)
    assert.match(sql, /SECURITY DEFINER/)
    assert.match(sql, /SET search_path = pg_catalog, public, pg_temp/)
    assert.match(sql, /v_user_id UUID := auth\.uid\(\)/)
    assert.match(sql, /IF v_user_id IS NULL THEN[\s\S]*ERRCODE = '42501'/)
    assert.match(
      sql,
      /pg_catalog\.pg_advisory_xact_lock\(\s*pg_catalog\.hashtextextended\(v_user_id::TEXT, 0\)\s*\)/,
    )
    assert.match(
      sql,
      /DELETE FROM public\.capture_preview_attempts[\s\S]*INTERVAL '24 hours'/,
    )
    assert.match(sql, /INTERVAL '10 minutes'/)
    assert.match(sql, /IF v_short_count < 6 AND v_daily_count < 30 THEN/)
    assert.match(
      sql,
      /INSERT INTO public\.capture_preview_attempts \(user_id, attempted_at\)[\s\S]*RETURN QUERY SELECT TRUE, 0;/,
    )
    assert.match(sql, /RETURN QUERY[\s\S]*FALSE,[\s\S]*GREATEST\(\s*1,/)

    const lock = sql.indexOf('pg_catalog.pg_advisory_xact_lock')
    const prune = sql.indexOf('DELETE FROM public.capture_preview_attempts')
    const count = sql.indexOf('SELECT\n    COUNT(*) FILTER')
    const insert = sql.indexOf('INSERT INTO public.capture_preview_attempts')
    const allow = sql.indexOf('RETURN QUERY SELECT TRUE, 0')
    assert.ok(lock >= 0 && lock < prune)
    assert.ok(prune < count)
    assert.ok(count < insert)
    assert.ok(insert < allow)
    assert.equal(
      (sql.match(/INSERT INTO public\.capture_preview_attempts/g) ?? []).length,
      1,
    )
  }

  for (const sql of [migration, baseline]) {
    assert.match(
      sql,
      /REVOKE ALL ON FUNCTION public\.consume_capture_preview_quota\(\) FROM PUBLIC;/,
    )
    assert.match(
      sql,
      /GRANT EXECUTE ON FUNCTION public\.consume_capture_preview_quota\(\)\s+TO authenticated;/,
    )
  }
})

test('quota migration is additive and leaves generation contracts byte-identical', () => {
  assert.doesNotMatch(
    migration,
    /public\.(?:campaigns|poster_generations|enqueue_poster_generation|guard_poster_generation_update)/,
  )
  assert.doesNotMatch(migration, /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/m)

  assert.equal(
    sha256(lastFunction(baseline, 'enqueue_poster_generation')),
    '8f693c5d959f1a734c9e3a04709b1817b006bed1e3523b4adb3148f2ee274116',
  )
  assert.equal(
    sha256(lastFunction(baseline, 'guard_poster_generation_update')),
    '6df3eb3502e90361751de954cb3244371029597b87bd0edc6a596cef65f340d4',
  )
})

function tableDefinition(sql: string, table: string): string {
  const start = sql.indexOf(`CREATE TABLE public.${table} (`)
  const end = sql.indexOf('\n);', start)
  assert.ok(start >= 0 && end > start, `Missing table ${table}`)
  return sql.slice(start, end + 3)
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

function statements(sql: string): string[] {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
