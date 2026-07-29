import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { useCaseSourceMismatch } from '../functions/_useCasePolicy.ts'
import { resolveCreationUseCase } from '../src/lib/useCases.ts'
import {
  MAX_SOURCE_URLS,
  additionalSourceUrls,
  buildSourceUrlWrite,
  creationSourceSignals,
  normalizeSourceUrls,
  primarySourceUrl,
} from '../src/lib/sourceUrls.ts'
import { matchEagerCaptureForAdoption } from '../src/lib/eagerCapture.ts'
import { runAnalyzeSourceUrlsHarness } from './helpers/pipelinePromptHarness.ts'

const migration = readFileSync(
  new URL('../migrations/20260728010000_campaign-source-urls.sql', import.meta.url),
  'utf8',
)
const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')

test('normalization trims, drops blanks, de-duplicates, and caps at three', () => {
  assert.equal(MAX_SOURCE_URLS, 3)
  assert.deepEqual(normalizeSourceUrls(['  https://a.example  ']), [
    'https://a.example',
  ])
  assert.deepEqual(
    normalizeSourceUrls(['https://a.example', '', '   ', 'https://b.example']),
    ['https://a.example', 'https://b.example'],
  )
  assert.deepEqual(
    normalizeSourceUrls(['https://a.example', 'https://a.example']),
    ['https://a.example'],
  )
  assert.deepEqual(
    normalizeSourceUrls([
      'https://a.example',
      'https://b.example',
      'https://c.example',
      'https://d.example',
    ]),
    ['https://a.example', 'https://b.example', 'https://c.example'],
  )
  // Non-arrays and non-string members can arrive from a legacy or hand-edited row.
  for (const value of [null, undefined, '', 'https://a.example', {}, 42]) {
    assert.deepEqual(normalizeSourceUrls(value), [])
  }
  assert.deepEqual(normalizeSourceUrls([1, null, 'https://a.example', {}]), [
    'https://a.example',
  ])
})

test('the captured source is always the first entry and the tail is context only', () => {
  assert.equal(primarySourceUrl(['https://a.example', 'https://b.example']), 'https://a.example')
  assert.equal(primarySourceUrl([]), null)
  assert.equal(primarySourceUrl(null), null)
  assert.deepEqual(additionalSourceUrls(['https://a.example']), [])
  assert.deepEqual(
    additionalSourceUrls(['https://a.example', 'https://b.example', 'https://c.example']),
    ['https://b.example', 'https://c.example'],
  )
})

test('the persisted scalar and array cannot drift', () => {
  assert.deepEqual(buildSourceUrlWrite(['  https://a.example ', 'https://b.example']), {
    product_url: 'https://a.example',
    source_urls: ['https://a.example', 'https://b.example'],
  })
  assert.deepEqual(buildSourceUrlWrite([]), {
    product_url: null,
    source_urls: [],
  })
  const write = buildSourceUrlWrite(['https://a.example', 'https://b.example'])
  assert.equal(write.product_url, write.source_urls[0])
})

