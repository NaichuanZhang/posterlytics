import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deriveGenerationProvidedImages,
  deriveGenerationPreflight,
  deriveGenerationUsedImages,
  reconstructLegacyImageAssets,
} from '../src/lib/generationTraces.ts'
import type {
  Campaign,
  PosterGeneration,
  TraceImageAsset,
} from '../src/lib/types.ts'

const CURRENT = {
  id: 'generation-current',
  campaign_id: 'campaign-1',
  parent_generation_id: 'generation-old',
  version_number: 3,
  status: 'ready',
  generation_mode: 'iteration',
  instruction: 'Current',
  reference_images: [],
  brand_assets: {
    logo_url: 'https://assets.example/logo.png',
    logo_key: 'brand/logo.png',
    images: [
      { url: 'https://assets.example/product.png', key: 'brand/product.png' },
    ],
  },
  screenshot_url: 'https://assets.example/board.jpg',
  screenshot_key: 'boards/current.jpg',
  hero_image_url: 'https://assets.example/poster.png',
  hero_image_key: 'poster/current.png',
  trace_schema_version: 1,
  trace_incomplete: false,
} as unknown as PosterGeneration

const SELECTED = {
  ...CURRENT,
  id: 'generation-selected',
  version_number: 2,
} as PosterGeneration

const CAMPAIGN = {
  id: 'campaign-1',
  current_generation_id: CURRENT.id,
  product_url: 'https://example.com/product',
  use_case: 'website_product',
  brand_assets: CURRENT.brand_assets,
  screenshot_url: CURRENT.screenshot_url,
  screenshot_key: CURRENT.screenshot_key,
} as unknown as Campaign

test('preflight uses the current version as parent even when the canvas shows another version', () => {
  const preflight = deriveGenerationPreflight({
    campaign: CAMPAIGN,
    currentGeneration: CURRENT,
    selectedGeneration: SELECTED,
    instruction: '  Make the title larger  ',
    pendingReferences: [{
      id: 'support',
      kind: 'url',
      url: 'https://assets.example/support.png',
      name: 'support.png',
      previewStatus: 'ready',
    }],
    refreshWebsite: false,
  })

  assert.equal(preflight.parent?.id, CURRENT.id)
  assert.equal(preflight.selectedDiffersFromParent, true)
  assert.equal(preflight.instruction, 'Make the title larger')
  assert.deepEqual(preflight.assets.map((asset) => asset.source), [
    'previous-poster',
    'user-reference',
    'logo',
    'product',
    'style-board',
  ])
})

test('website-refresh preflight labels runtime-discovered assets as expected placeholders', () => {
  const preflight = deriveGenerationPreflight({
    campaign: CAMPAIGN,
    currentGeneration: CURRENT,
    selectedGeneration: CURRENT,
    instruction: '',
    pendingReferences: [],
    refreshWebsite: true,
  })

  assert.deepEqual(
    preflight.assets.filter((asset) => asset.runtime).map((asset) => asset.source),
    ['logo', 'product', 'style-board'],
  )
  assert.match(preflight.instruction, /refined next version/)
})

test('Amazon refresh preflight omits unavailable website evidence', () => {
  const preflight = deriveGenerationPreflight({
    campaign: {
      ...CAMPAIGN,
      product_url: 'https://www.amazon.com/dp/B0EXAMPLE1',
      use_case: 'amazon_listing',
    },
    currentGeneration: CURRENT,
    selectedGeneration: CURRENT,
    instruction: '',
    pendingReferences: [],
    refreshWebsite: true,
  })

  assert.deepEqual(
    preflight.assets.map((asset) => asset.source),
    ['previous-poster'],
  )
})

test('social refresh preflight contains only previous artwork and fresh references', () => {
  const preflight = deriveGenerationPreflight({
    campaign: {
      ...CAMPAIGN,
      product_url: null,
      destination_url: null,
      use_case: 'social_cover',
    },
    currentGeneration: CURRENT,
    selectedGeneration: CURRENT,
    instruction: 'Shift toward a kinetic editorial mood.',
    pendingReferences: [{
      id: 'social-reference',
      kind: 'url',
      url: 'https://assets.example/social-reference.png',
      name: 'social-reference.png',
      previewStatus: 'ready',
    }],
    refreshWebsite: true,
  })

  assert.deepEqual(
    preflight.assets.map((asset) => asset.source),
    ['previous-poster', 'user-reference'],
  )
  assert.equal(preflight.assets.some((asset) => asset.runtime), false)
})

test('preflight follows persisted use case instead of sniffing the source URL', () => {
  const websiteIntent = deriveGenerationPreflight({
    campaign: {
      ...CAMPAIGN,
      product_url: 'https://www.amazon.com/dp/B0EXAMPLE1',
      use_case: 'website_product',
    },
    currentGeneration: CURRENT,
    selectedGeneration: CURRENT,
    instruction: '',
    pendingReferences: [],
    refreshWebsite: true,
  })
  const amazonIntent = deriveGenerationPreflight({
    campaign: {
      ...CAMPAIGN,
      product_url: 'https://example.com/product',
      use_case: 'amazon_listing',
    },
    currentGeneration: CURRENT,
    selectedGeneration: CURRENT,
    instruction: '',
    pendingReferences: [],
    refreshWebsite: true,
  })

  assert.deepEqual(
    websiteIntent.assets.filter((asset) => asset.runtime).map((asset) => asset.source),
    ['logo', 'product', 'style-board'],
  )
  assert.deepEqual(
    amazonIntent.assets.map((asset) => asset.source),
    ['previous-poster'],
  )
})

