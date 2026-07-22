import type { PosterSizeSlug } from './posterSize'

export const REDNOTE_POST_FORMAT: PosterSizeSlug = 'rednote_cover_3x4'
export const REDNOTE_POST_MIN_PAGES = 2
export const REDNOTE_POST_MAX_PAGES = 9

const COVER_TITLE_MAX_CODE_POINTS = 48
const COVER_SUBTITLE_MAX_CODE_POINTS = 96
const CONTENT_HEADING_MAX_CODE_POINTS = 64
const CONTENT_BLOCK_MAX_CODE_POINTS = 160
const CONTENT_BLOCK_MAX_COUNT = 4

export interface RedNoteCoverPage {
  kind: 'cover'
  title: string
  subtitle?: string
}

export interface RedNoteContentPage {
  kind: 'content'
  heading: string
  blocks: string[]
}

export type RedNotePostPage = RedNoteCoverPage | RedNoteContentPage

export interface RedNotePostPlan {
  schema_version: 1
  pages: RedNotePostPage[]
}

export interface RedNoteSourceCopyInput {
  title: string
  subtitle?: string | null
  sourceCopy: string
}

export type RedNoteModelTextNormalizer = (
  value: string,
  maxCodePoints: number,
) => string

export interface RedNotePosterContentProjection {
  headline: string
  what_it_does: string
  how_it_works: string[]
  why_use_it: string[]
  features: string[]
  cta: string
  rednote_post: RedNotePostPlan
}

export interface RedNoteRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface RedNotePageComposition {
  readonly pageIndex: number
  readonly pageCount: number
  readonly frame: RedNoteRect
  readonly background: RedNoteRect
  readonly coverText: RedNoteRect | null
  readonly panel: RedNoteRect | null
  readonly heading: RedNoteRect | null
  readonly body: RedNoteRect | null
  readonly pageMarker: RedNoteRect
}

const FRAME: RedNoteRect = { x: 0, y: 0, width: 1242, height: 1656 }
const COVER_TEXT: RedNoteRect = { x: 96, y: 852, width: 1050, height: 636 }
const CONTENT_PANEL: RedNoteRect = { x: 72, y: 72, width: 1098, height: 1512 }
const CONTENT_HEADING: RedNoteRect = { x: 144, y: 168, width: 954, height: 216 }
const CONTENT_BODY: RedNoteRect = { x: 144, y: 432, width: 954, height: 896 }
const PAGE_MARKER: RedNoteRect = { x: 1002, y: 1516, width: 144, height: 40 }

export function normalizeRedNotePostPlan(
  raw: unknown,
  fallback: RedNoteSourceCopyInput,
  normalizeModelText?: RedNoteModelTextNormalizer,
): RedNotePostPlan {
  const fallbackPlan = splitRedNoteSourceCopy(fallback)
  const record = recordOf(raw)
  if (
    ('schema_version' in record && record.schema_version !== 1)
    || !Array.isArray(record.pages)
  ) {
    return fallbackPlan
  }

  const fallbackCover = fallbackPlan.pages[0] as RedNoteCoverPage
  const rawCover = record.pages.find(
    (page) => recordOf(page).kind === 'cover',
  )
  const cover = normalizeCoverPage(
    rawCover,
    fallbackCover,
    normalizeModelText,
  )
  const contentPages = normalizeContentPages(
    record.pages,
    normalizeModelText,
  )

  if (contentPages.length === 0) {
    return {
      schema_version: 1,
      pages: [cover, ...cloneContentPages(fallbackPlan.pages.slice(1))],
    }
  }

  return {
    schema_version: 1,
    pages: [
      cover,
      ...contentPages.slice(0, REDNOTE_POST_MAX_PAGES - 1),
    ],
  }
}

export function projectRedNotePostPlanToPosterContent(
  plan: RedNotePostPlan,
): RedNotePosterContentProjection {
  const cover = plan.pages[0] as RedNoteCoverPage
  const features = uniqueStrings(
    plan.pages
      .filter((page): page is RedNoteContentPage => page.kind === 'content')
      .map((page) => page.heading)
      .filter(Boolean),
  ).slice(0, 6)

  return {
    headline: cover.title,
    what_it_does: cover.subtitle ?? '',
    how_it_works: [],
    why_use_it: [],
    features,
    cta: '',
    rednote_post: {
      schema_version: 1,
      pages: plan.pages.map((page) => (
        page.kind === 'cover'
          ? {
              kind: 'cover',
              title: page.title,
              ...(page.subtitle ? { subtitle: page.subtitle } : {}),
            }
          : {
              kind: 'content',
              heading: page.heading,
              blocks: [...page.blocks],
            }
      )),
    },
  }
}

export function splitRedNoteSourceCopy(
  input: RedNoteSourceCopyInput,
): RedNotePostPlan {
  const sourceSegments = uniqueStrings(
    splitSourceSegments(input.sourceCopy)
      .flatMap((segment) => chunkByCodePoints(segment, CONTENT_BLOCK_MAX_CODE_POINTS)),
  )
  const title = boundedText(input.title, COVER_TITLE_MAX_CODE_POINTS)
    || boundedText(sourceSegments[0], COVER_TITLE_MAX_CODE_POINTS)
  const subtitle = boundedText(input.subtitle, COVER_SUBTITLE_MAX_CODE_POINTS)
  const cover: RedNoteCoverPage = {
    kind: 'cover',
    title,
    ...(subtitle ? { subtitle } : {}),
  }
  const contentPages: RedNoteContentPage[] = []
  let cursor = 0

  while (
    cursor < sourceSegments.length
    && contentPages.length < REDNOTE_POST_MAX_PAGES - 1
  ) {
    const firstSegment = sourceSegments[cursor]
    cursor += 1
    const [heading, headingRemainder] = splitAtCodePoint(
      firstSegment,
      CONTENT_HEADING_MAX_CODE_POINTS,
    )
    const blocks = headingRemainder ? [headingRemainder] : []

    while (
      cursor < sourceSegments.length
      && blocks.length < CONTENT_BLOCK_MAX_COUNT
    ) {
      blocks.push(sourceSegments[cursor])
      cursor += 1
    }

    contentPages.push({
      kind: 'content',
      heading,
      blocks,
    })
  }

  if (contentPages.length === 0) {
    contentPages.push({
      kind: 'content',
      heading: boundedText(
        subtitle || title,
        CONTENT_HEADING_MAX_CODE_POINTS,
      ),
      blocks: [],
    })
  }

  return {
    schema_version: 1,
    pages: [cover, ...contentPages],
  }
}

