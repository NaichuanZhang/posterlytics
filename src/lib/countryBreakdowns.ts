import type { BreakdownBucket } from './types'

const UNAVAILABLE_COUNTRY_KEY = 'country:unavailable'

const LEGACY_COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  'united states': 'US',
  'united states of america': 'US',
  canada: 'CA',
  india: 'IN',
  'united kingdom': 'GB',
  germany: 'DE',
  france: 'FR',
  australia: 'AU',
  japan: 'JP',
  china: 'CN',
  brazil: 'BR',
  mexico: 'MX',
  singapore: 'SG',
  'south korea': 'KR',
}

interface AggregatedCountryBucket extends BreakdownBucket {
  label: string
  unavailable: boolean
}

export interface CountryBreakdownDisplay {
  buckets: BreakdownBucket[]
  unavailableVisits: number
}

export function countryBreakdownsForDisplay(
  buckets: readonly BreakdownBucket[],
  locale: string,
  unavailableLabel: string,
): CountryBreakdownDisplay {
  const aggregated = new Map<string, AggregatedCountryBucket>()

  for (const bucket of buckets) {
    const rawKey = bucket.key.trim()
    const unavailable = !rawKey || rawKey.toLowerCase() === 'unknown'
    const code = unavailable ? null : countryCode(rawKey)
    const key = unavailable
      ? UNAVAILABLE_COUNTRY_KEY
      : code
        ? `country:${code}`
        : `legacy:${rawKey.toLocaleLowerCase('en-US')}`
    const label = unavailable
      ? unavailableLabel
      : code
        ? localizedCountryName(code, locale)
        : rawKey
    const existing = aggregated.get(key)

    aggregated.set(key, existing
      ? { ...existing, visits: existing.visits + bucket.visits }
      : { key, label, visits: bucket.visits, unavailable })
  }

  const unavailableBucket = aggregated.get(UNAVAILABLE_COUNTRY_KEY)
  const resolved = [...aggregated.values()]
    .filter((bucket) => !bucket.unavailable)
    .sort((left, right) => (
      right.visits - left.visits
      || left.label.localeCompare(right.label, locale)
    ))
    .map(({ key, label, visits }) => ({ key, label, visits }))

  return {
    buckets: unavailableBucket
      ? [
          ...resolved,
          {
            key: unavailableBucket.key,
            label: unavailableBucket.label,
            visits: unavailableBucket.visits,
          },
        ]
      : resolved,
    unavailableVisits: unavailableBucket?.visits ?? 0,
  }
}

function countryCode(value: string): string | null {
  const normalized = value.toUpperCase()
  if (/^[A-Z]{2}$/.test(normalized) && normalized !== 'XX' && normalized !== 'ZZ') {
    return normalized
  }
  return LEGACY_COUNTRY_ALIASES[value.toLocaleLowerCase('en-US')] ?? null
}

function localizedCountryName(code: string, locale: string): string {
  try {
    if (typeof Intl.DisplayNames !== 'function') return code
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}
