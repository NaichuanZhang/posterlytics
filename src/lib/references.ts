import type { ReferenceImage } from './types'

export const MAX_REFERENCE_IMAGES = 5
export const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_REFERENCE_CONTEXT_LENGTH = 4000
export const REFERENCE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

type ReferenceFile = Pick<File, 'name' | 'size' | 'type'>

export function validateReferenceFiles(
  currentCount: number,
  additions: readonly ReferenceFile[],
): string | null {
  if (currentCount + additions.length > MAX_REFERENCE_IMAGES) {
    return `Add up to ${MAX_REFERENCE_IMAGES} reference images.`
  }

  for (const file of additions) {
    if (!REFERENCE_IMAGE_TYPES.includes(file.type as (typeof REFERENCE_IMAGE_TYPES)[number])) {
      return `${file.name} must be a JPEG, PNG, or WebP image.`
    }
    if (file.size <= 0 || file.size > MAX_REFERENCE_IMAGE_BYTES) {
      return `${file.name} must be smaller than 10 MB.`
    }
  }

  return null
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
