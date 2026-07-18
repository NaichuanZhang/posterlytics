import type { PendingReference } from './references'
import type { TranslationKey } from '../i18n/messages'
import type {
  Campaign,
  GenerationStageTrace,
  GenerationTraceStage,
  PosterGeneration,
  TraceImageAsset,
  TraceImageSource,
} from './types'
import {
  DEFAULT_LOCALE,
  translate,
  type SupportedLocale,
} from './i18n'

export const TRACE_STAGE_ORDER: GenerationTraceStage[] = ['hero', 'designer', 'assets', 'analyze']

export const TRACE_STAGE_LABEL_KEYS: Record<GenerationTraceStage, TranslationKey> = {
  hero: 'Image model',
  designer: 'Designer',
  assets: 'Assets',
  analyze: 'Analyze',
}

export const TRACE_SOURCE_LABEL_KEYS: Record<TraceImageSource, TranslationKey> = {
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
  const expectedTraceCount = generation.trace_schema_version >= 2 ? 4 : 3
  if (generation.trace_incomplete || traces.length !== expectedTraceCount) return 'incomplete'
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
  locale?: SupportedLocale
}): GenerationPreflight {
  const {
    campaign,
    currentGeneration,
    selectedGeneration,
    instruction,
    pendingReferences,
    refreshWebsite,
    locale = DEFAULT_LOCALE,
  } = args
  const snapshot = currentGeneration ?? campaign
  const assets: Array<Omit<GenerationPreflightAsset, 'expected_position'>> = []

  if (currentGeneration?.hero_image_url) {
    assets.push({
      id: 'previous-poster',
      source: 'previous-poster',
      label: translate(locale, 'Current poster version'),
      purpose: translate(locale, 'Primary edit source; unspecified choices remain unchanged.'),
      filename: translate(locale, 'Version {number}', {
        number: currentGeneration.version_number ?? '-',
      }),
      url: currentGeneration.hero_image_url,
      runtime: false,
    })
  }

  for (const [index, reference] of pendingReferences.entries()) {
    assets.push({
      id: reference.id,
      source: 'user-reference',
      label: translate(locale, 'Supporting image {number}', { number: index + 1 }),
      purpose: translate(locale, 'Used only for the requested change.'),
      filename: reference.kind === 'file' ? reference.file.name : reference.name,
      url: reference.kind === 'url' ? reference.url : null,
      runtime: false,
    })
  }

  if (refreshWebsite) {
    assets.push(
      runtimeAsset('logo', translate(locale, 'Website logo'), locale),
      runtimeAsset('product', translate(locale, 'Website product imagery'), locale),
      runtimeAsset('style-board', translate(locale, 'Website style board'), locale),
    )
  } else {
    if (snapshot.brand_assets?.logo_url) {
      assets.push({
        id: 'logo',
        source: 'logo',
        label: translate(locale, 'Brand logo'),
        purpose: translate(locale, 'Authentic brand mark, subject to fetch and model limits.'),
        filename: filenameFromUrl(snapshot.brand_assets.logo_url, locale),
        url: snapshot.brand_assets.logo_url,
        runtime: false,
      })
    }
    for (const [index, image] of (snapshot.brand_assets?.images ?? []).entries()) {
      assets.push({
        id: `product-${index}`,
        source: 'product',
        label: translate(locale, 'Product image {number}', { number: index + 1 }),
        purpose: translate(locale, 'Authentic product or brand imagery.'),
        filename: filenameFromUrl(image.url, locale),
        url: image.url,
        runtime: false,
      })
    }
    if (snapshot.screenshot_url) {
      assets.push({
        id: 'style-board',
        source: 'style-board',
        label: translate(locale, 'Website style board'),
        purpose: translate(locale, 'Source evidence for the visual system.'),
        filename: filenameFromUrl(snapshot.screenshot_url, locale),
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
    instruction: instruction.trim()
      || translate(locale, 'Create a refined next version without gratuitous changes.'),
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
  locale: SupportedLocale = DEFAULT_LOCALE,
): TraceImageAsset[] {
  const candidates: Array<Omit<TraceImageAsset, 'candidate_position' | 'model_position'>> = []
  if (parent?.hero_image_url) {
    candidates.push({
      source: 'previous-poster',
      purpose: translate(locale, 'Likely parent poster snapshot.'),
      url: parent.hero_image_url,
      key: parent.hero_image_key,
      filename: translate(locale, 'Version {number}', {
        number: parent.version_number ?? '-',
      }),
      mime_type: null,
      size_bytes: null,
      storage_source: 'poster-version',
    })
  }
  for (const image of generation.reference_images) {
    candidates.push({
      source: 'user-reference',
      purpose: translate(locale, 'User-supplied supporting image snapshot.'),
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
      purpose: translate(locale, 'Brand logo snapshot.'),
      url: generation.brand_assets.logo_url,
      key: generation.brand_assets.logo_key ?? null,
      filename: filenameFromUrl(generation.brand_assets.logo_url, locale),
      mime_type: null,
      size_bytes: null,
      storage_source: 'website-asset',
    })
  }
  for (const image of generation.brand_assets?.images ?? []) {
    candidates.push({
      source: 'product',
      purpose: translate(locale, 'Product image snapshot.'),
      url: image.url,
      key: image.key,
      filename: filenameFromUrl(image.url, locale),
      mime_type: null,
      size_bytes: null,
      storage_source: 'website-asset',
    })
  }
  if (generation.screenshot_url) {
    candidates.push({
      source: 'style-board',
      purpose: translate(locale, 'Website style board snapshot.'),
      url: generation.screenshot_url,
      key: generation.screenshot_key,
      filename: filenameFromUrl(generation.screenshot_url, locale),
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
  locale: SupportedLocale,
): Omit<GenerationPreflightAsset, 'expected_position'> {
  return {
    id: `runtime-${source}`,
    source,
    label,
    purpose: translate(locale, 'Discovered, validated, and stored while the website is analyzed.'),
    filename: null,
    url: null,
    runtime: true,
  }
}

function filenameFromUrl(
  value: string,
  locale: SupportedLocale = DEFAULT_LOCALE,
): string {
  try {
    return decodeURIComponent(new URL(value).pathname.split('/').filter(Boolean).pop() ?? '')
      || translate(locale, 'Stored image')
  } catch {
    return translate(locale, 'Stored image')
  }
}
