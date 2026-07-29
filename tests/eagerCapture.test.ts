import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EAGER_CAPTURE_MAX_AGE_MS as ANALYZE_MAX_AGE_MS,
  evaluateEagerCaptureReuse,
} from '../functions/_eagerCapture.ts'
import type { DesignTokens as BackendDesignTokens } from '../functions/_shared.ts'
import type { CapturePreview } from '../src/lib/capturePreview.ts'
import {
  EAGER_CAPTURE_MAX_AGE_MS as ADOPTION_MAX_AGE_MS,
  buildEagerCapturePatch,
  clearEagerCapturePatch,
  eagerStyleBoardBlob,
  eagerStyleBoardKey,
  matchEagerCaptureForAdoption,
} from '../src/lib/eagerCapture.ts'
import { resolveCreationUseCase } from '../src/lib/useCases.ts'
import {
  runAnalyzeEagerCaptureHarness,
} from './helpers/pipelinePromptHarness.ts'

const NOW_MS = Date.parse('2026-07-21T06:30:00.000Z')
const CAPTURE_ID = '10000000-0000-4000-8000-000000000001'
const CAMPAIGN_ID = 'campaign-eager'
const NORMALIZED_URL = 'https://example.com/Products/One?Ref=ABC'
const BOARD_KEY = `style-board/${CAMPAIGN_ID}/eager/${CAPTURE_ID}.jpg`
const BOARD_URL = `https://assets.example/${BOARD_KEY}`
const HARNESS_CAMPAIGN_ID = 'campaign-fixture'
const HARNESS_BOARD_KEY =
  `style-board/${HARNESS_CAMPAIGN_ID}/eager/${CAPTURE_ID}.jpg`

test('wizard adoption requires the exact normalized URL and submit color snapshot', () => {
  const preview = capturePreview()
  assert.deepEqual(
    matchEagerCaptureForAdoption({
      preview,
      productUrl: ' Example.COM/Products/One?Ref=ABC#details ',
      useCase: 'website_product',
      colorScheme: 'dark',
      nowMs: NOW_MS,
    }),
    { matched: true, reason: 'eligible', preview },
  )

  assert.equal(adoptionReason({
    preview,
    productUrl: 'https://example.com/Products/Two',
    colorScheme: 'dark',
  }), 'url_mismatch')
  assert.equal(adoptionReason({
    preview,
    productUrl: NORMALIZED_URL,
    colorScheme: 'light',
  }), 'color_scheme_mismatch')
  assert.equal(adoptionReason({
    preview,
    productUrl: NORMALIZED_URL,
    colorScheme: 'dark',
    useCase: 'amazon_listing',
  }), 'unsupported_use_case')
})

test('wizard adoption accepts the freshness boundary and rejects future or stale evidence', () => {
  assert.equal(adoptionReason({
    preview: capturePreview({
      capturedAt: new Date(NOW_MS - ADOPTION_MAX_AGE_MS).toISOString(),
    }),
    productUrl: NORMALIZED_URL,
    colorScheme: 'dark',
  }), 'eligible')
  assert.equal(adoptionReason({
    preview: capturePreview({
      capturedAt: new Date(NOW_MS - ADOPTION_MAX_AGE_MS - 1).toISOString(),
    }),
    productUrl: NORMALIZED_URL,
    colorScheme: 'dark',
  }), 'stale')
  assert.equal(adoptionReason({
    preview: capturePreview({
      capturedAt: new Date(NOW_MS + 1).toISOString(),
    }),
    productUrl: NORMALIZED_URL,
    colorScheme: 'dark',
  }), 'captured_at_in_future')
  assert.equal(adoptionReason({
    preview: capturePreview({ designTokens: null }),
    productUrl: NORMALIZED_URL,
    colorScheme: 'dark',
  }), 'incomplete_evidence')
})

test('wizard eager board helpers enforce campaign-scoped JPEG provenance', async () => {
  assert.equal(eagerStyleBoardKey(CAMPAIGN_ID, CAPTURE_ID), BOARD_KEY)
  const blob = eagerStyleBoardBlob('data:image/jpeg;base64,YWJj')
  assert.equal(blob.type, 'image/jpeg')
  assert.equal(blob.size, 3)
  assert.deepEqual(clearEagerCapturePatch(), {
    design_tokens: null,
    brand_assets: null,
    screenshot_url: null,
    screenshot_key: null,
    eager_capture_url: null,
    eager_capture_color_scheme: null,
    eager_captured_at: null,
  })
  assert.throws(
    () => eagerStyleBoardKey(CAMPAIGN_ID, '../escape'),
    /Invalid eager capture storage identity/,
  )
})

