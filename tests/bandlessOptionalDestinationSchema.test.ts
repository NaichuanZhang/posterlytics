import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  POSTER_SIZES,
  hasPosterQrBand,
  type PosterSizeSlug,
} from '../src/lib/posterSize.ts'
import { resolveCreationUseCase } from '../src/lib/useCases.ts'

const migration = readFileSync(
  new URL(
    '../migrations/20260729000000_bandless-optional-destination.sql',
    import.meta.url,
  ),
  'utf8',
)
const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')

const BANDED_SLUGS = new Set(
  POSTER_SIZES.filter((size) => hasPosterQrBand(size)).map((size) => size.slug),
)

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

/** The two CHECKs that together decide whether a campaign row is legal. */
function campaignRowIsLegal(
  useCase: string,
  posterFormat: PosterSizeSlug,
  productUrl: string | null,
  destinationUrl: string | null,
): boolean {
  const sourceOk = useCase === 'social_cover'
    || useCase === 'rednote_post'
    || productUrl !== null
  const bandedOk = !BANDED_SLUGS.has(posterFormat)
    || (destinationUrl !== null && destinationUrl.trim() !== '')
  return sourceOk && bandedOk
}

test('the destination half is dropped, leaving only the source-URL requirement', () => {
  assert.match(migration, /DROP CONSTRAINT campaigns_source_urls_required/)
  for (const sql of [migration, baseline]) {
    const constraint = namedConstraint(sql, 'campaigns_source_urls_required')
    assert.match(constraint, /use_case IN \('social_cover', 'rednote_post'\)/)
    assert.match(constraint, /OR product_url IS NOT NULL/)
    // The destination requirement now lives solely in the banded-format CHECK.
    assert.doesNotMatch(constraint, /destination_url/)
  }
})

test('the relaxation cannot fail on existing rows', () => {
  // The old predicate implies the new one (product_url AND destination_url =>
  // product_url), so ADD CONSTRAINT validates every pre-existing row. No
  // pre-normalizing UPDATE is needed, unlike the banded-format migration.
  const statements = migration
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
  assert.doesNotMatch(statements, /UPDATE public\.campaigns/)

  for (const productUrl of [null, 'https://source.example']) {
    for (const destinationUrl of [null, '', 'https://dest.example']) {
      for (const useCase of ['website_product', 'amazon_listing', 'event']) {
        const oldLegal = productUrl !== null && destinationUrl !== null
        const newLegal = productUrl !== null
        // Anything the old rule allowed, the new rule still allows.
        assert.equal(!oldLegal || newLegal, true, `${useCase} ${productUrl} ${destinationUrl}`)
      }
    }
  }
})

test('every unified-creation quadrant produces a legal campaign row', () => {
  // This is the check the item shipped without: "paste a URL, leave QR off"
  // previously resolved to website_product with no destination and failed 23514.
  const quadrants: Array<{
    outputKind: 'poster' | 'post'
    hasSourceUrl: boolean
    allSourceUrlsAmazon: boolean
    qrEnabled: boolean
  }> = []
  for (const outputKind of ['poster', 'post'] as const) {
    for (const hasSourceUrl of [false, true]) {
      for (const allSourceUrlsAmazon of [false, true]) {
        if (!hasSourceUrl && allSourceUrlsAmazon) continue
        for (const qrEnabled of [true, false]) {
          quadrants.push({ outputKind, hasSourceUrl, allSourceUrlsAmazon, qrEnabled })
        }
      }
    }
  }
  assert.equal(quadrants.length, 12)

  for (const q of quadrants) {
    const useCase = resolveCreationUseCase(q)
    // Multi-page post is locked to bandless 3:4 with no QR.
    const posterFormat: PosterSizeSlug = q.outputKind === 'post'
      ? 'rednote_cover_3x4'
      : q.qrEnabled ? 'a4_2x3' : 'a4_2x3_cover'
    const qrActuallyOn = q.outputKind !== 'post' && q.qrEnabled
    const destinationUrl = qrActuallyOn ? 'https://dest.example' : null
    const productUrl = q.hasSourceUrl ? 'https://source.example' : null

    assert.equal(
      campaignRowIsLegal(useCase, posterFormat, productUrl, destinationUrl),
      true,
      `illegal row for ${JSON.stringify(q)} -> ${useCase} / ${posterFormat}`,
    )
    // A banded format must always come with a destination, and vice versa the
    // bandless quadrants must be legal without one.
    assert.equal(BANDED_SLUGS.has(posterFormat), qrActuallyOn)
  }
})

