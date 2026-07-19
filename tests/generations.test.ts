import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canTransitionGenerationStatus,
  collectCampaignAssetKeys,
  overlayGeneration,
} from '../src/lib/generations.ts'
import { errorDetails } from '../functions/_shared.ts'
import type { Campaign, PosterGeneration } from '../src/lib/types.ts'

const CAMPAIGN = {
  id: 'campaign-1',
  product_name: 'Posterlytics',
  status: 'published',
  current_generation_id: 'generation-2',
  use_case: 'website_product',
  poster_format: 'luma_1x1',
  hero_image_url: 'https://example.com/current.png',
  hero_image_key: 'poster/current.png',
  screenshot_key: 'boards/current.jpg',
  brand_assets: {
    logo_key: 'brand/logo.png',
    images: [{ key: 'brand/product.png', url: 'https://example.com/product.png' }],
  },
  event_details: null,
  reference_images: [],
  poster_layout: null,
} as unknown as Campaign

const GENERATION = {
  id: 'generation-1',
  campaign_id: CAMPAIGN.id,
  version_number: 1,
  scenario: 'product',
  use_case: 'amazon_listing',
  event_details: null,
  style_profile: null,
  poster_copy: null,
  poster_content: null,
  brand_assets: null,
  brand_essence: 'Version one',
  poster_spec: null,
  design_tokens: null,
  screenshot_url: null,
  screenshot_key: 'boards/v1.jpg',
  poster_layout: null,
  design_status: 'ready',
  hero_image_url: 'https://example.com/v1.png',
  hero_image_key: 'poster/v1.png',
  instruction: 'Make the title larger',
  poster_format: 'a4_2x3',
  reference_images: [],
} as unknown as PosterGeneration

test('overlayGeneration previews a snapshot without changing campaign state', () => {
  const preview = overlayGeneration(CAMPAIGN, GENERATION)

  assert.equal(preview.hero_image_key, 'poster/v1.png')
  assert.equal(preview.brand_essence, 'Version one')
  assert.equal(preview.reference_context, 'Make the title larger')
  assert.equal(preview.use_case, 'amazon_listing')
  assert.equal(preview.poster_format, 'a4_2x3')
  assert.equal(preview.status, 'published')
  assert.equal(preview.current_generation_id, 'generation-2')
  assert.equal(CAMPAIGN.poster_format, 'luma_1x1')
  assert.equal(CAMPAIGN.use_case, 'website_product')
  assert.equal(CAMPAIGN.hero_image_key, 'poster/current.png')
})

test('overlayGeneration defaults a legacy campaign without a poster format to A4', () => {
  const legacyCampaign = {
    ...CAMPAIGN,
    poster_format: undefined,
  } as unknown as Campaign

  const preview = overlayGeneration(legacyCampaign, null)

  assert.equal(preview.poster_format, 'a4_2x3')
})

test('overlayGeneration defaults a legacy generation without inheriting the campaign target', () => {
  const legacyGeneration = {
    ...GENERATION,
    poster_format: undefined,
  } as unknown as PosterGeneration

  const preview = overlayGeneration(CAMPAIGN, legacyGeneration)

  assert.equal(preview.poster_format, 'a4_2x3')
  assert.equal(CAMPAIGN.poster_format, 'luma_1x1')
})

test('generation stage transitions allow only active forward progress or failure', () => {
  assert.equal(canTransitionGenerationStatus('created', 'designing'), true)
  assert.equal(canTransitionGenerationStatus('analyzing', 'reviewing'), true)
  assert.equal(canTransitionGenerationStatus('reviewing', 'canceled'), true)
  assert.equal(canTransitionGenerationStatus('analyzing', 'painting'), true)
  assert.equal(canTransitionGenerationStatus('designing', 'failed'), true)
  assert.equal(canTransitionGenerationStatus('painting', 'ready'), true)
  assert.equal(canTransitionGenerationStatus('painting', 'analyzing'), false)
  assert.equal(canTransitionGenerationStatus('ready', 'ready'), false)
  assert.equal(canTransitionGenerationStatus('failed', 'created'), false)
})

test('collectCampaignAssetKeys includes every version and removes duplicates', () => {
  const keys = collectCampaignAssetKeys(CAMPAIGN, [
    {
      hero_image_key: 'poster/v1.png',
      screenshot_key: 'boards/v1.jpg',
      brand_assets: {
        logo_key: 'brand/logo.png',
        images: [{ key: 'brand/v1-product.png', url: 'https://example.com/v1-product.png' }],
      },
      event_details: { cover_image_key: 'event/cover.png' },
      reference_images: [{
        key: 'references/one.png',
        url: 'https://example.com/one.png',
        name: 'one.png',
        mime_type: 'image/png',
        size_bytes: 100,
      }],
    },
  ])

  assert.deepEqual(new Set(keys), new Set([
    'poster/current.png',
    'boards/current.jpg',
    'brand/logo.png',
    'brand/product.png',
    'poster/v1.png',
    'boards/v1.jpg',
    'brand/v1-product.png',
    'event/cover.png',
    'references/one.png',
  ]))
  assert.equal(keys.filter((key) => key === 'brand/logo.png').length, 1)
})

test('generation failure diagnostics preserve SDK error details', () => {
  assert.deepEqual(errorDetails({
    code: 'PGRST301',
    message: 'Row update was rejected',
    status: 403,
  }), {
    code: 'PGRST301',
    message: 'Row update was rejected',
    retryable: false,
    upstream_status: 403,
  })
})
