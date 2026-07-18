import type {
  BrandAssets,
  Campaign,
  EventDetails,
  PosterGeneration,
  PosterGenerationStatus,
  ReferenceImage,
} from './types'
import { getPosterSize } from './posterSize'

const ACTIVE_GENERATION_STATUSES = new Set<PosterGenerationStatus>([
  'created',
  'analyzing',
  'reviewing',
  'designing',
  'painting',
])

const NEXT_GENERATION_STATUSES: Record<PosterGenerationStatus, PosterGenerationStatus[]> = {
  created: ['analyzing', 'reviewing', 'designing', 'painting', 'failed'],
  analyzing: ['reviewing', 'designing', 'painting', 'failed'],
  reviewing: ['designing', 'painting', 'failed', 'canceled'],
  designing: ['painting', 'failed'],
  painting: ['ready', 'failed'],
  ready: [],
  failed: [],
  canceled: [],
}

export function canTransitionGenerationStatus(
  from: PosterGenerationStatus,
  to: PosterGenerationStatus,
): boolean {
  if (from === to) return ACTIVE_GENERATION_STATUSES.has(from)
  return NEXT_GENERATION_STATUSES[from].includes(to)
}

export function overlayGeneration(
  campaign: Campaign,
  generation: PosterGeneration | null,
): Campaign {
  if (!generation) {
    return {
      ...campaign,
      poster_format: getPosterSize(campaign.poster_format).slug,
    }
  }

  return {
    ...campaign,
    scenario: generation.scenario,
    event_details: generation.event_details,
    style_profile: generation.style_profile,
    poster_copy: generation.poster_copy,
    poster_content: generation.poster_content,
    brand_assets: generation.brand_assets,
    brand_essence: generation.brand_essence,
    poster_spec: generation.poster_spec,
    design_tokens: generation.design_tokens,
    screenshot_url: generation.screenshot_url,
    screenshot_key: generation.screenshot_key,
    poster_layout: generation.poster_layout,
    design_status: generation.design_status,
    hero_image_url: generation.hero_image_url,
    hero_image_key: generation.hero_image_key,
    poster_format: getPosterSize(generation.poster_format).slug,
    reference_context: generation.instruction,
    reference_images: generation.reference_images,
  }
}

type GenerationAssetSnapshot = Pick<
  PosterGeneration,
  'hero_image_key' | 'screenshot_key' | 'brand_assets' | 'event_details' | 'reference_images'
>

export function collectCampaignAssetKeys(
  campaign: Campaign,
  generations: readonly GenerationAssetSnapshot[],
): string[] {
  const keys = new Set<string>()

  addKey(keys, campaign.hero_image_key)
  addKey(keys, campaign.screenshot_key)
  addBrandAssetKeys(keys, campaign.brand_assets)
  addEventAssetKeys(keys, campaign.event_details)
  addReferenceKeys(keys, campaign.reference_images)

  for (const generation of generations) {
    addKey(keys, generation.hero_image_key)
    addKey(keys, generation.screenshot_key)
    addBrandAssetKeys(keys, generation.brand_assets)
    addEventAssetKeys(keys, generation.event_details)
    addReferenceKeys(keys, generation.reference_images)
  }

  return [...keys]
}

function addKey(keys: Set<string>, value: string | null | undefined) {
  if (value) keys.add(value)
}

function addBrandAssetKeys(keys: Set<string>, assets: BrandAssets | null) {
  addKey(keys, assets?.logo_key)
  for (const image of assets?.images ?? []) addKey(keys, image.key)
}

function addEventAssetKeys(keys: Set<string>, details: EventDetails | null) {
  addKey(keys, details?.cover_image_key)
}

function addReferenceKeys(keys: Set<string>, images: readonly ReferenceImage[]) {
  for (const image of images) addKey(keys, image.key)
}