test('migration constrains the shape and freezes the set after a generation exists', () => {
  assert.match(
    migration,
    /ADD COLUMN source_urls JSONB NOT NULL DEFAULT '\[\]'::jsonb/,
  )
  const shape = migration.slice(
    migration.indexOf('campaigns_source_urls_shape'),
  )
  assert.match(shape, /jsonb_typeof\(source_urls\) = 'array'/)
  assert.match(shape, /jsonb_array_length\(source_urls\) <= 3/)
  // Rejects a non-string member and a blank/whitespace-only entry.
  assert.match(shape, /jsonb_typeof\(entry\.value\) <> 'string'/)
  assert.match(shape, /NULLIF\(BTRIM\(entry\.value #>> '\{\}'\), ''\) IS NULL/)

  for (const sql of [migration, baseline]) {
    // Anchor on the definition, not the trigger's EXECUTE FUNCTION reference.
    const definitions = [
      ...sql.matchAll(
        /CREATE(?: OR REPLACE)? FUNCTION public\.guard_campaign_source_intent_update\(/g,
      ),
    ]
    const start = definitions.at(-1)?.index ?? -1
    assert.ok(start >= 0)
    const guard = sql.slice(start, sql.indexOf('\n$$;', start) + 4)
    const tuple = guard.match(/IF \(\s*([\s\S]*?)\s*\) IS NOT DISTINCT FROM \(/)
    assert.ok(tuple)
    assert.deepEqual(
      [...tuple[1].matchAll(/NEW\.([a-z_]+)/g)].map((match) => match[1]),
      ['product_url', 'use_case', 'source_urls'],
    )
    assert.match(
      sql,
      /BEFORE UPDATE OF product_url, use_case, source_urls ON public\.campaigns/,
    )
  }

  // The pinned generation functions must not be touched by this migration.
  // Compare executable SQL only: the header comment names them as rationale.
  const statements = migration
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
  assert.doesNotMatch(statements, /enqueue_poster_generation/)
  assert.doesNotMatch(statements, /guard_poster_generation_update/)
  // No plural column on poster_generations: analyze reads the campaign row.
  assert.doesNotMatch(statements, /ALTER TABLE public\.poster_generations/)
})

test('the baseline grants and constrains source_urls alongside the scalar', () => {
  assert.match(
    baseline,
    /CREATE TABLE public\.campaigns[\s\S]*?source_urls JSONB NOT NULL DEFAULT '\[\]'::jsonb/,
  )
  assert.match(
    baseline,
    /GRANT INSERT \([\s\S]*?source_urls[\s\S]*?\) ON public\.campaigns TO authenticated/,
  )
  assert.match(
    baseline,
    /GRANT UPDATE \([\s\S]*?source_urls[\s\S]*?\) ON public\.campaigns TO authenticated/,
  )
  assert.match(baseline, /CONSTRAINT campaigns_source_urls_shape/)
})

test('a single-URL campaign acquires once and emits no additional-source line', async () => {
  const result = await runAnalyzeSourceUrlsHarness(['https://source.example'])

  assert.deepEqual(result.htmlRequests, ['https://source.example'])
  assert.equal(result.captureRequests.length, 1)
  assert.equal(result.captureRequests[0].url, 'https://source.example')
  assert.match(result.prompt, /PRODUCT URL: https:\/\/source\.example\n/)
  assert.doesNotMatch(result.prompt, /ADDITIONAL SOURCE URL/)
})

test('extra URLs are declared context only: still exactly one fetch and one capture', async () => {
  const result = await runAnalyzeSourceUrlsHarness([
    'https://source.example',
    'https://second.example/spec',
    'https://third.example/review',
  ])

  // The fixture fetch handler throws on any URL but the first, so these counts
  // also prove URLs 2-3 were never acquired.
  assert.deepEqual(result.htmlRequests, ['https://source.example'])
  assert.equal(result.captureRequests.length, 1)
  assert.equal(result.captureRequests[0].url, 'https://source.example')

  const lines = result.prompt.split('\n')
  assert.deepEqual(
    lines.filter((line) => line.startsWith('ADDITIONAL SOURCE URL: ')),
    [
      'ADDITIONAL SOURCE URL: https://second.example/spec',
      'ADDITIONAL SOURCE URL: https://third.example/review',
    ],
  )
  // The captured source keeps its own dedicated line and is not repeated.
  assert.equal(
    lines.filter((line) => line === 'PRODUCT URL: https://source.example').length,
    1,
  )
  assert.equal(
    result.prompt.split('ADDITIONAL SOURCE URL:').length - 1,
    2,
  )
})

test('the additional-source block sits directly after the captured product URL', async () => {
  const result = await runAnalyzeSourceUrlsHarness([
    'https://source.example',
    'https://second.example/spec',
  ])
  const lines = result.prompt.split('\n')
  const productIndex = lines.indexOf('PRODUCT URL: https://source.example')
  assert.ok(productIndex >= 0)
  assert.equal(
    lines[productIndex + 1],
    'ADDITIONAL SOURCE URL: https://second.example/spec',
  )
  assert.match(lines[productIndex + 2], /^VISUAL EVIDENCE SOURCE: /)
})

test('eager-capture matching stays single-source against source_urls[0]', () => {
  // Already in normalizeCaptureUrl's canonical form, since the matcher requires
  // preview.sourceUrl to equal its own normalization.
  const sourceUrls = [
    'https://source.example/',
    'https://second.example/spec',
    'https://third.example/review',
  ]
  const primary = primarySourceUrl(sourceUrls)
  assert.equal(primary, 'https://source.example/')

  const preview = {
    sourceUrl: primary!,
    colorScheme: 'light',
    captureId: 'capture-1',
    capturedAtMs: 1_000,
    screenshotB64: 'AAA',
    rawTokens: null,
  }

  // The matcher takes ONE scalar productUrl, which the invariant pins to
  // source_urls[0]. Matching against the primary succeeds...
  assert.notEqual(
    matchEagerCaptureForAdoption({
      preview: preview as never,
      productUrl: primary!,
      useCase: 'website_product',
      colorScheme: 'light',
      nowMs: 2_000,
    }).reason,
    'url_mismatch',
  )

  // ...and a preview captured from a declared-but-uncaptured URL never adopts,
  // so an extra URL can never smuggle in evidence the poster was not built from.
  for (const other of additionalSourceUrls(sourceUrls)) {
    assert.deepEqual(
      matchEagerCaptureForAdoption({
        preview: { ...preview, sourceUrl: other } as never,
        productUrl: primary!,
        useCase: 'website_product',
        colorScheme: 'light',
        nowMs: 2_000,
      }),
      { matched: false, reason: 'url_mismatch' },
    )
  }
})

test('creation signals key on the fetched URL so the mismatch guard is unreachable', () => {
  const amazon = 'https://www.amazon.com/dp/B0EXAMPLE'
  const website = 'https://other.example/spec'

  // The captured URL decides, because product_url IS source_urls[0].
  assert.deepEqual(creationSourceSignals([amazon, website]), {
    hasSourceUrl: true,
    primarySourceUrlIsAmazon: true,
  })
  assert.deepEqual(creationSourceSignals([website, amazon]), {
    hasSourceUrl: true,
    primarySourceUrlIsAmazon: false,
  })
  assert.deepEqual(creationSourceSignals([]), {
    hasSourceUrl: false,
    primarySourceUrlIsAmazon: false,
  })
  assert.deepEqual(creationSourceSignals(null), {
    hasSourceUrl: false,
    primarySourceUrlIsAmazon: false,
  })

  // The pairing that previously self-destructed: a mixed set is now resolved from
  // whichever URL will actually be persisted as product_url, so
  // useCaseSourceMismatch can never fire on a freshly created campaign.
  for (const urls of [
    [amazon, website],
    [website, amazon],
    [amazon],
    [website],
    [amazon, amazon, website],
  ]) {
    const signals = creationSourceSignals(urls)
    const useCase = resolveCreationUseCase({ ...signals, outputKind: 'poster' })
    const write = buildSourceUrlWrite(urls)
    assert.equal(useCase, signals.primarySourceUrlIsAmazon ? 'amazon_listing' : 'website_product')
    assert.equal(useCaseSourceMismatch(useCase, write.product_url), null)
  }
})

test('multi-page post output ignores source evidence entirely', () => {
  // enqueue_poster_generation demands >=1 reference image AND a non-null
  // instruction for rednote_post, and outputKind short-circuits before any URL is
  // read — so a pasted URL must never be treated as relaxing those requirements.
  for (const urls of [[], ['https://a.example'], ['https://www.amazon.com/dp/B0X']]) {
    assert.equal(
      resolveCreationUseCase({
        ...creationSourceSignals(urls),
        outputKind: 'post',
      }),
      'rednote_post',
    )
  }
})
