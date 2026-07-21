import type { CapturePreview } from './capturePreview'
import type { DeviceColorScheme } from './colorScheme'
import { normalizeCaptureUrl } from './captureUrl'
import type { BrandAssets, DesignTokens } from './types'
import type { CreatableUseCaseId } from './useCases'

export const EAGER_CAPTURE_MAX_AGE_MS = 30 * 60 * 1000
export const EAGER_CAPTURE_MAX_IMAGES = 4
export const EAGER_CAPTURE_MAX_SELECTED_ASSETS = 6

export interface EagerCaptureSelection {
  imageUrls: string[]
  logoExcluded: boolean
}

export interface SelectedEagerCapture {
  preview: CapturePreview
  selection: EagerCaptureSelection
}

export type EagerCaptureAdoptionReason =
  | 'eligible'
  | 'missing_preview'
  | 'unsupported_use_case'
  | 'url_mismatch'
  | 'color_scheme_mismatch'
  | 'invalid_provenance'
  | 'captured_at_in_future'
  | 'stale'
  | 'incomplete_evidence'

export type EagerCaptureAdoptionMatch =
  | {
      matched: true
      reason: 'eligible'
      preview: CapturePreview
    }
  | {
      matched: false
      reason: Exclude<EagerCaptureAdoptionReason, 'eligible'>
    }

export interface EagerCaptureCampaignPatch {
  design_tokens: DesignTokens | null
  brand_assets: BrandAssets | null
  screenshot_url: string | null
  screenshot_key: string | null
  eager_capture_url: string | null
  eager_capture_color_scheme: DeviceColorScheme | null
  eager_captured_at: string | null
}

class EagerCaptureEvidenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EagerCaptureEvidenceError'
  }
}

export function matchEagerCaptureForAdoption({
  preview,
  productUrl,
  useCase,
  colorScheme,
  nowMs = Date.now(),
}: {
  preview: CapturePreview | null
  productUrl: string
  useCase: CreatableUseCaseId
  colorScheme: DeviceColorScheme
  nowMs?: number
}): EagerCaptureAdoptionMatch {
  if (!preview) return { matched: false, reason: 'missing_preview' }
  if (useCase !== 'website_product') {
    return { matched: false, reason: 'unsupported_use_case' }
  }

  const normalizedUrl = normalizeCaptureUrl(productUrl)
  if (
    !normalizedUrl
    || normalizeCaptureUrl(preview.sourceUrl) !== preview.sourceUrl
    || normalizedUrl !== preview.sourceUrl
  ) {
    return { matched: false, reason: 'url_mismatch' }
  }
  if (preview.colorScheme !== colorScheme) {
    return { matched: false, reason: 'color_scheme_mismatch' }
  }
  if (
    !preview.captureId
    || !isCaptureId(preview.captureId)
    || !preview.capturedAt
  ) {
    return { matched: false, reason: 'invalid_provenance' }
  }

  const capturedAtMs = Date.parse(preview.capturedAt)
  if (!Number.isFinite(capturedAtMs)) {
    return { matched: false, reason: 'invalid_provenance' }
  }
  const ageMs = nowMs - capturedAtMs
  if (ageMs < 0) {
    return { matched: false, reason: 'captured_at_in_future' }
  }
  if (ageMs > EAGER_CAPTURE_MAX_AGE_MS) {
    return { matched: false, reason: 'stale' }
  }
  if (
    !preview.designTokens
    || !isJpegDataUrl(preview.styleBoardDataUrl)
  ) {
    return { matched: false, reason: 'incomplete_evidence' }
  }

  return { matched: true, reason: 'eligible', preview }
}

export function eagerStyleBoardKey(
  campaignId: string,
  captureId: string,
): string {
  if (!campaignId || !isCaptureId(captureId)) {
    throw new EagerCaptureEvidenceError(
      'Invalid eager capture storage identity.',
    )
  }
  return `style-board/${campaignId}/eager/${captureId}.jpg`
}

export function eagerStyleBoardBlob(dataUrl: string): Blob {
  if (!isJpegDataUrl(dataUrl)) {
    throw new EagerCaptureEvidenceError(
      'Eager style board must be an inline JPEG.',
    )
  }
  try {
    const payload = dataUrl.slice(dataUrl.indexOf(',') + 1).replace(/\s+/g, '')
    const binary = atob(payload)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    if (bytes.length === 0) {
      throw new EagerCaptureEvidenceError('Eager style board is empty.')
    }
    return new Blob([bytes], { type: 'image/jpeg' })
  } catch {
    throw new EagerCaptureEvidenceError(
      'Eager style board could not be decoded.',
    )
  }
}

