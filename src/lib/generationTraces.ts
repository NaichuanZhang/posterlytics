import type { PendingReference } from './references'
import type {
  Campaign,
  GenerationStageTrace,
  GenerationTraceStage,
  PosterGeneration,
  TraceImageAsset,
  TraceImageSource,
} from './types'

export const TRACE_STAGE_ORDER: GenerationTraceStage[] = ['hero', 'designer', 'analyze']

export const TRACE_STAGE_LABELS: Record<GenerationTraceStage, string> = {
  hero: 'Image model',
  designer: 'Designer',
  analyze: 'Analyze',
}

export const TRACE_SOURCE_LABELS: Record<TraceImageSource, string> = {
  'previous-poster': 'Previous poster',
  'user-reference': 'Supporting',
  logo: 'Logo',
  product: 'Product',
  'style-board': 'Style board',
}

const PAINTER_PRIORITY: Record<TraceImageSource, number> = {
  'previous-poster': 0,
  'user-reference': 1,
  logo: 2,
  product: 3,
  'style-board': 4,
}

export type GenerationTraceAvailability = 'exact' | 'incomplete' | 'legacy'

export function generationTraceAvailability(
  generation: PosterGeneration,
  traces: readonly GenerationStageTrace[],
): GenerationTraceAvailability {
  if (generation.trace_schema_version === null) return 'legacy'
  if (generation.trace_incomplete || traces.length !== 3) return 'incomplete'
  if (
    (generation.status === 'ready' || generation.status === 'failed')
    && traces.some((trace) => trace.status === 'pending' || trace.status === 'running')
  ) {
    return 'incomplete'
  }
  return 'exact'
}

export interface GenerationPreflightAsset {
  id: string
  source: TraceImageSource
  label: string
  purpose: string
  filename: string | null
  url: string | null
  expected_position: number
  runtime: boolean
}

export interface GenerationPreflight {
  instruction: string
  parent: PosterGeneration | null
  selectedDiffersFromParent: boolean
  assets: GenerationPreflightAsset[]
}

export function deriveGenerationPreflight(args: {
  campaign: Campaign
  currentGeneration: PosterGeneration | null
  selectedGeneration: PosterGeneration | null
  instruction: string
  pendingReferences: readonly PendingReference[]
  refreshWebsite: boolean
}): GenerationPreflight {
  const {
    campaign,
    currentGeneration,
    selectedGeneration,
    instruction,
    pendingReferences,
    refreshWebsite,
  } = args
  const snapshot = currentGeneration ?? campaign
  const assets: Array<Omit<GenerationPreflightAsset, 'expected_position'>> = []

  if (currentGeneration?.hero_image_url) {
    assets.push({
      id: 'previous-poster',
      source: 'previous-poster',
      label: 'Current poster version',
      purpose: 'Primary edit source; unspecified choices remain unchanged.',
      filename: `Version ${currentGeneration.version_number ?? '-'}`,
      url: currentGeneration.hero_image_url,
      runtime: false,
    })
  }

  for (const [index, reference] of pendingReferences.entries()) {
    assets.push({
      id: reference.id,
      source: 'user-reference',
      label: `Supporting image ${index + 1}`,
      purpose: 'Used only for the requested change.',
      filename: reference.kind === 'file' ? reference.file.name : reference.name,
      url: reference.kind === 'url' ? reference.url : null,
      runtime: false,
    })
  }

  if (refreshWebsite) {
    assets.push(
      runtimeAsset('logo', 'Website logo'),
      runtimeAsset('product', 'Website product imagery'),
      runtimeAsset('style-board', 'Website style board'),
    )
  } else {
    if (snapshot.brand_assets?.logo_url) {
      assets.push({
        id: 'logo',
        source: 'logo',
        label: 'Brand logo',
        purpose: 'Authentic brand mark, subject to fetch and model limits.',
        filename: filenameFromUrl(snapshot.brand_assets.logo_url),
        url: snapshot.brand_assets.logo_url,
        runtime: false,
      })
    }
    for (const [index, image] of (snapshot.brand_assets?.images ?? []).entries()) {
      assets.push({
        id: `product-${index}`,
        source: 'product',
        label: `Product image ${index + 1}`,
        purpose: 'Authentic product or brand imagery.',
        filename: filenameFromUrl(image.url),
        url: image.url,
        runtime: false,
      })
    }
    if (snapshot.screenshot_url) {
      assets.push({
        id: 'style-board',
        source: 'style-board',
        label: 'Website style board',
        purpose: 'Source evidence for the visual system.',
        filename: filenameFromUrl(snapshot.screenshot_url),
        url: snapshot.screenshot_url,
        runtime: false,
      })
    }
  }

  const ordered = assets
    .map((asset, index) => ({ asset, index }))
    .sort((a, b) =>
      PAINTER_PRIORITY[a.asset.source] - PAINTER_PRIORITY[b.asset.source]
      || a.index - b.index
    )
    .map(({ asset }, index) => ({ ...asset, expected_position: index + 1 }))

  return {
    instruction: instruction.trim() || 'Create a refined next version without gratuitous changes.',
    parent: currentGeneration,
    selectedDiffersFromParent: !!(
      selectedGeneration
      && currentGeneration
      && selectedGeneration.id !== currentGeneration.id
    ),
    assets: ordered,
  }
}

