import {
  matchEagerCaptureForAdoption,
  type SelectedEagerCapture,
} from './eagerCapture'
import { normalizeCaptureUrl } from './captureUrl'
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
  creationSourceSignals,
  normalizeSourceUrls,
} from './sourceUrls'
import {
  resolveCreationUseCase,
  type CreationOutputKind,
} from './useCases'

// v2 drops selectedUseCaseId, ctaText and platformHint — the unified creation
// screen has no picker, no CTA input, and no platform-hint input — and adds
// sourceUrls (1-3) and outputKind. A v1 envelope is not migrated: the version
// suffix changes, so the old key is simply never read, and parse returns null.
const CAMPAIGN_DRAFT_VERSION_PREFIX = 'posterlytics.campaignDraft.v2:'

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

export interface CampaignDraftData {
  sourceUrls: string[]
  productName: string
  tagline: string
  destinationUrl: string
  posterFormat: PosterSizeSlug
  outputKind: CreationOutputKind
  referenceContext: string
  references: LocalDraftReference[]
  serverCampaignId: string | null
  eagerCapture: CampaignEagerCaptureMetadataV1 | null
}

export type CampaignDraft = LocalDraftEnvelopeV1<CampaignDraftData>

export interface CampaignDraftInput {
  sourceUrls: readonly string[]
  productName: string
  tagline: string
  destinationUrl: string
  posterFormat: PosterSizeSlug
  outputKind: CreationOutputKind
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
  input: CampaignDraftInput,
): CampaignDraftData {
  return {
    sourceUrls: normalizeSourceUrls(input.sourceUrls),
    productName: input.productName,
    tagline: input.tagline,
    destinationUrl: input.destinationUrl,
    posterFormat: input.posterFormat,
    outputKind: input.outputKind,
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
  data: CampaignDraftData,
  nowMs = Date.now(),
): string {
  return JSON.stringify(createLocalDraftEnvelope(ownerId, data, nowMs))
}

export function parseCampaignDraft(
  raw: string | null,
  ownerId: string,
  nowMs = Date.now(),
): CampaignDraft | null {
  return parseLocalDraftEnvelope(raw, ownerId, parseCampaignDraftData, nowMs)
}

export function loadCampaignDraft(
  ownerId: string,
  storage: LocalDraftStorage | null = getBrowserLocalDraftStorage(),
  nowMs = Date.now(),
): CampaignDraft | null {
  return parseCampaignDraft(
    readLocalDraftValue(campaignDraftKey(ownerId), storage),
    ownerId,
    nowMs,
  )
}

export function isCampaignDraftDirty(data: CampaignDraftData): boolean {
  return (
    data.sourceUrls.length > 0
    || data.productName !== ''
    || data.tagline !== ''
    || data.destinationUrl !== ''
    || data.posterFormat !== DEFAULT_POSTER_SIZE_SLUG
    || data.outputKind !== 'poster'
    || data.referenceContext !== ''
    || data.references.length > 0
    || data.serverCampaignId !== null
    || data.eagerCapture !== null
  )
}

export function restoreCampaignEagerCapture({
  metadata,
  availableCapture,
  sourceUrls,
  outputKind,
  colorScheme,
  nowMs = Date.now(),
}: {
  metadata: CampaignEagerCaptureMetadataV1 | null
  availableCapture: SelectedEagerCapture | null
  sourceUrls: readonly string[]
  outputKind: CreationOutputKind
  colorScheme: DeviceColorScheme
  nowMs?: number
}): SelectedEagerCapture | null {
  if (!metadata) return null
  // Eager capture only ever adopts for website_product, so recompute the use case
  // the draft implies rather than assuming one — a restored Amazon/reference draft
  // must drop its capture rather than smuggle it into the wrong pipeline.
  const useCase = resolveCreationUseCase({
    ...creationSourceSignals(sourceUrls),
    outputKind,
  })
  const productUrl = normalizeSourceUrls(sourceUrls)[0] ?? ''
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

function parseCampaignDraftData(value: unknown): CampaignDraftData | null {
  if (!isRecord(value)) return null
  const stringFields = [
    'productName',
    'tagline',
    'destinationUrl',
    'referenceContext',
  ] as const
  if (
    stringFields.some((field) => typeof value[field] !== 'string')
    || !Array.isArray(value.sourceUrls)
    || !Object.prototype.hasOwnProperty.call(value, 'posterFormat')
    || !Array.isArray(value.references)
  ) {
    return null
  }

  const posterFormat = isPosterSizeSlug(value.posterFormat)
    ? value.posterFormat
    : DEFAULT_POSTER_SIZE_SLUG
  const outputKind: CreationOutputKind = value.outputKind === 'post'
    ? 'post'
    : 'poster'
  // A multi-page post is locked to bandless 3:4, so a persisted destination is
  // meaningless there; drop it rather than restore a stale value.
  const destinationUrl = outputKind === 'post'
    ? ''
    : value.destinationUrl as string

  const serverCampaignId = typeof value.serverCampaignId === 'string'
    && value.serverCampaignId.trim()
    && value.serverCampaignId.length <= 255
      ? value.serverCampaignId
      : null

  return {
    sourceUrls: normalizeSourceUrls(value.sourceUrls),
    productName: value.productName as string,
    tagline: value.tagline as string,
    destinationUrl,
    posterFormat,
    outputKind,
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