test('wizard adoption records exclusions, candidate order, and the first included primary image', () => {
  const preview = capturePreview({
    imageUrls: [
      'https://source.example/product-one.jpg',
      'https://source.example/product-two.jpg',
      'https://source.example/product-three.jpg',
      'https://source.example/product-four.jpg',
      'https://source.example/product-five.jpg',
    ],
  })
  const patch = buildEagerCapturePatch(
    CAMPAIGN_ID,
    preview,
    { url: BOARD_URL, key: BOARD_KEY },
    {
      imageUrls: [
        'https://source.example/product-three.jpg',
        'https://source.example/product-one.jpg',
      ],
      logoExcluded: true,
    },
  )

  assert.deepEqual(patch.brand_assets, {
    logo_url: 'https://source.example/logo.png',
    images: [
      { url: 'https://source.example/product-three.jpg' },
      { url: 'https://source.example/product-one.jpg' },
      { url: 'https://source.example/product-two.jpg' },
      { url: 'https://source.example/product-four.jpg' },
    ],
    primary_image_url: 'https://source.example/product-three.jpg',
    eager_selection: {
      version: 1,
      excluded_urls: [
        'https://source.example/product-two.jpg',
        'https://source.example/product-four.jpg',
      ],
      logo_excluded: true,
    },
  })

  const allExcluded = buildEagerCapturePatch(
    CAMPAIGN_ID,
    preview,
    { url: BOARD_URL, key: BOARD_KEY },
    { imageUrls: [], logoExcluded: false },
  ).brand_assets
  assert.equal(
    Object.hasOwn(allExcluded ?? {}, 'primary_image_url'),
    false,
  )
  assert.deepEqual(
    allExcluded?.eager_selection?.excluded_urls,
    [
      'https://source.example/product-one.jpg',
      'https://source.example/product-two.jpg',
      'https://source.example/product-three.jpg',
      'https://source.example/product-four.jpg',
    ],
  )
})

test('wizard adoption rejects invalid, duplicate, and oversized candidate selections', () => {
  const preview = capturePreview({
    imageUrls: [
      'https://source.example/product-one.jpg',
      'https://source.example/product-two.jpg',
    ],
  })
  const build = (imageUrls: string[]) => buildEagerCapturePatch(
    CAMPAIGN_ID,
    preview,
    { url: BOARD_URL, key: BOARD_KEY },
    { imageUrls, logoExcluded: false },
  )

  assert.throws(
    () => build(['https://source.example/not-captured.jpg']),
    /asset selection is invalid/,
  )
  assert.throws(
    () => build([
      'https://source.example/product-one.jpg',
      'https://source.example/product-one.jpg',
    ]),
    /asset selection is invalid/,
  )
  assert.throws(
    () => build(Array.from(
      { length: 7 },
      () => 'https://source.example/product-one.jpg',
    )),
    /asset selection is invalid/,
  )
})

test('analyze legacy marker absence preserves full inclusion and candidate order', () => {
  const { campaign, generation } = analyzeSnapshots()
  const decision = evaluateEagerCaptureReuse({
    campaign,
    generation,
    colorScheme: 'dark',
    productSourceMode: 'website',
    nowMs: NOW_MS,
  })

  assert.equal(decision.reused, true)
  assert.equal(decision.reason, 'eligible')
  if (!decision.reused) return
  assert.deepEqual(decision.designTokens, designTokens())
  assert.deepEqual(decision.sourceAssets, {
    logoCandidates: ['https://source.example/logo.png'],
    images: [
      'https://source.example/product-one.jpg',
      'https://source.example/product-two.jpg',
    ],
  })
})

