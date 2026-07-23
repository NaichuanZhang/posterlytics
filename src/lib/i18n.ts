import {
  messages,
  type TranslationKey,
} from '../i18n/messages'

export const SUPPORTED_LOCALES = ['en-US', 'zh-CN'] as const
export const DEFAULT_LOCALE: SupportedLocale = 'en-US'

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]
export type TranslationValues = Record<string, string | number>
export type Translate = (
  key: TranslationKey,
  values?: TranslationValues,
) => string

export function resolveSupportedLocale(value: unknown): SupportedLocale | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en-US'
  return null
}

export function preferredLocale(
  languages: readonly string[] | undefined,
): SupportedLocale {
  for (const language of languages ?? []) {
    const locale = resolveSupportedLocale(language)
    if (locale) return locale
  }
  return DEFAULT_LOCALE
}

export function formatLocalizedDate(
  locale: SupportedLocale,
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, options).format(date)
}

export function formatFreshnessTimestamp(
  date: Date,
  locale: SupportedLocale,
): string {
  return formatLocalizedDate(locale, date, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function translateEnumLabel<Value extends string>(
  t: Translate,
  labels: Readonly<Record<Value, TranslationKey>>,
  value: Value,
): string {
  const key = labels[value]
  return key ? t(key) : String(value)
}

export function translate(
  locale: SupportedLocale,
  key: TranslationKey,
  values: TranslationValues = {},
): string {
  const template = messages[locale][key]
    ?? messages[DEFAULT_LOCALE][key]
    ?? String(key)
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : match
  ))
}
