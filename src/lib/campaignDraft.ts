import {
  matchEagerCaptureForAdoption,
  type SelectedEagerCapture,
} from './eagerCapture'
import { normalizeCaptureUrl } from './captureUrl'
import { posterFormatHasQr } from './qrPolicy'
import type { DeviceColorScheme } from './colorScheme'
import {
  createLocalDraftEnvelope,
  getBrowserLocalDraftStorage,
  isRecord,
  parseLocalDraftEnvelope,
  parseLocalDraftReferences,
  readLocalDraftValue,
  serializeLocalDraftReferences,
  type LocalDraftEnvelopeV1,
  type LocalDraftFileReference,
  type LocalDraftReference,
  type LocalDraftStorage,
} from './localDraft'
import {
  DEFAULT_POSTER_SIZE_SLUG,
  isPosterSizeSlug,
  type PosterSizeSlug,
} from './posterSize'
import type { PendingReference } from './references'
import {
  getUseCase,
  isCreatableUseCaseId,
  type CreatableUseCaseId,
} from './useCases'

const CAMPAIGN_DRAFT_VERSION_PREFIX = 'posterlytics.campaignDraft.v1:'

export interface CampaignEagerCaptureMetadataV1 {
  sourceUrl: string
  captureId: string
  capturedAt: string
  colorScheme: DeviceColorScheme
  selection: {
    imageUrls: string[]
    logoExcluded: boolean
  }
}

export interface CampaignDraftDataV1 {
  selectedUseCaseId: CreatableUseCaseId | null
  productUrl: string
  productName: string
  tagline: string
  ctaText: string
  destinationUrl: string
  posterFormat: PosterSizeSlug
  platformHint: string
  referenceContext: string
  references: LocalDraftReference[]
  serverCampaignId: string | null
  eagerCapture: CampaignEagerCaptureMetadataV1 | null
}

export type CampaignDraftV1 = LocalDraftEnvelopeV1<CampaignDraftDataV1>

export interface CampaignDraftInputV1 {
  selectedUseCaseId: CreatableUseCaseId | null
  productUrl: string
  productName: string
  tagline: string
  ctaText: string
  destinationUrl: string
  posterFormat: PosterSizeSlug
  platformHint: string
  referenceContext: string
  pendingReferences: readonly PendingReference[]
  unrestorableFiles?: readonly LocalDraftFileReference[]
  serverCampaignId: string | null
  eagerCapture: SelectedEagerCapture | null
}

export function campaignDraftKey(userId: string): string {
  return `${CAMPAIGN_DRAFT_VERSION_PREFIX}${encodeURIComponent(userId)}`
}

export function buildCampaignDraftData(
  input: CampaignDraftInputV1,
): CampaignDraftDataV1 {
  return {
    selectedUseCaseId: input.selectedUseCaseId,
    productUrl: input.productUrl,
    productName: input.productName,
    tagline: input.tagline,
    ctaText: input.ctaText,
    destinationUrl: input.destinationUrl,
    posterFormat: input.posterFormat,
    platformHint: input.platformHint,
    referenceContext: input.referenceContext,
    references: serializeLocalDraftReferences(
      input.pendingReferences,
      input.unrestorableFiles,
    ),
    serverCampaignId: input.serverCampaignId,
    eagerCapture: eagerCaptureMetadata(input.eagerCapture),
  }
}

export function serializeCampaignDraft(
  ownerId: string,
  data: CampaignDraftDataV1,
  nowMs = Date.now(),
): string {
  return JSON.stringify(createLocalDraftEnvelope(ownerId, data, nowMs))
}

export function parseCampaignDraft(
  raw: string | null,
  ownerId: string,
  nowMs = Date.now(),
): CampaignDraftV1 | null {
  return parseLocalDraftEnvelope(raw, ownerId, parseCampaignDraftData, nowMs)
}

export function loadCampaignDraft(
  ownerId: string,
  storage: LocalDraftStorage | null = getBrowserLocalDraftStorage(),
  nowMs = Date.now(),
): CampaignDraftV1 | null {
  return parseCampaignDraft(
    readLocalDraftValue(campaignDraftKey(ownerId), storage),
    ownerId,
    nowMs,
  )
}

export function isCampaignDraftDirty(data: CampaignDraftDataV1): boolean {
  return (
    data.selectedUseCaseId !== null
    || data.productUrl !== ''
    || data.productName !== ''
    || data.tagline !== ''
    || data.ctaText !== 'Get started'
    || data.destinationUrl !== ''
    || data.posterFormat !== DEFAULT_POSTER_SIZE_SLUG
    || data.platformHint !== ''
    || data.referenceContext !== ''
    || data.references.length > 0
    || data.serverCampaignId !== null
    || data.eagerCapture !== null
  )
}

