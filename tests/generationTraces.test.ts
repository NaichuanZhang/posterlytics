import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deriveGenerationPreflight,
  generationTraceAvailability,
  reconstructLegacyImageAssets,
} from '../src/lib/generationTraces.ts'
import type {
  Campaign,
  GenerationStageTrace,
  PosterGeneration,
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

test('trace availability distinguishes legacy, complete, and incomplete captures', () => {
  const terminalTraces = (['hero', 'designer', 'analyze'] as const).map((stage) => ({
    stage,
    status: stage === 'analyze' ? 'skipped' : 'succeeded',
  })) as GenerationStageTrace[]

  assert.equal(generationTraceAvailability(
    { ...CURRENT, trace_schema_version: null } as PosterGeneration,
    [],
  ), 'legacy')
  assert.equal(generationTraceAvailability(CURRENT, terminalTraces), 'exact')
  assert.equal(generationTraceAvailability(
    { ...CURRENT, trace_incomplete: true } as PosterGeneration,
    terminalTraces,
  ), 'incomplete')
  assert.equal(generationTraceAvailability(CURRENT, terminalTraces.slice(0, 2)), 'incomplete')
})