test('preflight and legacy reconstruction localize generated helper copy', () => {
  const preflight = deriveGenerationPreflight({
    campaign: CAMPAIGN,
    currentGeneration: CURRENT,
    selectedGeneration: CURRENT,
    instruction: '',
    pendingReferences: [],
    refreshWebsite: true,
    locale: 'zh-CN',
  })

  assert.equal(preflight.instruction, '在避免无谓改动的前提下，生成更完善的下一版本。')
  assert.deepEqual(
    preflight.assets.filter((asset) => asset.runtime).map((asset) => asset.label),
    ['网站标志', '网站产品图片', '网站风格板'],
  )
  assert.equal(
    reconstructLegacyImageAssets(CURRENT, null, 'zh-CN')[0].purpose,
    '品牌标志快照。',
  )
  assert.equal(
    deriveGenerationProvidedImages({
      ...CURRENT,
      reference_images: [{
        key: 'references/support.png',
        url: 'https://assets.example/support.png',
        name: 'support.png',
        mime_type: 'image/png',
        size_bytes: 120,
      }],
    } as PosterGeneration, 'zh-CN')[0].label,
    '参考图片 1',
  )
})

test('legacy reconstruction is explicitly partial and follows painter priority', () => {
  const legacy = {
    ...CURRENT,
    id: 'legacy',
    trace_schema_version: null,
    reference_images: [{
      key: 'references/support.png',
      url: 'https://assets.example/support.png',
      name: 'support.png',
      mime_type: 'image/png',
      size_bytes: 120,
    }],
  } as PosterGeneration
  const assets = reconstructLegacyImageAssets(legacy, CURRENT)

  assert.deepEqual(assets.map((asset) => asset.source), [
    'previous-poster',
    'user-reference',
    'logo',
    'product',
    'style-board',
  ])
  assert.deepEqual(assets.map((asset) => asset.model_position), [1, 2, 3, 4, 5])
})

test('provided image summaries preserve the persisted reference order', () => {
  const generation = {
    ...CURRENT,
    reference_images: [
      {
        key: 'references/first.png',
        url: 'https://assets.example/first.png',
        name: 'first.png',
        mime_type: 'image/png',
        size_bytes: 120,
      },
      {
        key: 'references/second.jpg',
        url: 'https://assets.example/second.jpg',
        name: 'second.jpg',
        mime_type: 'image/jpeg',
        size_bytes: 240,
      },
    ],
  } as PosterGeneration

  const images = deriveGenerationProvidedImages(generation)
  assert.deepEqual(images.map((image) => image.label), [
    'Supporting image 1',
    'Supporting image 2',
  ])
  assert.deepEqual(images.map((image) => image.filename), ['first.png', 'second.jpg'])
})

test('traced image summaries use only hero attachments in model order', () => {
  const heroAttachedImages = [
    traceImage('product', 'product-b.png', 5, 5),
    traceImage('previous-poster', 'previous.png', 1, 1),
    traceImage('product', 'product-a.png', 4, 4),
    traceImage('user-reference', 'support.png', 2, 2),
    traceImage('logo', 'logo.png', 3, 3),
    traceImage('style-board', 'board.png', 6, 6),
  ]

  const images = deriveGenerationUsedImages({
    generation: CURRENT,
    parent: SELECTED,
    heroAttachedImages,
  })

  assert.deepEqual(images?.map((image) => image.source), [
    'previous-poster',
    'user-reference',
    'logo',
    'product',
    'product',
    'style-board',
  ])
  assert.deepEqual(images?.map((image) => image.label), [
    'Previous poster',
    'Supporting image 1',
    'Brand logo',
    'Product image 1',
    'Product image 2',
    'Style board',
  ])
})

test('traced versions do not reconstruct a missing hero image set', () => {
  assert.equal(deriveGenerationUsedImages({
    generation: CURRENT,
    parent: SELECTED,
    heroAttachedImages: null,
  }), null)
  assert.deepEqual(deriveGenerationUsedImages({
    generation: CURRENT,
    parent: SELECTED,
    heroAttachedImages: [],
  }), [])
})

test('pre-trace versions derive a labeled image summary from saved snapshots', () => {
  const legacy = {
    ...CURRENT,
    trace_schema_version: null,
    reference_images: [{
      key: 'references/support.png',
      url: 'https://assets.example/support.png',
      name: 'support.png',
      mime_type: 'image/png',
      size_bytes: 120,
    }],
  } as PosterGeneration

  const images = deriveGenerationUsedImages({
    generation: legacy,
    parent: SELECTED,
    heroAttachedImages: null,
    locale: 'zh-CN',
  })
  assert.deepEqual(images?.map((image) => image.label), [
    '上一版海报',
    '参考图片 1',
    '品牌标志',
    '产品图片 1',
    '风格板',
  ])
})

function traceImage(
  source: TraceImageAsset['source'],
  filename: string,
  candidatePosition: number,
  modelPosition: number,
): TraceImageAsset {
  return {
    source,
    purpose: 'Fixture',
    url: `https://assets.example/${filename}`,
    key: `fixtures/${filename}`,
    filename,
    mime_type: 'image/png',
    size_bytes: 120,
    storage_source: 'fixture',
    candidate_position: candidatePosition,
    model_position: modelPosition,
  }
}