export function restoreCampaignEagerCapture({
  metadata,
  availableCapture,
  productUrl,
  useCase,
  colorScheme,
  nowMs = Date.now(),
}: {
  metadata: CampaignEagerCaptureMetadataV1 | null
  availableCapture: SelectedEagerCapture | null
  productUrl: string
  useCase: CreatableUseCaseId | null
  colorScheme: DeviceColorScheme
  nowMs?: number
}): SelectedEagerCapture | null {
  if (!metadata || !useCase) return null
  const match = matchEagerCaptureForAdoption({
    preview: availableCapture?.preview ?? null,
    productUrl,
    useCase,
    colorScheme,
    nowMs,
  })
  if (
    !match.matched
    || match.preview.sourceUrl !== metadata.sourceUrl
    || match.preview.captureId !== metadata.captureId
    || match.preview.capturedAt !== metadata.capturedAt
    || match.preview.colorScheme !== metadata.colorScheme
    || metadata.selection.imageUrls.some(
      (url) => !match.preview.imageUrls.includes(url),
    )
  ) {
    return null
  }

  return {
    preview: match.preview,
    selection: {
      imageUrls: [...metadata.selection.imageUrls],
      logoExcluded: metadata.selection.logoExcluded,
    },
  }
}

function parseCampaignDraftData(value: unknown): CampaignDraftDataV1 | null {
  if (!isRecord(value)) return null
  const stringFields = [
    'productUrl',
    'productName',
    'tagline',
    'ctaText',
    'destinationUrl',
    'platformHint',
    'referenceContext',
  ] as const
  if (
    stringFields.some((field) => typeof value[field] !== 'string')
    || !Object.prototype.hasOwnProperty.call(value, 'selectedUseCaseId')
    || !Object.prototype.hasOwnProperty.call(value, 'posterFormat')
    || !Array.isArray(value.references)
  ) {
    return null
  }

  const selectedUseCaseId = isCreatableUseCaseId(value.selectedUseCaseId)
    ? value.selectedUseCaseId
    : null
  let posterFormat = isPosterSizeSlug(value.posterFormat)
    ? value.posterFormat
    : DEFAULT_POSTER_SIZE_SLUG
  if (selectedUseCaseId) {
    const useCase = getUseCase(selectedUseCaseId)
    if (!useCase.allowedPosterFormats.includes(posterFormat)) {
      posterFormat = useCase.defaultPosterFormat
    }
  }
  const destinationUrl = (
    selectedUseCaseId === 'social_cover'
    && !posterFormatHasQr(posterFormat)
  )
    ? ''
    : value.destinationUrl as string

  const serverCampaignId = typeof value.serverCampaignId === 'string'
    && value.serverCampaignId.trim()
    && value.serverCampaignId.length <= 255
      ? value.serverCampaignId
      : null

  return {
    selectedUseCaseId,
    productUrl: value.productUrl as string,
    productName: value.productName as string,
    tagline: value.tagline as string,
    ctaText: value.ctaText as string,
    destinationUrl,
    posterFormat,
    platformHint: value.platformHint as string,
    referenceContext: value.referenceContext as string,
    references: parseLocalDraftReferences(value.references),
    serverCampaignId,
    eagerCapture: parseEagerCaptureMetadata(value.eagerCapture),
  }
}

function eagerCaptureMetadata(
  capture: SelectedEagerCapture | null,
): CampaignEagerCaptureMetadataV1 | null {
  if (
    !capture?.preview.captureId
    || !capture.preview.capturedAt
    || !normalizeCaptureUrl(capture.preview.sourceUrl)
  ) {
    return null
  }

  return {
    sourceUrl: capture.preview.sourceUrl,
    captureId: capture.preview.captureId,
    capturedAt: capture.preview.capturedAt,
    colorScheme: capture.preview.colorScheme,
    selection: {
      imageUrls: [...capture.selection.imageUrls],
      logoExcluded: capture.selection.logoExcluded,
    },
  }
}

function parseEagerCaptureMetadata(
  value: unknown,
): CampaignEagerCaptureMetadataV1 | null {
  if (!isRecord(value) || !isRecord(value.selection)) return null
  if (
    typeof value.sourceUrl !== 'string'
    || normalizeCaptureUrl(value.sourceUrl) !== value.sourceUrl
    || typeof value.captureId !== 'string'
    || !isCaptureId(value.captureId)
    || typeof value.capturedAt !== 'string'
    || !Number.isFinite(Date.parse(value.capturedAt))
    || (value.colorScheme !== 'light' && value.colorScheme !== 'dark')
    || !Array.isArray(value.selection.imageUrls)
    || value.selection.imageUrls.length > 6
    || typeof value.selection.logoExcluded !== 'boolean'
  ) {
    return null
  }

  const imageUrls: string[] = []
  for (const candidate of value.selection.imageUrls) {
    const url = safeHttpUrl(candidate)
    if (!url || imageUrls.includes(url)) return null
    imageUrls.push(url)
  }

  return {
    sourceUrl: value.sourceUrl,
    captureId: value.captureId,
    capturedAt: new Date(Date.parse(value.capturedAt)).toISOString(),
    colorScheme: value.colorScheme,
    selection: {
      imageUrls,
      logoExcluded: value.selection.logoExcluded,
    },
  }
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
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
