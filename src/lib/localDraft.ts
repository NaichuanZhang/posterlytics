import {
  MAX_REFERENCE_IMAGES,
  MAX_REFERENCE_IMAGE_BYTES,
  REFERENCE_IMAGE_TYPES,
  validateReferenceUrl,
  type PendingReference,
  type PendingUrlReference,
} from './references'

export const LOCAL_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
export const CAMPAIGN_DRAFT_KEY_PREFIX = 'posterlytics.campaignDraft.'
export const EDITOR_DRAFT_KEY_PREFIX = 'posterlytics.editorDraft.'

export interface LocalDraftEnvelopeV1<T> {
  version: 1
  ownerId: string
  updatedAt: string
  data: T
}

export interface LocalDraftStorage {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface LocalDraftFileReference {
  kind: 'file'
  name: string
  size: number
  type: string
}

export interface LocalDraftUrlReference {
  kind: 'url'
  url: string
  name: string
}

export type LocalDraftReference =
  | LocalDraftFileReference
  | LocalDraftUrlReference

export function createLocalDraftEnvelope<T>(
  ownerId: string,
  data: T,
  nowMs = Date.now(),
): LocalDraftEnvelopeV1<T> {
  return {
    version: 1,
    ownerId,
    updatedAt: new Date(nowMs).toISOString(),
    data,
  }
}

export function parseLocalDraftEnvelope<T>(
  raw: string | null,
  ownerId: string,
  parseData: (value: unknown) => T | null,
  nowMs = Date.now(),
): LocalDraftEnvelopeV1<T> | null {
  if (!raw || !ownerId) return null

  try {
    const value = JSON.parse(raw) as unknown
    if (!isRecord(value)) return null
    if (
      value.version !== 1
      || value.ownerId !== ownerId
      || typeof value.updatedAt !== 'string'
    ) {
      return null
    }

    const updatedAtMs = Date.parse(value.updatedAt)
    if (
      !Number.isFinite(updatedAtMs)
      || updatedAtMs > nowMs
      || nowMs - updatedAtMs > LOCAL_DRAFT_MAX_AGE_MS
    ) {
      return null
    }

    const data = parseData(value.data)
    if (data === null) return null

    return {
      version: 1,
      ownerId,
      updatedAt: new Date(updatedAtMs).toISOString(),
      data,
    }
  } catch {
    return null
  }
}

export function getBrowserLocalDraftStorage(): LocalDraftStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readLocalDraftValue(
  key: string,
  storage: LocalDraftStorage | null = getBrowserLocalDraftStorage(),
): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function removeLocalDraftValue(
  key: string,
  storage: LocalDraftStorage | null = getBrowserLocalDraftStorage(),
): boolean {
  try {
    storage?.removeItem(key)
    return true
  } catch {
    return false
  }
}

export function clearAllLocalDrafts(
  storage: LocalDraftStorage | null = getBrowserLocalDraftStorage(),
): void {
  if (!storage) return

  try {
    const keys: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (
        key?.startsWith(CAMPAIGN_DRAFT_KEY_PREFIX)
        || key?.startsWith(EDITOR_DRAFT_KEY_PREFIX)
      ) {
        keys.push(key)
      }
    }
    for (const key of keys) {
      try {
        storage.removeItem(key)
      } catch {
        // Continue clearing any remaining drafts.
      }
    }
  } catch {
    // Draft cleanup must never prevent sign-out.
  }
}

export function serializeLocalDraftReferences(
  references: readonly PendingReference[],
  retainedFiles: readonly LocalDraftFileReference[] = [],
): LocalDraftReference[] {
  const serializedReferences = references.map(
    (reference): LocalDraftReference => (
      reference.kind === 'file'
        ? {
            kind: 'file',
            name: reference.file.name,
            size: reference.file.size,
            type: reference.file.type,
          }
        : {
            kind: 'url',
            url: reference.url,
            name: reference.name,
          }
    ),
  )

  return normalizeLocalDraftReferences([
    ...serializedReferences,
    ...retainedFiles,
  ])
}

export function parseLocalDraftReferences(value: unknown): LocalDraftReference[] {
  return Array.isArray(value) ? normalizeLocalDraftReferences(value) : []
}

export function rehydrateLocalDraftReferences(
  references: readonly LocalDraftReference[],
  createId: () => string = () => crypto.randomUUID(),
): {
  pendingReferences: PendingUrlReference[]
  unrestorableFiles: LocalDraftFileReference[]
} {
  const pendingReferences: PendingUrlReference[] = []
  const unrestorableFiles: LocalDraftFileReference[] = []

  for (const reference of references) {
    if (reference.kind === 'file') {
      unrestorableFiles.push({ ...reference })
    } else {
      pendingReferences.push({
        id: createId(),
        kind: 'url',
        url: reference.url,
        name: reference.name,
        previewStatus: 'loading',
      })
    }
  }

  return { pendingReferences, unrestorableFiles }
}

export function canonicalLocalDraftContent(value: unknown): string {
  return JSON.stringify(canonicalize(value)) ?? 'null'
}

function normalizeLocalDraftReferences(
  values: readonly unknown[],
): LocalDraftReference[] {
  const references: LocalDraftReference[] = []
  const seenUrls = new Set<string>()

  for (const value of values) {
    if (references.length >= MAX_REFERENCE_IMAGES) break
    if (!isRecord(value)) continue

    if (
      value.kind === 'file'
      && typeof value.name === 'string'
      && value.name.trim()
      && typeof value.size === 'number'
      && Number.isFinite(value.size)
      && value.size > 0
      && value.size <= MAX_REFERENCE_IMAGE_BYTES
      && typeof value.type === 'string'
      && REFERENCE_IMAGE_TYPES.includes(
        value.type as (typeof REFERENCE_IMAGE_TYPES)[number],
      )
    ) {
      references.push({
        kind: 'file',
        name: value.name.slice(0, 255),
        size: value.size,
        type: value.type,
      })
      continue
    }

    if (
      value.kind !== 'url'
      || typeof value.url !== 'string'
      || (typeof value.name !== 'string' && value.name !== undefined)
    ) {
      continue
    }

    const validated = validateReferenceUrl(value.url)
    if (!validated.ok || seenUrls.has(validated.url)) continue
    seenUrls.add(validated.url)
    references.push({
      kind: 'url',
      url: validated.url,
      name: typeof value.name === 'string' && value.name.trim()
        ? value.name.trim().slice(0, 255)
        : validated.name,
    })
  }

  return references
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) {
    return typeof value === 'number' && !Number.isFinite(value) ? null : value
  }

  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => key !== 'updatedAt' && key !== 'previewStatus')
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  )
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
