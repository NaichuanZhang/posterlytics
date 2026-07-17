import type { ReferenceImage } from './types'

export const MAX_REFERENCE_IMAGES = 5
export const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_REFERENCE_CONTEXT_LENGTH = 4000
export const REFERENCE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

type ReferenceFile = Pick<File, 'name' | 'size' | 'type'>

export type ReferencePreviewStatus = 'loading' | 'ready' | 'error'

export interface PendingFileReference {
  id: string
  kind: 'file'
  file: File
}

export interface PendingUrlReference {
  id: string
  kind: 'url'
  url: string
  name: string
  previewStatus: ReferencePreviewStatus
}

export type PendingReference = PendingFileReference | PendingUrlReference

export type ReferenceFileRejectionReason = 'type' | 'size' | 'capacity'

export interface ReferenceFileRejection {
  filename: string
  reason: ReferenceFileRejectionReason
}

export type ReferenceUrlRejectionReason =
  | 'invalid'
  | 'protocol'
  | 'credentials'
  | 'duplicate'
  | 'capacity'

export interface ReferenceUrlRejection {
  value: string
  reason: ReferenceUrlRejectionReason
}

export type ReferenceUrlValidation =
  | { ok: true; url: string; name: string }
  | { ok: false; reason: 'invalid' | 'protocol' | 'credentials' }

export function partitionReferenceFiles<TFile extends ReferenceFile>(
  currentCount: number,
  additions: readonly TFile[],
): { accepted: TFile[]; rejected: ReferenceFileRejection[] } {
  const accepted: TFile[] = []
  const rejected: ReferenceFileRejection[] = []
  const remainingSlots = Math.max(0, MAX_REFERENCE_IMAGES - Math.max(0, currentCount))

  for (const file of additions) {
    if (!REFERENCE_IMAGE_TYPES.includes(file.type as (typeof REFERENCE_IMAGE_TYPES)[number])) {
      rejected.push({ filename: file.name, reason: 'type' })
    } else if (file.size <= 0 || file.size > MAX_REFERENCE_IMAGE_BYTES) {
      rejected.push({ filename: file.name, reason: 'size' })
    } else if (accepted.length >= remainingSlots) {
      rejected.push({ filename: file.name, reason: 'capacity' })
    } else {
      accepted.push(file)
    }
  }

  return { accepted, rejected }
}

export function validateReferenceUrl(value: string): ReferenceUrlValidation {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 2048) return { ok: false, reason: 'invalid' }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  if (url.protocol !== 'https:') return { ok: false, reason: 'protocol' }
  if (url.username || url.password) return { ok: false, reason: 'credentials' }

  url.hash = ''
  return {
    ok: true,
    url: url.href,
    name: referenceNameFromUrl(url),
  }
}

export function partitionReferenceUrls(
  currentCount: number,
  currentUrls: readonly string[],
  additions: readonly string[],
): {
  accepted: Array<{ url: string; name: string }>
  rejected: ReferenceUrlRejection[]
} {
  const accepted: Array<{ url: string; name: string }> = []
  const rejected: ReferenceUrlRejection[] = []
  const remainingSlots = Math.max(0, MAX_REFERENCE_IMAGES - Math.max(0, currentCount))
  const seen = new Set(
    currentUrls.flatMap((value) => {
      const result = validateReferenceUrl(value)
      return result.ok ? [result.url] : []
    }),
  )

  for (const value of additions) {
    const result = validateReferenceUrl(value)
    if (!result.ok) {
      rejected.push({ value, reason: result.reason })
    } else if (seen.has(result.url)) {
      rejected.push({ value, reason: 'duplicate' })
    } else if (accepted.length >= remainingSlots) {
      rejected.push({ value, reason: 'capacity' })
    } else {
      accepted.push({ url: result.url, name: result.name })
      seen.add(result.url)
    }
  }

  return { accepted, rejected }
}

export function parseDroppedReferenceUrls(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

export function createPendingFileReference(file: File): PendingFileReference {
  return {
    id: crypto.randomUUID(),
    kind: 'file',
    file,
  }
}

export function createPendingUrlReference(
  value: Pick<PendingUrlReference, 'url' | 'name'>,
): PendingUrlReference {
  return {
    id: crypto.randomUUID(),
    kind: 'url',
    url: value.url,
    name: value.name,
    previewStatus: 'loading',
  }
}

export function pendingReferencesReady(references: readonly PendingReference[]): boolean {
  return references.every(
    (reference) => reference.kind === 'file' || reference.previewStatus === 'ready',
  )
}

export function normalizeReferenceContext(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, MAX_REFERENCE_CONTEXT_LENGTH) : null
}

export function normalizeReferenceImages(value: unknown): ReferenceImage[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      key: typeof item.key === 'string' ? item.key : '',
      url: typeof item.url === 'string' ? item.url : '',
      name: typeof item.name === 'string' ? item.name : 'Reference image',
      mime_type: typeof item.mime_type === 'string' ? item.mime_type : '',
      size_bytes: typeof item.size_bytes === 'number' ? item.size_bytes : 0,
    }))
    .filter((item) => item.key && item.url)
    .slice(0, MAX_REFERENCE_IMAGES)
}

export function safeReferenceFilename(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
  return normalized || 'reference-image'
}

export function referenceNameFromUrl(value: string | URL): string {
  const url = typeof value === 'string' ? new URL(value) : value
  const pathParts = url.pathname.split('/').filter(Boolean)
  const encodedName = url.pathname.endsWith('/') ? '' : pathParts[pathParts.length - 1] ?? ''
  let decodedName = encodedName
  try {
    decodedName = decodeURIComponent(encodedName)
  } catch {
    // Keep the encoded path segment when it contains malformed escapes.
  }
  const safeName = safeReferenceFilename(decodedName)
  return safeName === 'reference-image' ? `${url.hostname}-image` : safeName
}