export function buildEagerCapturePatch(
  campaignId: string,
  preview: CapturePreview,
  uploaded: { url: string; key: string },
  selection: EagerCaptureSelection | null = null,
): EagerCaptureCampaignPatch {
  if (
    !preview.designTokens
    || !preview.capturedAt
    || !preview.captureId
    || uploaded.key !== eagerStyleBoardKey(campaignId, preview.captureId)
  ) {
    throw new EagerCaptureEvidenceError(
      'Eager capture upload does not match its provenance.',
    )
  }
  return {
    design_tokens: preview.designTokens,
    brand_assets: buildSourceBrandAssets(preview, selection),
    screenshot_url: uploaded.url,
    screenshot_key: uploaded.key,
    eager_capture_url: preview.sourceUrl,
    eager_capture_color_scheme: preview.colorScheme,
    eager_captured_at: preview.capturedAt,
  }
}

export function clearEagerCapturePatch(): EagerCaptureCampaignPatch {
  return {
    design_tokens: null,
    brand_assets: null,
    screenshot_url: null,
    screenshot_key: null,
    eager_capture_url: null,
    eager_capture_color_scheme: null,
    eager_captured_at: null,
  }
}

export function createDefaultEagerCaptureSelection(
  preview: CapturePreview,
): EagerCaptureSelection {
  return {
    imageUrls: sourceImageUrls(preview),
    logoExcluded: false,
  }
}

function buildSourceBrandAssets(
  preview: CapturePreview,
  selection: EagerCaptureSelection | null,
): BrandAssets {
  const logoUrl = safeSourceUrl(preview.logoUrl)
  const capturedImageUrls = sourceImageUrls(preview)
  if (!selection) {
    const images = capturedImageUrls.map((url) => ({ url }))
    return {
      ...(logoUrl ? { logo_url: logoUrl } : {}),
      images,
      ...(images[0] ? { primary_image_url: images[0].url } : {}),
    }
  }

  const selectedImageUrls = validateEagerCaptureSelection(
    selection,
    capturedImageUrls,
    logoUrl,
  )
  const selectedSet = new Set(selectedImageUrls)
  const excludedUrls = capturedImageUrls.filter((url) => !selectedSet.has(url))
  const orderedImageUrls = [
    ...selectedImageUrls,
    ...excludedUrls,
  ]
  return {
    ...(logoUrl ? { logo_url: logoUrl } : {}),
    images: orderedImageUrls.map((url) => ({ url })),
    ...(selectedImageUrls[0]
      ? { primary_image_url: selectedImageUrls[0] }
      : {}),
    eager_selection: {
      version: 1,
      excluded_urls: excludedUrls,
      logo_excluded: selection.logoExcluded,
    },
  }
}

function sourceImageUrls(preview: CapturePreview): string[] {
  return preview.imageUrls
    .map(safeSourceUrl)
    .filter((url): url is string => !!url)
    .filter((url, index, values) => values.indexOf(url) === index)
    .slice(0, EAGER_CAPTURE_MAX_IMAGES)
}

function validateEagerCaptureSelection(
  selection: EagerCaptureSelection,
  capturedImageUrls: string[],
  logoUrl: string | null,
): string[] {
  if (
    !selection
    || !Array.isArray(selection.imageUrls)
    || typeof selection.logoExcluded !== 'boolean'
    || selection.imageUrls.length > EAGER_CAPTURE_MAX_SELECTED_ASSETS
  ) {
    throw new EagerCaptureEvidenceError(
      'Eager capture asset selection is invalid.',
    )
  }

  const captured = new Set(capturedImageUrls)
  const selected: string[] = []
  for (const value of selection.imageUrls) {
    const url = safeSourceUrl(value)
    if (
      !url
      || url !== value
      || !captured.has(url)
      || selected.includes(url)
    ) {
      throw new EagerCaptureEvidenceError(
        'Eager capture asset selection is invalid.',
      )
    }
    selected.push(url)
  }
  const selectedAssetCount = selected.length
    + (logoUrl && !selection.logoExcluded ? 1 : 0)
  if (selectedAssetCount > EAGER_CAPTURE_MAX_SELECTED_ASSETS) {
    throw new EagerCaptureEvidenceError(
      'Eager capture asset selection is invalid.',
    )
  }
  return selected
}

function safeSourceUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username
      || url.password
    ) {
      return null
    }
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function isCaptureId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isJpegDataUrl(value: string | null): value is string {
  return typeof value === 'string'
    && /^data:image\/jpeg;base64,[a-z0-9+/=\r\n]+$/i.test(value)
}
