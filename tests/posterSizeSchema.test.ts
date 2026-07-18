import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { POSTER_SIZES } from '../src/lib/posterSize.ts'

const migration = readFileSync(
  new URL('../migrations/20260718201210_poster-size-registry.sql', import.meta.url),
  'utf8',
)
const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')
const designer = readFileSync(new URL('../functions/designer.ts', import.meta.url), 'utf8')
const hero = readFileSync(new URL('../functions/hero.ts', import.meta.url), 'utf8')
const FORMAT_SLUGS = POSTER_SIZES.map((size) => size.slug)

for (const [name, sql] of [
  ['migration', migration],
  ['fresh-project baseline', baseline],
] as const) {
  test(`${name} persists a defaulted, constrained campaign and generation format`, () => {
    assert.match(
      sql,
      /campaigns[\s\S]*poster_format TEXT NOT NULL DEFAULT 'a4_2x3'/,
    )
    assert.match(sql, /campaigns_poster_format_valid/)
    assert.match(
      sql,
      /poster_generations[\s\S]*poster_format TEXT NOT NULL DEFAULT 'a4_2x3'/,
    )
    assert.match(sql, /poster_generations_poster_format_valid/)
    assert.deepEqual(
      constraintSlugs(sql, 'campaigns_poster_format_valid'),
      FORMAT_SLUGS,
    )
    assert.deepEqual(
      constraintSlugs(sql, 'poster_generations_poster_format_valid'),
      FORMAT_SLUGS,
    )
    assert.doesNotMatch(sql, /story_9x16|share_1200x630/)
  })

  test(`${name} snapshots format on enqueue and preserves it on retry`, () => {
    assert.match(
      sql,
      /enqueue_poster_generation[\s\S]*INSERT INTO public\.poster_generations[\s\S]*poster_format[\s\S]*v_campaign\.poster_format/,
    )
    assert.match(
      sql,
      /retry_poster_generation[\s\S]*INSERT INTO public\.poster_generations[\s\S]*poster_format[\s\S]*v_previous_generation\.poster_format/,
    )
  })

  test(`${name} exposes the snapshot and keeps generation format immutable`, () => {
    assert.match(
      sql,
      /guard_poster_generation_update[\s\S]*NEW\.poster_format[\s\S]*OLD\.poster_format/,
    )
    assert.match(
      sql,
      /generation_activity[\s\S]*g\.poster_format[\s\S]*'poster_format', poster_format/,
    )
  })
}

test('campaign format is available through the existing column-level write grants', () => {
  assert.match(
    migration,
    /GRANT INSERT \(poster_format\) ON public\.campaigns TO authenticated/,
  )
  assert.match(
    migration,
    /GRANT UPDATE \(poster_format\) ON public\.campaigns TO authenticated/,
  )
  assert.match(
    baseline,
    /GRANT INSERT \([\s\S]*poster_format[\s\S]*\) ON public\.campaigns TO authenticated/,
  )
  assert.match(
    baseline,
    /GRANT UPDATE \([\s\S]*poster_format[\s\S]*\) ON public\.campaigns TO authenticated/,
  )
})

test('edge generation stages resolve format from the immutable generation snapshot', () => {
  for (const [name, source] of [
    ['designer', designer],
    ['hero', hero],
  ] as const) {
    assert.match(
      source,
      /const posterSize = getPosterSize\(\s*\(generation as Record<string, unknown>\)\.poster_format,\s*\)/,
      `${name} must not resolve provider geometry from the mutable campaign target`,
    )
  }
})

function constraintSlugs(sql: string, constraint: string): string[] {
  const match = sql.match(new RegExp(
    `CONSTRAINT ${constraint}[\\s\\S]*?poster_format IN \\(([\\s\\S]*?)\\)`,
  ))
  assert.ok(match, `Missing ${constraint}`)
  return [...match[1].matchAll(/'([^']+)'/g)].map((slug) => slug[1])
}