test('analyze accepts a snapshot-equal selection marker and preserves brand asset order', () => {
  const brandAssets = selectedSourceBrandAssets()
  const snapshots = analyzeSnapshots({
    campaign: { brand_assets: brandAssets },
    generation: { brand_assets: structuredClone(brandAssets) },
  })
  const decision = evaluateEagerCaptureReuse({
    ...snapshots,
    colorScheme: 'dark',
    productSourceMode: 'website',
    nowMs: NOW_MS,
  })

  assert.equal(decision.reused, true)
  assert.equal(decision.reason, 'eligible')
  if (!decision.reused) return
  assert.deepEqual(decision.sourceAssets, {
    logoCandidates: ['https://source.example/logo.png'],
    images: [
      'https://source.example/product-two.jpg',
      'https://source.example/product-one.jpg',
    ],
    selection: {
      excludedUrls: ['https://source.example/product-one.jpg'],
      logoExcluded: true,
    },
  })
})

test('analyze ignores malformed or unknown eager selection markers and fully includes assets', () => {
  const invalidMarkers = [
    {
      version: 2,
      excluded_urls: [],
      logo_excluded: false,
    },
    {
      version: 1,
      excluded_urls: ['https://source.example/not-captured.jpg'],
      logo_excluded: false,
    },
    {
      version: 1,
      excluded_urls: ['data:image/png;base64,YQ=='],
      logo_excluded: false,
    },
    {
      version: 1,
      excluded_urls: [
        'https://source.example/product-one.jpg',
        'https://source.example/product-one.jpg',
      ],
      logo_excluded: false,
    },
    {
      version: 1,
      excluded_urls: Array.from(
        { length: 7 },
        () => 'https://source.example/product-one.jpg',
      ),
      logo_excluded: false,
    },
    {
      version: 1,
      excluded_urls: ['https://source.example/product-one.jpg'],
      logo_excluded: 'yes',
    },
    {
      version: 1,
      excluded_urls: [],
      logo_excluded: false,
      future_field: true,
    },
  ]

  for (const eagerSelection of invalidMarkers) {
    const brandAssets = {
      ...selectedSourceBrandAssets(),
      eager_selection: eagerSelection,
    }
    const decision = evaluateEagerCaptureReuse({
      ...analyzeSnapshots({
        campaign: { brand_assets: brandAssets },
        generation: { brand_assets: structuredClone(brandAssets) },
      }),
      colorScheme: 'dark',
      productSourceMode: 'website',
      nowMs: NOW_MS,
    })
    assert.equal(decision.reused, true)
    if (!decision.reused) continue
    assert.deepEqual(decision.sourceAssets, {
      logoCandidates: ['https://source.example/logo.png'],
      images: [
        'https://source.example/product-two.jpg',
        'https://source.example/product-one.jpg',
      ],
    })
  }
})

test('analyze freshness is inclusive at 30 minutes and rejects stale or future markers', () => {
  const exact = analyzeSnapshots({
    campaign: {
      eager_captured_at: new Date(NOW_MS - ANALYZE_MAX_AGE_MS).toISOString(),
    },
  })
  assert.equal(analyzeReason(exact), 'eligible')

  const stale = analyzeSnapshots({
    campaign: {
      eager_captured_at: new Date(NOW_MS - ANALYZE_MAX_AGE_MS - 1).toISOString(),
    },
  })
  assert.equal(analyzeReason(stale), 'stale')

  const future = analyzeSnapshots({
    campaign: {
      eager_captured_at: new Date(NOW_MS + 1).toISOString(),
    },
  })
  assert.equal(analyzeReason(future), 'captured_at_in_future')
})

