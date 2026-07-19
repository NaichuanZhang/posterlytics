import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AssetSelectionValidationError,
  buildGenerationAssetCandidates,
  deterministicAssetSelection,
  validateGenerationAssetCandidates,
  validateYoloSelection,
} from '../functions/_assetSelection.ts'
import { prepareImageReferences } from '../functions/_shared.ts'

const generation = {
  generation_mode: 'iteration' as const,
  scenario: 'product',
  use_case: 'website_product',
  reference_images: [{
    key: 'references/support.png',
    url: 'https://assets.example/support.png',
    name: 'support.png',
    mime_type: 'image/png',
    size_bytes: 100,
  }],
  brand_assets: {
    logo_url: 'https://assets.example/logo.png',
    logo_key: 'brand/logo.png',
    primary_image_url: 'https://assets.example/product.png',
    images: [
      { url: 'https://assets.example/product.png', key: 'brand/product.png' },
      { url: 'https://assets.example/product-2.png', key: 'brand/product-2.png' },
    ],
  },
  screenshot_url: 'https://assets.example/style.png',
  screenshot_key: 'capture/style.png',
}

test('candidate construction deduplicates primary product imagery and preserves source order', () => {
  const candidates = buildGenerationAssetCandidates(generation, {
    hero_image_url: 'https://assets.example/previous.png',
    hero_image_key: 'poster/previous.png',
  })
  assert.deepEqual(candidates.map((candidate) => candidate.kind), [
    'previous-poster',
    'user-reference',
    'logo',
    'product',
    'product',
    'style-board',
  ])
  assert.equal(
    candidates.filter((candidate) => candidate.url.endsWith('/product.png')).length,
    1,
  )
  assert.equal(new Set(candidates.map((candidate) => candidate.candidateKey)).size, 6)
})

test('candidate purposes are selected through use-case recipes without prompt drift', () => {
  const website = buildGenerationAssetCandidates(generation, {
    hero_image_url: 'https://assets.example/previous.png',
    hero_image_key: 'poster/previous.png',
  })
  const amazon = buildGenerationAssetCandidates({
    ...generation,
    use_case: 'amazon_listing',
  }, {
    hero_image_url: 'https://assets.example/previous.png',
    hero_image_key: 'poster/previous.png',
  })

  assert.deepEqual(
    amazon.map((candidate) => candidate.purpose),
    website.map((candidate) => candidate.purpose),
  )
  assert.deepEqual(website.map((candidate) => candidate.purpose), [
    'Primary edit source; preserve every visual choice not explicitly changed by the user.',
    'User-supplied creative reference 1; use it only where it supports the requested change.',
    'Authentic brand logo; reproduce it faithfully when included.',
    'Authentic product or brand image 1; preserve its real subject and visual details.',
    'Authentic product or brand image 3; preserve its real subject and visual details.',
    'Website evidence for palette, typography, imagery treatment, lighting, texture, motifs, and density.',
  ])
})

test('event candidates retain the bespoke no-product path', () => {
  const candidates = buildGenerationAssetCandidates({
    ...generation,
    scenario: 'event',
    use_case: 'event',
  }, null)

  assert.equal(candidates.some((candidate) => candidate.kind === 'product'), false)
  assert.deepEqual(candidates.map((candidate) => candidate.kind), [
    'user-reference',
    'logo',
    'style-board',
  ])
})

test('candidate validation retains unavailable rows with auditable reasons', async () => {
  const candidates = buildGenerationAssetCandidates(generation, null).slice(0, 2)
  const validated = await validateGenerationAssetCandidates(
    candidates,
    async (url) => url.includes('support')
      ? {
          ok: false as const,
          reason: 'unsupported_format' as const,
          detail: 'Fetched content is not a supported raster image.',
          sizeBytes: 42,
        }
      : {
          ok: true as const,
          dataUrl: 'data:image/png;base64,AA==',
          mimeType: 'image/png',
          sizeBytes: 1,
        },
  )
  assert.deepEqual(validated.map((asset) => asset.availability), [
    'unavailable',
    'available',
  ])
  assert.match(validated[0].availabilityReason ?? '', /supported raster/)
  assert.equal(validated[0].sizeBytes, 42)
})

test('Yolo output requires ordered unique available IDs and reasons', () => {
  assert.deepEqual(
    validateYoloSelection({
      selections: [
        { id: 'asset-b', reason: 'First visual anchor.' },
        { id: 'asset-a', reason: 'Second supporting reference.' },
      ],
    }, ['asset-a', 'asset-b']),
    {
      assetIds: ['asset-b', 'asset-a'],
      reasons: {
        'asset-b': 'First visual anchor.',
        'asset-a': 'Second supporting reference.',
      },
    },
  )
  assert.throws(
    () => validateYoloSelection({
      selections: [{ id: 'asset-a', reason: '' }],
    }, ['asset-a']),
    AssetSelectionValidationError,
  )
  assert.throws(
    () => validateYoloSelection({
      selections: [
        { id: 'asset-a', reason: 'One' },
        { id: 'asset-a', reason: 'Duplicate' },
      ],
    }, ['asset-a']),
    /duplicate/,
  )
})

test('deterministic fallback is stage-aware, available-only, and capped at six', async () => {
  const candidates = buildGenerationAssetCandidates({
    ...generation,
    generation_mode: 'website_refresh',
    reference_images: Array.from({ length: 5 }, (_, index) => ({
      url: `https://assets.example/reference-${index}.png`,
      key: `reference-${index}`,
    })),
  }, {
    hero_image_url: 'https://assets.example/previous.png',
    hero_image_key: 'poster/previous.png',
  })
  const validated = await validateGenerationAssetCandidates(
    candidates,
    async () => ({
      ok: true as const,
      dataUrl: 'data:image/png;base64,AA==',
      mimeType: 'image/png',
      sizeBytes: 1,
    }),
  )
  const selection = deterministicAssetSelection(validated, 'website_refresh')
  assert.equal(selection.assetIds.length, 6)
  const selectedKinds = selection.assetIds.map(
    (id) => validated.find((asset) => asset.id === id)?.candidate.kind,
  )
  assert.deepEqual(selectedKinds.slice(0, 2), ['previous-poster', 'style-board'])
})

test('provider preparation preserves the frozen order and never substitutes failed selections', async () => {
  const references = [
    { assetId: 'three', kind: 'product' as const, url: 'https://x/three.png', purpose: 'Three' },
    { assetId: 'one', kind: 'previous-poster' as const, url: 'https://x/one.png', purpose: 'One' },
    { assetId: 'two', kind: 'logo' as const, url: 'https://x/two.png', purpose: 'Two' },
  ]
  const prepared = await prepareImageReferences(references, {
    ordering: 'preserve',
    maxImages: 6,
    maxCandidates: 6,
    fetcher: async (url) => url.includes('/one.')
      ? { ok: false, reason: 'fetch_failed', detail: 'Expected failure.' }
      : {
          ok: true,
          dataUrl: `data:image/png;base64,${url.includes('three') ? 'Mw==' : 'Mg=='}`,
          mimeType: 'image/png',
          sizeBytes: 1,
        },
  })
  assert.deepEqual(
    prepared.providerReferences.map((reference) => reference.assetId),
    ['three', 'two'],
  )
  assert.deepEqual(
    prepared.attachedImages.map((asset) => asset.asset_id),
    ['three', 'two'],
  )
  assert.equal(prepared.skippedImages[0].asset.asset_id, 'one')
})
