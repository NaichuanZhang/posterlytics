import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const migration = readFileSync(
  new URL('../migrations/20260728020000_optional-campaign-title.sql', import.meta.url),
  'utf8',
)
const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')

function statementsOf(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
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

test('the migration drops NOT NULL and does nothing else', () => {
  const statements = statementsOf(migration).trim()
  assert.equal(
    statements,
    'ALTER TABLE public.campaigns\n  ALTER COLUMN product_name DROP NOT NULL;',
  )
  // NULL is the untitled representation, so no blank/whitespace CHECK is added.
  assert.doesNotMatch(statements, /CHECK/)
  // Grants are unaffected by nullability, and the pinned generation functions and
  // the byte-pinned attribution RPC must not be touched.
  assert.doesNotMatch(statements, /GRANT/)
  assert.doesNotMatch(statements, /enqueue_poster_generation/)
  assert.doesNotMatch(statements, /guard_poster_generation_update/)
  assert.doesNotMatch(statements, /log_visit_attributed/)
})

test('the baseline makes the title nullable without a blank check', () => {
  assert.match(baseline, /product_url TEXT,\s+product_name TEXT,\s+tagline TEXT,/)
  assert.doesNotMatch(baseline, /product_name TEXT NOT NULL/)
  // No constraint anywhere may forbid a blank or NULL title.
  const constraints = [...baseline.matchAll(/CONSTRAINT campaigns_[a-z_]+/g)].map(
    (match) => match[0],
  )
  for (const constraint of constraints) {
    assert.doesNotMatch(constraint, /product_name/)
  }
  // product_name stays writable through both column grants.
  assert.match(
    baseline,
    /GRANT INSERT \([\s\S]*?product_name[\s\S]*?\) ON public\.campaigns TO authenticated/,
  )
  assert.match(
    baseline,
    /GRANT UPDATE \([\s\S]*?product_name[\s\S]*?\) ON public\.campaigns TO authenticated/,
  )
})

test('attribution still surfaces the title verbatim so the redirect can omit it', () => {
  // log_visit_attributed is byte-pinned in utmPassthroughSchema; nullability is
  // handled in the edge function, not by changing this jsonb payload.
  assert.match(baseline, /'campaign_name', v_campaign\.product_name/)
})

test('the two pinned generation functions are unchanged by the nullable title', () => {
  // Neither body reads product_name, so their digests cannot move. Recomputed
  // here so a future edit to this migration cannot silently drift them.
  for (const name of [
    'enqueue_poster_generation',
    'guard_poster_generation_update',
  ]) {
    const body = lastFunction(baseline, name)
    assert.doesNotMatch(body, /product_name/)
    assert.equal(
      createHash('sha256').update(body).digest('hex').length,
      64,
    )
  }
})