test('analyze rejects every identity, source, completeness, and snapshot mismatch gate', () => {
  const cases = [
    {
      expected: 'missing_marker',
      snapshots: analyzeSnapshots({
        campaign: {
          eager_capture_url: null,
          eager_capture_color_scheme: null,
          eager_captured_at: null,
          screenshot_url: null,
          screenshot_key: null,
        },
        generation: {
          screenshot_url: null,
          screenshot_key: null,
        },
      }),
    },
    {
      expected: 'not_first_generation',
      snapshots: analyzeSnapshots({
        generation: { parent_generation_id: 'generation-parent' },
      }),
    },
    {
      expected: 'unsupported_use_case',
      snapshots: analyzeSnapshots({
        campaign: { use_case: 'amazon_listing' },
      }),
    },
    {
      expected: 'url_mismatch',
      snapshots: analyzeSnapshots({
        campaign: { eager_capture_url: 'https://example.com/other' },
      }),
    },
    {
      expected: 'color_scheme_mismatch',
      snapshots: analyzeSnapshots({
        campaign: { eager_capture_color_scheme: 'light' },
      }),
    },
    {
      expected: 'missing_design_tokens',
      snapshots: analyzeSnapshots({
        generation: { design_tokens: null },
      }),
    },
    {
      expected: 'invalid_style_board_key',
      snapshots: analyzeSnapshots({
        campaign: { screenshot_key: 'style-board/not-eager.jpg' },
        generation: { screenshot_key: 'style-board/not-eager.jpg' },
      }),
    },
    {
      expected: 'invalid_style_board_url',
      snapshots: analyzeSnapshots({
        campaign: { screenshot_url: 'data:image/jpeg;base64,YWJj' },
        generation: { screenshot_url: 'data:image/jpeg;base64,YWJj' },
      }),
    },
    {
      expected: 'missing_design_tokens',
      snapshots: analyzeSnapshots({
        campaign: {
          design_tokens: {
            ...designTokens(),
            spacing: [],
          },
        },
        generation: {
          design_tokens: {
            ...designTokens(),
            spacing: [],
          },
        },
      }),
    },
    {
      expected: 'invalid_brand_assets',
      snapshots: analyzeSnapshots({
        campaign: { brand_assets: { images: [{ url: 'data:image/png;base64,YQ==' }] } },
        generation: { brand_assets: { images: [{ url: 'data:image/png;base64,YQ==' }] } },
      }),
    },
    {
      expected: 'snapshot_mismatch',
      snapshots: analyzeSnapshots({
        generation: {
          brand_assets: {
            logo_url: 'https://source.example/logo.png',
            images: [{ url: 'https://source.example/different.jpg' }],
          },
        },
      }),
    },
  ] as const

  for (const fixture of cases) {
    assert.equal(analyzeReason(fixture.snapshots), fixture.expected)
  }

  const unsupportedSource = analyzeSnapshots()
  assert.equal(
    evaluateEagerCaptureReuse({
      ...unsupportedSource,
      colorScheme: 'dark',
      productSourceMode: 'amazon-reference',
      nowMs: NOW_MS,
    }).reason,
    'unsupported_source_mode',
  )
})