export function getRedNotePageComposition(
  page: RedNotePostPage,
  pageIndex: number,
  pageCount: number,
): RedNotePageComposition {
  if (
    !Number.isInteger(pageCount)
    || pageCount < REDNOTE_POST_MIN_PAGES
    || pageCount > REDNOTE_POST_MAX_PAGES
  ) {
    throw new RangeError('RedNote page count is outside the supported range.')
  }
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
    throw new RangeError('RedNote page index is outside the post.')
  }

  return page.kind === 'cover'
    ? {
        pageIndex,
        pageCount,
        frame: { ...FRAME },
        background: { ...FRAME },
        coverText: { ...COVER_TEXT },
        panel: null,
        heading: null,
        body: null,
        pageMarker: { ...PAGE_MARKER },
      }
    : {
        pageIndex,
        pageCount,
        frame: { ...FRAME },
        background: { ...FRAME },
        coverText: null,
        panel: { ...CONTENT_PANEL },
        heading: { ...CONTENT_HEADING },
        body: { ...CONTENT_BODY },
        pageMarker: { ...PAGE_MARKER },
      }
}

function normalizeCoverPage(
  raw: unknown,
  fallback: RedNoteCoverPage,
  normalizeModelText?: RedNoteModelTextNormalizer,
): RedNoteCoverPage {
  const record = recordOf(raw)
  const title = boundedModelText(
    record.title,
    COVER_TITLE_MAX_CODE_POINTS,
    normalizeModelText,
  )
    || fallback.title
  const subtitle = boundedModelText(
    record.subtitle,
    COVER_SUBTITLE_MAX_CODE_POINTS,
    normalizeModelText,
  ) || fallback.subtitle

  return {
    kind: 'cover',
    title,
    ...(subtitle ? { subtitle } : {}),
  }
}

function normalizeContentPages(
  rawPages: unknown[],
  normalizeModelText?: RedNoteModelTextNormalizer,
): RedNoteContentPage[] {
  const pages: RedNoteContentPage[] = []
  const signatures = new Set<string>()

  for (const rawPage of rawPages) {
    const record = recordOf(rawPage)
    if (record.kind !== 'content') continue

    const blocks = uniqueStrings(
      stringArray(record.blocks)
        .map((block) => boundedModelText(
          block,
          CONTENT_BLOCK_MAX_CODE_POINTS,
          normalizeModelText,
        ))
        .filter(Boolean),
    ).slice(0, CONTENT_BLOCK_MAX_COUNT)
    const suppliedHeading = boundedModelText(
      record.heading,
      CONTENT_HEADING_MAX_CODE_POINTS,
      normalizeModelText,
    )
    const heading = suppliedHeading
      || boundedText(blocks[0], CONTENT_HEADING_MAX_CODE_POINTS)
    if (!heading && blocks.length === 0) continue

    const page: RedNoteContentPage = {
      kind: 'content',
      heading,
      blocks,
    }
    const signature = JSON.stringify([page.heading, page.blocks])
    if (signatures.has(signature)) continue
    signatures.add(signature)
    pages.push(page)
  }

  return pages
}

function cloneContentPages(
  pages: RedNotePostPage[],
): RedNoteContentPage[] {
  return pages
    .filter((page): page is RedNoteContentPage => page.kind === 'content')
    .map((page) => ({
      kind: 'content',
      heading: page.heading,
      blocks: [...page.blocks],
    }))
}

function splitSourceSegments(value: unknown): string[] {
  if (typeof value !== 'string') return []

  return value
    .replace(/\r\n?/gu, '\n')
    .split(/\n+/gu)
    .flatMap((paragraph) => (
      paragraph.match(/[^.!?;。！？；]+(?:[.!?;。！？；]+|$)/gu) ?? []
    ))
    .map(normalizeWhitespace)
    .filter(Boolean)
}

function chunkByCodePoints(value: string, limit: number): string[] {
  const codePoints = Array.from(value)
  const chunks: string[] = []
  for (let start = 0; start < codePoints.length; start += limit) {
    const chunk = normalizeWhitespace(
      codePoints.slice(start, start + limit).join(''),
    )
    if (chunk) chunks.push(chunk)
  }
  return chunks
}

function splitAtCodePoint(value: string, limit: number): [string, string] {
  const codePoints = Array.from(value)
  return [
    normalizeWhitespace(codePoints.slice(0, limit).join('')),
    normalizeWhitespace(codePoints.slice(limit).join('')),
  ]
}

function boundedText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  return Array.from(normalizeWhitespace(value)).slice(0, limit).join('')
}

function boundedModelText(
  value: unknown,
  limit: number,
  normalizeModelText?: RedNoteModelTextNormalizer,
): string {
  if (typeof value !== 'string') return ''
  return boundedText(
    normalizeModelText ? normalizeModelText(value, limit) : value,
    limit,
  )
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  return typeof value === 'string' ? [value] : []
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
