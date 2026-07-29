import { isAmazonSourceUrl } from './amazonSource'

/**
 * Campaign source URL list handling.
 *
 * A campaign may declare up to three source URLs, but only the FIRST is ever
 * fetched or captured: `/capture` takes one scalar url, there is no compositor to
 * merge several style boards, and the style-board and eager-capture pointers are
 * scalar. URLs 2-3 contribute declared textual context only.
 *
 * `product_url` is the captured source and must always equal `source_urls[0]`.
 */

export const MAX_SOURCE_URLS = 3

/**
 * Coerces a persisted or user-supplied list into the shape the CHECK constraint
 * accepts: trimmed, non-blank, de-duplicated, and capped at three entries.
 */
export function normalizeSourceUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    normalized.push(trimmed)
    if (normalized.length === MAX_SOURCE_URLS) break
  }
  return normalized
}

/** The single source that is fetched and captured, or null when none is declared. */
export function primarySourceUrl(value: unknown): string | null {
  return normalizeSourceUrls(value)[0] ?? null
}

/**
 * The declared-but-uncaptured tail. Empty for a single-URL campaign, which is
 * what keeps its prompts byte-identical to a campaign created before this list
 * existed.
 */
export function additionalSourceUrls(value: unknown): string[] {
  return normalizeSourceUrls(value).slice(1)
}

/**
 * The `product_url` / `source_urls` pair to persist, derived from one list so the
 * scalar and the array can never drift.
 */
export function buildSourceUrlWrite(value: unknown): {
  product_url: string | null
  source_urls: string[]
} {
  const source_urls = normalizeSourceUrls(value)
  return { product_url: source_urls[0] ?? null, source_urls }
}

/**
 * The `resolveCreationUseCase` inputs implied by a source URL list.
 *
 * Derives both fields from ONE list so they cannot disagree, and keys the Amazon
 * test on the captured URL (`source_urls[0]`) — the only one ever fetched.
 */
export function creationSourceSignals(value: unknown): {
  hasSourceUrl: boolean
  primarySourceUrlIsAmazon: boolean
} {
  const primary = primarySourceUrl(value)
  return {
    hasSourceUrl: primary !== null,
    primarySourceUrlIsAmazon: primary !== null && isAmazonSourceUrl(primary),
  }
}