test('runAnalyzeStage reuse skips capture and still rehosts every final brand URL', async () => {
  const result = await runAnalyzeEagerCaptureHarness('reuse')

  assert.equal(result.status, 200)
  assert.equal(result.captureRequests.length, 0)
  assert.deepEqual(result.captureLogs, [])
  assert.deepEqual(result.sourceImageRequests, [
    'https://source.example/fresh-logo.png',
    'https://source.example/eager-logo.png',
    'https://source.example/fresh-product.jpg',
    'https://source.example/eager-product.jpg',
  ])
  assert.deepEqual(
    result.storageUploads.filter((key) => key.startsWith('brand/')),
    [
      `brand/${HARNESS_CAMPAIGN_ID}/generation-fixture/logo-2.png`,
      `brand/${HARNESS_CAMPAIGN_ID}/generation-fixture/img-1.png`,
      `brand/${HARNESS_CAMPAIGN_ID}/generation-fixture/img-2.png`,
    ],
  )
  assert.equal(
    result.storageUploads.some((key) => key.startsWith('style-board/')),
    false,
  )
  assert.equal(result.generation.screenshot_key, HARNESS_BOARD_KEY)
  const brandAssets = result.generation.brand_assets as {
    logo_url?: string
    images?: Array<{ url?: string }>
  }
  assert.match(brandAssets.logo_url ?? '', /^https:\/\/assets\.example\/brand\//)
  assert.equal(brandAssets.images?.length, 2)
  for (const image of brandAssets.images ?? []) {
    assert.match(image.url ?? '', /^https:\/\/assets\.example\/brand\//)
    assert.doesNotMatch(image.url ?? '', /^https:\/\/source\.example\//)
  }
  assert.equal(result.traceMetadata.eager_capture_reused, true)
  assert.equal(result.traceMetadata.eager_capture_reason, 'eligible')
})

test('runAnalyzeStage applies eager exclusions before fetch/rehost and traces counts without URLs', async () => {
  const result = await runAnalyzeEagerCaptureHarness('selection')

  assert.equal(result.status, 200)
  assert.equal(result.captureRequests.length, 0)
  assert.deepEqual(result.sourceImageRequests, [
    'https://source.example/eager-product-two.jpg',
    'https://source.example/eager-product-one.jpg',
  ])
  assert.equal(
    result.sourceImageRequests.includes(
      'https://source.example/eager-product-excluded.jpg',
    ),
    false,
  )
  assert.equal(
    result.sourceImageRequests.some((url) => url.includes('logo')),
    false,
  )
  assert.deepEqual(
    result.storageUploads.filter((key) => key.startsWith('brand/')),
    [
      `brand/${HARNESS_CAMPAIGN_ID}/generation-fixture/img-1.png`,
      `brand/${HARNESS_CAMPAIGN_ID}/generation-fixture/img-2.png`,
    ],
  )
  assert.deepEqual(result.traceMetadata, {
    scenario: 'product',
    source_mode: 'website',
    used_fallback: false,
    eager_capture_reused: true,
    eager_capture_reason: 'eligible',
    eager_asset_selection_applied: true,
    eager_asset_excluded_count: 1,
    eager_logo_excluded: true,
  })
  assert.equal(
    JSON.stringify(result.traceMetadata).includes('source.example'),
    false,
  )
})

test('runAnalyzeStage stale eager evidence captures once and ignores the stale board', async () => {
  const result = await runAnalyzeEagerCaptureHarness('stale')

  assert.equal(result.status, 200)
  assert.deepEqual(result.captureRequests, [{
    url: 'https://example.com/products/northstar',
    color_scheme: 'light',
  }])
  assert.equal(result.captureLogs.length, 1)
  assert.deepEqual(
    captureBoundaryLog(result.captureLogs[0]),
    {
      event: 'capture_site_request',
      target_host: 'example.com',
      color_scheme: 'light',
    },
  )
  assert.equal(result.captureLogs[0].includes('/products/northstar'), false)
  assert.equal(result.captureLogs[0].includes('fixture-capture-token'), false)
  assert.equal(result.generation.screenshot_url, null)
  assert.equal(result.generation.screenshot_key, null)
  assert.equal(result.generation.design_tokens, null)
  assert.equal(
    result.storageUploads.some((key) => key.startsWith('brand/')),
    true,
  )
  assert.equal(result.traceMetadata.eager_capture_reused, false)
  assert.equal(result.traceMetadata.eager_capture_reason, 'stale')
})

test('runAnalyzeStage without preview preserves the normal capture and trace shape', async () => {
  const result = await runAnalyzeEagerCaptureHarness('no-preview')

  assert.equal(result.status, 200)
  assert.equal(result.captureRequests.length, 1)
  assert.equal(
    result.storageUploads.some((key) =>
      key === `style-board/${HARNESS_CAMPAIGN_ID}/generation-fixture/style-board.jpg`
    ),
    true,
  )
  assert.equal(
    Object.hasOwn(result.traceMetadata, 'eager_capture_reused'),
    false,
  )
  assert.equal(
    Object.hasOwn(result.traceMetadata, 'eager_capture_reason'),
    false,
  )
  assert.deepEqual(
    Object.keys(result.traceMetadata).sort(),
    ['scenario', 'source_mode', 'used_fallback'],
  )
})

function adoptionReason({
  preview,
  productUrl,
  colorScheme,
  useCase = 'website_product',
}: {
  preview: CapturePreview | null
  productUrl: string
  colorScheme: 'light' | 'dark'
  useCase?: 'website_product' | 'amazon_listing'
}) {
  return matchEagerCaptureForAdoption({
    preview,
    productUrl,
    useCase,
    colorScheme,
    nowMs: NOW_MS,
  }).reason
}

function captureBoundaryLog(value: string) {
  const parsed = JSON.parse(value) as Record<string, unknown>
  return {
    event: parsed.event,
    target_host: parsed.target_host,
    color_scheme: parsed.color_scheme,
  }
}

function analyzeReason(
  snapshots: ReturnType<typeof analyzeSnapshots>,
): string {
  return evaluateEagerCaptureReuse({
    ...snapshots,
    colorScheme: 'dark',
    productSourceMode: 'website',
    nowMs: NOW_MS,
  }).reason
}

function analyzeSnapshots({
  campaign: campaignOverrides = {},
  generation: generationOverrides = {},
}: {
  campaign?: Record<string, unknown>
  generation?: Record<string, unknown>
} = {}) {
  const tokens = designTokens()
  const sourceAssets = {
    logo_url: 'https://source.example/logo.png',
    images: [
      { url: 'https://source.example/product-one.jpg' },
      { url: 'https://source.example/product-two.jpg' },
    ],
    primary_image_url: 'https://source.example/product-one.jpg',
  }
  const campaign = {
    id: CAMPAIGN_ID,
    product_url: ' Example.COM/Products/One?Ref=ABC#details ',
    scenario: 'product',
    use_case: 'website_product',
    design_tokens: tokens,
    brand_assets: sourceAssets,
    screenshot_url: BOARD_URL,
    screenshot_key: BOARD_KEY,
    eager_capture_url: NORMALIZED_URL,
    eager_capture_color_scheme: 'dark',
    eager_captured_at: new Date(NOW_MS - 10 * 60 * 1000).toISOString(),
    ...campaignOverrides,
  }
  const generation = {
    parent_generation_id: null,
    generation_mode: 'website_refresh',
    scenario: 'product',
    use_case: 'website_product',
    design_tokens: structuredClone(tokens),
    brand_assets: structuredClone(sourceAssets),
    screenshot_url: BOARD_URL,
    screenshot_key: BOARD_KEY,
    ...generationOverrides,
  }
  return { campaign, generation }
}

function selectedSourceBrandAssets() {
  return {
    logo_url: 'https://source.example/logo.png',
    images: [
      { url: 'https://source.example/product-two.jpg' },
      { url: 'https://source.example/product-one.jpg' },
    ],
    primary_image_url: 'https://source.example/product-two.jpg',
    eager_selection: {
      version: 1,
      excluded_urls: ['https://source.example/product-one.jpg'],
      logo_excluded: true,
    },
  }
}

function capturePreview(
  overrides: Partial<CapturePreview> = {},
): CapturePreview {
  return {
    sourceUrl: NORMALIZED_URL,
    captureId: CAPTURE_ID,
    capturedAt: new Date(NOW_MS - 10 * 60 * 1000).toISOString(),
    colorScheme: 'dark',
    designTokens: designTokens(),
    styleBoardDataUrl: 'data:image/jpeg;base64,YWJj',
    logoUrl: 'https://source.example/logo.png',
    imageUrls: ['https://source.example/product-one.jpg'],
    colors: ['#235789'],
    fonts: ['Space Grotesk'],
    ...overrides,
  }
}

function designTokens(): BackendDesignTokens {
  return {
    typography: {
      headingFamily: 'Space Grotesk',
      bodyFamily: 'Inter',
      scale: [16, 24, 48],
      weights: [400, 700],
    },
    colors: {
      bg: '#f7f4ed',
      text: '#152238',
      primary: '#235789',
      accent: '#f45b69',
      palette: ['#235789', '#f45b69'],
      visualPalette: [{ color: '#235789', proportion: 0.6 }],
      theme: 'light',
    },
    radii: [4, 8],
    shadows: [],
    spacing: [8, 16, 24],
    button: null,
    fontLinks: [],
  }
}

// Item 4 confirmation: the capture gates key on the 'website_product' literal, and
// the creation mapping still resolves a non-Amazon source URL to exactly that
// literal — so eager capture keeps firing without re-keying any gate.
test('the creation mapping still satisfies the website_product capture gate', () => {
  const useCase = resolveCreationUseCase({
    hasSourceUrl: true,
    primarySourceUrlIsAmazon: false,
    outputKind: 'poster',
  })
  assert.equal(useCase, 'website_product')

  const sourceUrl = 'https://example.com/product'
  const preview = {
    sourceUrl,
    colorScheme: 'light',
    captureId: 'capture-1',
    capturedAtMs: 1_000,
    screenshotB64: 'AAA',
    rawTokens: null,
  }
  const match = matchEagerCaptureForAdoption({
    preview: preview as never,
    productUrl: sourceUrl,
    useCase,
    colorScheme: 'light',
    nowMs: 2_000,
  })
  assert.notEqual(match.reason, 'unsupported_use_case')

  // The gate must still reject every other literal the mapping can produce.
  for (const other of ['amazon_listing', 'social_cover', 'rednote_post'] as const) {
    assert.deepEqual(
      matchEagerCaptureForAdoption({
        preview: preview as never,
        productUrl: sourceUrl,
        useCase: other,
        colorScheme: 'light',
        nowMs: 2_000,
      }),
      { matched: false, reason: 'unsupported_use_case' },
    )
  }
})