export function reconstructLegacyImageAssets(
  generation: PosterGeneration,
  parent: PosterGeneration | null,
): TraceImageAsset[] {
  const candidates: Array<Omit<TraceImageAsset, 'candidate_position' | 'model_position'>> = []
  if (parent?.hero_image_url) {
    candidates.push({
      source: 'previous-poster',
      purpose: 'Likely parent poster snapshot.',
      url: parent.hero_image_url,
      key: parent.hero_image_key,
      filename: `Version ${parent.version_number ?? '-'}`,
      mime_type: null,
      size_bytes: null,
      storage_source: 'poster-version',
    })
  }
  for (const image of generation.reference_images) {
    candidates.push({
      source: 'user-reference',
      purpose: 'User-supplied supporting image snapshot.',
      url: image.url,
      key: image.key,
      filename: image.name,
      mime_type: image.mime_type,
      size_bytes: image.size_bytes,
      storage_source: 'user-upload',
    })
  }
  if (generation.brand_assets?.logo_url) {
    candidates.push({
      source: 'logo',
      purpose: 'Brand logo snapshot.',
      url: generation.brand_assets.logo_url,
      key: generation.brand_assets.logo_key ?? null,
      filename: filenameFromUrl(generation.brand_assets.logo_url),
      mime_type: null,
      size_bytes: null,
      storage_source: 'website-asset',
    })
  }
  for (const image of generation.brand_assets?.images ?? []) {
    candidates.push({
      source: 'product',
      purpose: 'Product image snapshot.',
      url: image.url,
      key: image.key,
      filename: filenameFromUrl(image.url),
      mime_type: null,
      size_bytes: null,
      storage_source: 'website-asset',
    })
  }
  if (generation.screenshot_url) {
    candidates.push({
      source: 'style-board',
      purpose: 'Website style board snapshot.',
      url: generation.screenshot_url,
      key: generation.screenshot_key,
      filename: filenameFromUrl(generation.screenshot_url),
      mime_type: null,
      size_bytes: null,
      storage_source: 'website-capture',
    })
  }

  const seen = new Set<string>()
  return candidates
    .map((asset, index) => ({ asset, index }))
    .sort((a, b) =>
      PAINTER_PRIORITY[a.asset.source] - PAINTER_PRIORITY[b.asset.source]
      || a.index - b.index
    )
    .filter(({ asset }) => {
      if (!asset.url || seen.has(asset.url)) return false
      seen.add(asset.url)
      return true
    })
    .slice(0, 6)
    .map(({ asset, index }, modelIndex) => ({
      ...asset,
      candidate_position: index + 1,
      model_position: modelIndex + 1,
    }))
}

function runtimeAsset(
  source: Extract<TraceImageSource, 'logo' | 'product' | 'style-board'>,
  label: string,
): Omit<GenerationPreflightAsset, 'expected_position'> {
  return {
    id: `runtime-${source}`,
    source,
    label,
    purpose: 'Discovered, validated, and stored while the website is analyzed.',
    filename: null,
    url: null,
    runtime: true,
  }
}

function filenameFromUrl(value: string): string {
  try {
    return decodeURIComponent(new URL(value).pathname.split('/').filter(Boolean).pop() ?? '')
      || 'Stored image'
  } catch {
    return 'Stored image'
  }
}
