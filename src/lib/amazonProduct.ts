import { AMAZON_SOURCE_HOSTS } from './amazonSource'

const AMAZON_SOURCE_HOST_SET = new Set<string>(AMAZON_SOURCE_HOSTS)
const ASIN_PATH_PATTERN =
  /(?:^|\/)(?:dp|gp\/product|gp\/aw\/d|gp\/offer-listing|exec\/obidos\/ASIN|o\/ASIN)\/([A-Z0-9]{10})(?=\/|$)/i
const MAX_PRODUCT_TITLE_LENGTH = 500

const BLOCKED_PAGE_MARKERS = [
  'api-services-support@amazon.com',
  'automated access to amazon data',
  'enter the characters you see below',
  'sorry, we just need to make sure you\'re not a robot',
  'to discuss automated access to amazon data',
  '/errors/validatecaptcha',
] as const

const BLOCKED_TITLE_PATTERN =
  /^(?:amazon(?:\.com)?|amazon sign-in|page not found|robot check|sorry! something went wrong)$/i
const AMAZON_TITLE_PREFIX_PATTERN = /^amazon\.com\s*:\s*/i
const AMAZON_TITLE_CATEGORY_SUFFIX_PATTERN = /\s+:\s+[^:]+$/

export function parseAmazonAsin(value: string): string | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username
    || url.password
    || !AMAZON_SOURCE_HOST_SET.has(url.hostname)
  ) {
    return null
  }

  const match = ASIN_PATH_PATTERN.exec(url.pathname)
  return match ? match[1].toUpperCase() : null
}

export function canonicalAmazonProductUrl(asin: string): string | null {
  const normalized = normalizeAsin(asin)
  return normalized ? `https://www.amazon.com/dp/${normalized}` : null
}

export function extractAmazonProductTitle(html: string): string | null {
  if (!html || isAmazonBlockedContent(html)) return null

  return (
    extractElementTextById(html, 'productTitle')
    ?? extractProductJsonLdName(html)
    ?? extractOpenGraphTitle(html)
  )
}

export function sanitizeAmazonProductTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const title = stripAmazonTitleWrapper(normalizeText(value))
  if (
    !title
    || BLOCKED_TITLE_PATTERN.test(title)
    || isAmazonBlockedContent(title)
  ) {
    return null
  }
  return title.slice(0, MAX_PRODUCT_TITLE_LENGTH).trim() || null
}

function stripAmazonTitleWrapper(value: string): string {
  const withoutPrefix = value.replace(AMAZON_TITLE_PREFIX_PATTERN, '')
  if (withoutPrefix === value) return value
  return withoutPrefix.replace(AMAZON_TITLE_CATEGORY_SUFFIX_PATTERN, '').trim()
}

export function isAmazonBlockedContent(value: string): boolean {
  const normalized = value.toLowerCase()
  return BLOCKED_PAGE_MARKERS.some((marker) => normalized.includes(marker))
    || /<title[^>]*>\s*robot check\s*<\/title>/i.test(value)
}

function normalizeAsin(value: string): string | null {
  const normalized = value.trim().toUpperCase()
  return /^[A-Z0-9]{10}$/.test(normalized) ? normalized : null
}

function extractElementTextById(html: string, id: string): string | null {
  const openingTag = /<([a-z][\w:-]*)\b([^>]*)>/gi
  for (let match = openingTag.exec(html); match; match = openingTag.exec(html)) {
    const attributes = parseAttributes(match[2])
    if (attributes.id !== id) continue

    const closingTag = new RegExp(`</${escapeRegExp(match[1])}\\s*>`, 'gi')
    closingTag.lastIndex = openingTag.lastIndex
    const closingMatch = closingTag.exec(html)
    if (!closingMatch) return null
    return sanitizeAmazonProductTitle(
      stripHtml(html.slice(openingTag.lastIndex, closingMatch.index)),
    )
  }
  return null
}

function extractProductJsonLdName(html: string): string | null {
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
  for (
    let match = scriptPattern.exec(html);
    match;
    match = scriptPattern.exec(html)
  ) {
    const attributes = parseAttributes(match[1])
    if (attributes.type?.toLowerCase() !== 'application/ld+json') continue

    const source = match[2]
      .replace(/^\s*<!--/, '')
      .replace(/-->\s*$/, '')
      .trim()
    if (!source) continue

    try {
      const name = findProductName(JSON.parse(source))
      if (name) return name
    } catch {
      // Ignore malformed structured data and continue to lower-priority sources.
    }
  }
  return null
}

function findProductName(value: unknown): string | null {
  const queue: unknown[] = [value]
  const seen = new Set<object>()
  let visited = 0

  while (queue.length > 0 && visited < 2_000) {
    const candidate = queue.shift()
    visited += 1
    if (!candidate || typeof candidate !== 'object') continue
    if (seen.has(candidate)) continue
    seen.add(candidate)

    if (Array.isArray(candidate)) {
      queue.push(...candidate)
      continue
    }

    const record = candidate as Record<string, unknown>
    if (hasJsonLdType(record['@type'], 'Product')) {
      const name = sanitizeAmazonProductTitle(record.name)
      if (name) return name
    }
    queue.push(...Object.values(record))
  }
  return null
}

function hasJsonLdType(value: unknown, expected: string): boolean {
  if (typeof value === 'string') {
    return value.toLowerCase() === expected.toLowerCase()
  }
  return Array.isArray(value)
    && value.some((item) => hasJsonLdType(item, expected))
}

function extractOpenGraphTitle(html: string): string | null {
  const metaPattern = /<meta\b([^>]*)>/gi
  for (let match = metaPattern.exec(html); match; match = metaPattern.exec(html)) {
    const attributes = parseAttributes(match[1])
    if (attributes.property?.toLowerCase() === 'og:title') {
      const title = sanitizeAmazonProductTitle(attributes.content)
      if (title) return title
    }
  }
  return null
}

function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern =
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    attributes[match[1].toLowerCase()] = decodeHtmlEntities(
      match[2] ?? match[3] ?? match[4] ?? '',
    )
  }
  return attributes
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ' '))
}

function normalizeText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: '\'',
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]+));/gi,
    (entity, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (decimal || hex) {
        const codePoint = Number.parseInt(decimal ?? hex ?? '', decimal ? 10 : 16)
        if (
          Number.isInteger(codePoint)
          && codePoint > 0
          && codePoint <= 0x10ffff
          && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return String.fromCodePoint(codePoint)
        }
        return entity
      }
      return name && named[name.toLowerCase()] !== undefined
        ? named[name.toLowerCase()]
        : entity
    },
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
