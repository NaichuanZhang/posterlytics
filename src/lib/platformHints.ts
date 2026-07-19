import type { TranslationKey } from '../i18n/messages'

export const MAX_PLATFORM_HINT_LENGTH = 80

export const PLATFORM_HINT_VALUES = [
  'RedNote / 小红书',
  'YouTube',
  'Luma',
  'Instagram',
] as const

export type PlatformHintPreset = (typeof PLATFORM_HINT_VALUES)[number]

export interface PlatformHintOption {
  readonly value: PlatformHintPreset
  readonly label: TranslationKey
}

function catalogLabel<Key extends TranslationKey>(label: Key): Key {
  return label
}

export const PLATFORM_HINT_OPTIONS = [
  {
    value: 'RedNote / 小红书',
    label: catalogLabel('RedNote / 小红书'),
  },
  {
    value: 'YouTube',
    label: catalogLabel('YouTube'),
  },
  {
    value: 'Luma',
    label: catalogLabel('Luma'),
  },
  {
    value: 'Instagram',
    label: catalogLabel('Instagram'),
  },
] as const satisfies readonly PlatformHintOption[]

export function isPlatformHintPreset(value: string): value is PlatformHintPreset {
  return PLATFORM_HINT_VALUES.includes(value as PlatformHintPreset)
}

export function normalizePlatformHint(value: string | null | undefined): string | null {
  const normalized = value?.slice(0, MAX_PLATFORM_HINT_LENGTH).trim() ?? ''
  return normalized || null
}
