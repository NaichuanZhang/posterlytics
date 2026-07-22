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
import type { PendingReference } from './references'

const EDITOR_DRAFT_VERSION_PREFIX = 'posterlytics.editorDraft.v1:'

export interface PosterEditorDraftDataV1 {
  campaignId: string
  instruction: string
  platformHint: string
  platformHintBaseline: string | null
  refreshWebsite: boolean
  references: LocalDraftReference[]
}

export type PosterEditorDraftV1 =
  LocalDraftEnvelopeV1<PosterEditorDraftDataV1>

export interface PosterEditorDraftInputV1 {
  campaignId: string
  instruction: string
  platformHint: string
  platformHintBaseline: string | null
  refreshWebsite: boolean
  pendingReferences: readonly PendingReference[]
  unrestorableFiles?: readonly LocalDraftFileReference[]
}

export interface RestoredPosterEditorDraft {
  instruction: string
  platformHint: string
  platformHintBaseline: string | null
  refreshWebsite: boolean
  references: LocalDraftReference[]
}

export function posterEditorDraftKey(
  userId: string,
  campaignId: string,
): string {
  return `${EDITOR_DRAFT_VERSION_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(campaignId)}`
}

export function buildPosterEditorDraftData(
  input: PosterEditorDraftInputV1,
): PosterEditorDraftDataV1 {
  return {
    campaignId: input.campaignId,
    instruction: input.instruction,
    platformHint: input.platformHint,
    platformHintBaseline: input.platformHintBaseline,
    refreshWebsite: input.refreshWebsite,
    references: serializeLocalDraftReferences(
      input.pendingReferences,
      input.unrestorableFiles,
    ),
  }
}

export function serializePosterEditorDraft(
  ownerId: string,
  data: PosterEditorDraftDataV1,
  nowMs = Date.now(),
): string {
  return JSON.stringify(createLocalDraftEnvelope(ownerId, data, nowMs))
}

export function parsePosterEditorDraft(
  raw: string | null,
  ownerId: string,
  campaignId: string,
  nowMs = Date.now(),
): PosterEditorDraftV1 | null {
  const parsed = parseLocalDraftEnvelope(
    raw,
    ownerId,
    parsePosterEditorDraftData,
    nowMs,
  )
  return parsed?.data.campaignId === campaignId ? parsed : null
}

export function loadPosterEditorDraft(
  ownerId: string,
  campaignId: string,
  storage: LocalDraftStorage | null = getBrowserLocalDraftStorage(),
  nowMs = Date.now(),
): PosterEditorDraftV1 | null {
  return parsePosterEditorDraft(
    readLocalDraftValue(posterEditorDraftKey(ownerId, campaignId), storage),
    ownerId,
    campaignId,
    nowMs,
  )
}

export function restorePosterEditorDraft(
  data: PosterEditorDraftDataV1,
  serverPlatformHint: string | null,
): RestoredPosterEditorDraft {
  const baselineStillCurrent = data.platformHintBaseline === serverPlatformHint
  return {
    instruction: data.instruction,
    platformHint: baselineStillCurrent
      ? data.platformHint
      : serverPlatformHint ?? '',
    platformHintBaseline: serverPlatformHint,
    refreshWebsite: data.refreshWebsite,
    references: data.references,
  }
}

export function isPosterEditorDraftDirty(
  data: PosterEditorDraftDataV1,
): boolean {
  return (
    data.instruction !== ''
    || data.platformHint !== (data.platformHintBaseline ?? '')
    || data.refreshWebsite
    || data.references.length > 0
  )
}

function parsePosterEditorDraftData(
  value: unknown,
): PosterEditorDraftDataV1 | null {
  if (
    !isRecord(value)
    || typeof value.campaignId !== 'string'
    || !value.campaignId
    || typeof value.instruction !== 'string'
    || typeof value.platformHint !== 'string'
    || (
      value.platformHintBaseline !== null
      && typeof value.platformHintBaseline !== 'string'
    )
    || typeof value.refreshWebsite !== 'boolean'
    || !Array.isArray(value.references)
  ) {
    return null
  }

  return {
    campaignId: value.campaignId,
    instruction: value.instruction,
    platformHint: value.platformHint,
    platformHintBaseline: value.platformHintBaseline,
    refreshWebsite: value.refreshWebsite,
    references: parseLocalDraftReferences(value.references),
  }
}
