import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  POSTER_SIZES,
  getPosterSize,
  hasPosterQrBand,
} from '../src/lib/posterSize.ts'

const migration = readFileSync(
  new URL(
    '../migrations/20260728030000_banded-format-qr-policy.sql',
    import.meta.url,
  ),
  'utf8',
)
const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')

const BANDED_SLUGS = POSTER_SIZES
  .filter((size) => hasPosterQrBand(size))
  .map((size) => size.slug)
const BANDLESS_SLUGS = POSTER_SIZES
  .filter((size) => !hasPosterQrBand(size))
  .map((size) => size.slug)

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

function constraintSlugs(sql: string): string[] {
  const constraint = namedConstraint(
    sql,
    'campaigns_banded_format_destination_required',
  )
  return [...constraint.matchAll(/'([a-z0-9_]+)'/g)]
    .map((match) => match[1])
    .filter((value) => value !== '')
}

test('the destination requirement is keyed on the banded slugs, derived from the registry', () => {
  for (const sql of [migration, baseline]) {
    const constraint = namedConstraint(
      sql,
      'campaigns_banded_format_destination_required',
    )
    assert.match(constraint, /poster_format NOT IN \(/)
    assert.match(
      constraint,
      /NULLIF\(BTRIM\(destination_url\), ''\) IS NOT NULL/,
    )
    // Exactly the banded slugs, in registry order — no hand-maintained drift.
    assert.deepEqual(constraintSlugs(sql), BANDED_SLUGS)
    // One-directional: it must never mention a bandless slug, because a bandless
    // format neither requires nor forbids a destination.
    for (const slug of BANDLESS_SLUGS) {
      assert.doesNotMatch(constraint, new RegExp(`'${slug}'`))
    }
    // The rule is format-keyed now, not use-case-keyed.
    assert.doesNotMatch(constraint, /use_case/)
  }
  assert.equal(BANDED_SLUGS.length, 4)
  assert.equal(BANDLESS_SLUGS.length, 4)
})

test('the superseded social-cover-only constraint is dropped and gone from the baseline', () => {
  assert.match(
    migration,
    /DROP CONSTRAINT campaigns_social_cover_qr_destination_required/,
  )
  assert.doesNotMatch(baseline, /campaigns_social_cover_qr_destination_required/)
})

test('existing rows are normalized by flipping the format, never by clearing a destination', () => {
  const update = migration.slice(
    migration.indexOf('UPDATE public.campaigns'),
    migration.indexOf('ALTER TABLE public.campaigns'),
  )
  assert.match(update, /SET poster_format = CASE poster_format/)
  assert.match(update, /NULLIF\(BTRIM\(destination_url\), ''\) IS NULL/)
  // Every banded slug must have a mapped twin, or the CASE yields NULL and the
  // NOT NULL column write fails.
  for (const slug of BANDED_SLUGS) {
    assert.match(update, new RegExp(`WHEN '${slug}' THEN '[a-z0-9_]+'`))
  }
  const [, ...targets] = [
    ...update.matchAll(/WHEN '([a-z0-9_]+)' THEN '([a-z0-9_]+)'/g),
  ].reduce<[null, ...Array<[string, string]>]>(
    (acc, match) => [...acc, [match[1], match[2]]],
    [null],
  )
  for (const [from, to] of targets) {
    // Each mapping must preserve the aspect and only flip the band.
    assert.equal(
      getPosterSize(from as never).providerAspectRatio,
      getPosterSize(to as never).providerAspectRatio,
    )
    assert.equal(hasPosterQrBand(getPosterSize(from as never)), true)
    assert.equal(hasPosterQrBand(getPosterSize(to as never)), false)
  }
  assert.equal(targets.length, BANDED_SLUGS.length)

  // It must not touch a destination: NULLing blanks would violate the older
  // campaigns_source_urls_required for every website/Amazon/event row.
  assert.doesNotMatch(update, /SET destination_url/)
  assert.doesNotMatch(update, /destination_url =/)
})

test('the placement guard generalizes to banded formats and stays no weaker', () => {
  for (const sql of [migration, baseline]) {
    const guard = lastFunction(sql, 'guard_placement_tracking_policy')
    // Reads the format alongside the use case, under the same row lock.
    assert.match(
      guard,
      /SELECT use_case, destination_url, poster_format\s+INTO v_use_case, v_destination_url, v_poster_format/,
    )
    assert.match(
      guard,
      /WHERE id = NEW\.campaign_id\s+AND user_id = NEW\.user_id\s+FOR UPDATE/,
    )
    // RedNote rejection preserved verbatim.
    assert.match(
      guard,
      /v_use_case = 'rednote_post' THEN\s+RAISE EXCEPTION 'RedNote post campaigns cannot have placements\.'/,
    )
    // Band-keying ALONE would loosen policy, since social_cover with QR off is
    // bandless: a destination-less social cover placement would start passing.
    assert.match(guard, /v_poster_format IN \(/)
    assert.match(guard, /OR v_use_case = 'social_cover'/)
    assert.match(
      guard,
      /NULLIF\(BTRIM\(v_destination_url\), ''\) IS NULL/,
    )
    for (const slug of BANDED_SLUGS) {
      assert.match(guard, new RegExp(`'${slug}'`))
    }
  }
})

test('the migration is append-only and leaves the pinned functions alone', () => {
  const statements = migration
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
  assert.doesNotMatch(statements, /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/m)
  assert.doesNotMatch(statements, /\bGRANT\b|\bREVOKE\b/)
  // Their SHA-256 digests are pinned in eagerCaptureSchema and captureRateLimitSchema.
  assert.doesNotMatch(statements, /enqueue_poster_generation/)
  assert.doesNotMatch(statements, /guard_poster_generation_update/)
  // Nothing here retires tracking: no destination clearing, no placement teardown.
  assert.doesNotMatch(statements, /DELETE FROM public\.placements/)
  assert.doesNotMatch(statements, /log_visit_attributed/)
})

test('the migration owns the baseline copy of the guard it replaced', () => {
  const normalize = (value: string) =>
    value.replace(/^CREATE(?: OR REPLACE)? FUNCTION/, 'CREATE FUNCTION')
  assert.equal(
    normalize(lastFunction(migration, 'guard_placement_tracking_policy')),
    normalize(lastFunction(baseline, 'guard_placement_tracking_policy')),
  )
})
