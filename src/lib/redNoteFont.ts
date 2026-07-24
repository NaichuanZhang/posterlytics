import type { RedNotePostPlan } from './redNotePost'
import { getRedNotePageRenderModel } from './redNoteRender'

export const REDNOTE_CJK_FONT_FAMILY = 'Posterlytics RedNote CJK'
export const REDNOTE_CJK_FONT_WEIGHT = 500
export const REDNOTE_CJK_FONT_LOAD =
  `${REDNOTE_CJK_FONT_WEIGHT} 16px "${REDNOTE_CJK_FONT_FAMILY}"`
export const REDNOTE_CJK_FONT_MAX_BYTES = 1_228_800
export const REDNOTE_CJK_FONT_MAX_BASE64_CHARS =
  4 * Math.ceil(REDNOTE_CJK_FONT_MAX_BYTES / 3)
export const REDNOTE_CJK_UNICODE_RANGE =
  'U+3000-303F,U+3400-4DBF,U+4E00-9FFF,U+F900-FAFF,U+FF00-FFEF'

const EMBED_CSS_OVERHEAD_BUDGET = 1_024
export const REDNOTE_FONT_EMBED_CSS_MAX_CHARS =
  REDNOTE_CJK_FONT_MAX_BASE64_CHARS + EMBED_CSS_OVERHEAD_BUDGET

const WOFF2_SIGNATURE = [0x77, 0x4f, 0x46, 0x32] as const
const FONT_DATA_URL_PREFIX = 'data:font/woff2;base64,'

export interface RedNotePageFontUsage {
  readonly allText: string
  readonly cjkText: string
  readonly needsBundledFace: boolean
}

type FontFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export function getRedNotePageFontUsage(
  plan: RedNotePostPlan,
  pageIndex: number,
): RedNotePageFontUsage {
  const model = getRedNotePageRenderModel(plan, pageIndex)
  const values = model.kind === 'cover'
    ? [model.page.title, model.page.subtitle ?? '', model.pageMarker]
    : [model.page.heading, ...model.page.blocks, model.pageMarker]
  const codePoints = uniqueCodePoints(values.join(''))
  const cjkCodePoints = codePoints.filter(isRedNoteCjkCodePoint)

  return {
    allText: codePoints.join(''),
    cjkText: cjkCodePoints.join(''),
    needsBundledFace: cjkCodePoints.length > 0,
  }
}

export function isRedNoteCjkCodePoint(value: string): boolean {
  const codePoint = value.codePointAt(0)
  if (codePoint === undefined) return false
  return (
    inRange(codePoint, 0x3000, 0x303f)
    || inRange(codePoint, 0x3400, 0x4dbf)
    || inRange(codePoint, 0x4e00, 0x9fff)
    || inRange(codePoint, 0xf900, 0xfaff)
    || inRange(codePoint, 0xff00, 0xffef)
  )
}

export function selectRedNoteFontEmbedCss(
  usage: RedNotePageFontUsage,
  embeddedCss: string,
): string {
  return usage.needsBundledFace
    ? validateRedNoteFontEmbedCss(embeddedCss)
    : ''
}

export function buildRedNoteFontEmbedCss(fontDataUrl: string): string {
  if (!fontDataUrl.startsWith(FONT_DATA_URL_PREFIX)) {
    throw new TypeError('RedNote font data must be a WOFF2 data URL.')
  }
  const encodedFont = fontDataUrl.slice(FONT_DATA_URL_PREFIX.length)
  if (!encodedFont || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedFont)) {
    throw new TypeError('RedNote font data is not valid base64.')
  }
  if (encodedFont.length > REDNOTE_CJK_FONT_MAX_BASE64_CHARS) {
    throw new RangeError('RedNote embedded font exceeds its base64 budget.')
  }

  return validateRedNoteFontEmbedCss(
    '@font-face{'
    + `font-family:"${REDNOTE_CJK_FONT_FAMILY}";`
    + 'font-style:normal;'
    + 'font-display:block;'
    + `font-weight:${REDNOTE_CJK_FONT_WEIGHT};`
    + `src:url("${fontDataUrl}") format("woff2");`
    + `unicode-range:${REDNOTE_CJK_UNICODE_RANGE};`
    + '}',
  )
}

export async function fetchRedNoteFontEmbedCss(
  fontUrl: string,
  fetcher: FontFetcher = fetch,
): Promise<string> {
  const response = await fetcher(fontUrl, { cache: 'force-cache' })
  if (!response.ok) {
    throw new TypeError(
      `RedNote font fetch failed with status ${response.status}.`,
    )
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  validateRedNoteFontBytes(bytes)
  return buildRedNoteFontEmbedCss(
    `${FONT_DATA_URL_PREFIX}${bytesToBase64(bytes)}`,
  )
}

export function validateRedNoteFontEmbedCss(css: string): string {
  if (css.length > REDNOTE_FONT_EMBED_CSS_MAX_CHARS) {
    throw new RangeError('RedNote embedded font CSS exceeds its size budget.')
  }
  if ((css.match(/@font-face\b/g) ?? []).length !== 1) {
    throw new TypeError('RedNote export CSS must contain exactly one font face.')
  }
  if (
    !css.includes(`font-family:"${REDNOTE_CJK_FONT_FAMILY}"`)
    || !css.includes(`font-weight:${REDNOTE_CJK_FONT_WEIGHT}`)
  ) {
    throw new TypeError('RedNote export CSS does not describe the bundled face.')
  }
  const urls = Array.from(css.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi))
  if (
    urls.length !== 1
    || !urls[0][2].startsWith(FONT_DATA_URL_PREFIX)
  ) {
    throw new TypeError('RedNote export CSS must contain one embedded WOFF2 URL.')
  }
  if (css.includes('Space Grotesk')) {
    throw new TypeError('RedNote export CSS must not include unrelated fonts.')
  }
  return css
}

function uniqueCodePoints(value: string): string[] {
  return Array.from(new Set(Array.from(value)))
}

function inRange(value: number, start: number, end: number): boolean {
  return value >= start && value <= end
}

function validateRedNoteFontBytes(bytes: Uint8Array): void {
  if (bytes.byteLength === 0 || bytes.byteLength > REDNOTE_CJK_FONT_MAX_BYTES) {
    throw new RangeError('RedNote WOFF2 is empty or exceeds its byte budget.')
  }
  if (!WOFF2_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new TypeError('RedNote font asset is not a WOFF2 file.')
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}