test('a placement always requires a destination now, and RedNote still has none', () => {
  for (const sql of [migration, baseline]) {
    const guard = lastFunction(sql, 'guard_placement_tracking_policy')
    assert.match(
      guard,
      /v_use_case = 'rednote_post' THEN\s+RAISE EXCEPTION 'RedNote post campaigns cannot have placements\.'/,
    )
    assert.match(
      guard,
      /ELSIF NULLIF\(BTRIM\(v_destination_url\), ''\) IS NULL THEN/,
    )
    // No longer keyed on the format or on social_cover: a bandless campaign may
    // legally have no destination, so the guard cannot rely on the CHECK.
    assert.doesNotMatch(guard, /v_poster_format/)
    assert.doesNotMatch(guard, /OR v_use_case = 'social_cover'/)
    // Still reads under the same row lock.
    assert.match(
      guard,
      /WHERE id = NEW\.campaign_id\s+AND user_id = NEW\.user_id\s+FOR UPDATE/,
    )
  }
})

test('the guard tightening only ever rejects more, never less', () => {
  const previous = (
    useCase: string,
    posterFormat: PosterSizeSlug,
    destinationUrl: string | null,
  ) => {
    if (useCase === 'rednote_post') return 'REJECT'
    const blank = destinationUrl === null || destinationUrl.trim() === ''
    return blank && (BANDED_SLUGS.has(posterFormat) || useCase === 'social_cover')
      ? 'REJECT'
      : 'ALLOW'
  }
  const current = (
    useCase: string,
    _posterFormat: PosterSizeSlug,
    destinationUrl: string | null,
  ) => {
    if (useCase === 'rednote_post') return 'REJECT'
    return destinationUrl === null || destinationUrl.trim() === ''
      ? 'REJECT'
      : 'ALLOW'
  }

  const tightened: string[] = []
  for (const useCase of [
    'website_product',
    'amazon_listing',
    'social_cover',
    'rednote_post',
    'event',
  ]) {
    for (const size of POSTER_SIZES) {
      for (const destinationUrl of ['https://dest.example', null, '   ']) {
        const before = previous(useCase, size.slug, destinationUrl)
        const after = current(useCase, size.slug, destinationUrl)
        // Nothing that was rejected may become allowed.
        assert.notEqual(
          `${before}->${after}`,
          'REJECT->ALLOW',
          `loosened for ${useCase} / ${size.slug} / ${destinationUrl}`,
        )
        if (before === 'ALLOW' && after === 'REJECT') {
          tightened.push(`${useCase}/${size.slug}`)
          // Every newly rejected case is a bandless destination-less campaign —
          // exactly the state the relaxed CHECK makes legal for the first time.
          assert.equal(hasPosterQrBand(size), false)
          assert.notEqual(useCase, 'social_cover')
        }
      }
    }
  }
  assert.ok(tightened.length > 0)
})

test('the migration is append-only and leaves the pinned functions alone', () => {
  const statements = migration
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
  assert.doesNotMatch(statements, /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/m)
  assert.doesNotMatch(statements, /\bGRANT\b|\bREVOKE\b/)
  assert.doesNotMatch(statements, /enqueue_poster_generation/)
  assert.doesNotMatch(statements, /guard_poster_generation_update/)
  assert.doesNotMatch(statements, /log_visit_attributed/)
  assert.doesNotMatch(statements, /DELETE FROM public\.placements/)
  // The banded-format CHECK is untouched: it still carries the destination rule.
  assert.doesNotMatch(
    statements,
    /campaigns_banded_format_destination_required/,
  )
})
