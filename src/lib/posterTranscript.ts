import { groupZonesByBand } from './layoutPreview'
import {
  getPosterSize,
  hasPosterQrBand,
  type PosterSizeSlug,
} from './posterSize'
import {
  translate,
  type SupportedLocale,
} from './i18n'
import type {
  CampaignScenario,
  PosterContent,
  PosterCopy,
  PosterLayout,
  PosterSpec,
} from './types'
import type { UseCaseId } from './useCases'
import {
  clampRedNotePageIndex,
  resolveRedNoteRenderState,
} from './redNoteRender'

export type PosterTranscriptSource =
  | 'campaign'
  | 'poster-layout'
  | 'poster-content'
  | 'poster-copy'
  | 'poster-spec'
  | 'composited-footer'

export interface PosterTranscriptBlock {
  source: PosterTranscriptSource
  text: string
}

export interface PosterTranscript {
  shortAlt: string
  blocks: PosterTranscriptBlock[]
  plainText: string
}

export interface PosterTranscriptInput {
  product_name?: string | null
  tagline?: string | null
  scenario?: CampaignScenario | null
  use_case?: UseCaseId | null
  poster_format?: PosterSizeSlug | null
  poster_copy?: Partial<PosterCopy> | null
  poster_content?: Partial<PosterContent> | null
  poster_spec?: PosterSpec | null
  poster_layout?: PosterLayout | null
}

interface PosterTranscriptOptions {
  locale: SupportedLocale
  includeCompositedFooter: boolean
  pageIndex?: number
}

const SHORT_ALT_MAX_CODE_POINTS = 150
const productFooterLabel = 'Scan to start'
const eventFooterLabel = 'Scan to RSVP'
const cameraInstructionLabel = 'Point your camera here'

export function derivePosterTranscript(
  input: PosterTranscriptInput,
  {
    locale,
    includeCompositedFooter,
    pageIndex = 0,
  }: PosterTranscriptOptions,
): PosterTranscript {
  const blocks: PosterTranscriptBlock[] = []
  const seen = new Set<string>()
  const add = (source: PosterTranscriptSource, value: unknown) => {
    const text = normalizedText(value)
    if (!text || seen.has(text)) return
    seen.add(text)
    blocks.push({ source, text })
  }
  const includesQrBand = transcriptIncludesQrBand(input.poster_format)

  if (input.scenario === 'event') {
    addEventArtworkBlocks(input, add, includesQrBand)
    if (includeCompositedFooter && includesQrBand) {
      addEventFooterBlocks(input, add)
    }
  } else {
    addProductArtworkBlocks(input, add, pageIndex)
    if (includeCompositedFooter && includesQrBand) {
      const spec = recordOf(input.poster_spec)
      add(
        'composited-footer',
        normalizedText(spec.qr_label) || productFooterLabel,
      )
      add('composited-footer', cameraInstructionLabel)
    }
  }

  const productName = normalizedText(input.product_name)
  const shortAlt = deriveShortAlt(locale, productName, blocks)

  return {
    shortAlt,
    blocks,
    plainText: blocks.map((block) => block.text).join('\n\n'),
  }
}

function transcriptIncludesQrBand(posterFormat: unknown): boolean {
  try {
    return hasPosterQrBand(getPosterSize(posterFormat))
  } catch (error) {
    if (error instanceof RangeError) return false
    throw error
  }
}

function addProductArtworkBlocks(
  input: PosterTranscriptInput,
  add: (source: PosterTranscriptSource, value: unknown) => void,
  pageIndex: number,
) {
  const redNoteRenderState = resolveRedNoteRenderState(input)
  if (redNoteRenderState !== 'legacy') {
    if (redNoteRenderState === 'invalid') {
      add('campaign', input.product_name)
      return
    }
    const pages = redNoteRenderState.plan.pages
    const page = pages[clampRedNotePageIndex(pageIndex, pages.length)]
    if (page.kind === 'cover') {
      add('poster-content', page.title)
      add('poster-content', page.subtitle)
    } else {
      add('poster-content', page.heading)
      for (const block of page.blocks) add('poster-content', block)
    }
    return
  }

  const layoutBlocks = input.poster_layout
    ? groupZonesByBand(input.poster_layout)
        .flatMap((group) => group.zones)
        .map((zone) => normalizedText(zone.content))
        .filter(Boolean)
    : []

  if (layoutBlocks.length > 0) {
    for (const text of layoutBlocks) add('poster-layout', text)
    return
  }

  const content = recordOf(input.poster_content)
  const contentBlocks = [
    content.headline,
    content.what_it_does,
    ...stringArray(content.how_it_works),
    ...stringArray(content.why_use_it),
    ...stringArray(content.features),
    content.cta,
  ]
  if (contentBlocks.some((value) => normalizedText(value))) {
    add('campaign', input.product_name)
    for (const value of contentBlocks) add('poster-content', value)
    return
  }

  const copy = recordOf(input.poster_copy)
  const copyBlocks = [
    copy.hook,
    copy.what_it_does,
    ...stringArray(copy.features),
    copy.cta,
  ]
  if (copyBlocks.some((value) => normalizedText(value))) {
    add('campaign', input.product_name)
    for (const value of copyBlocks) add('poster-copy', value)
    return
  }

  add('campaign', input.product_name)
  add('campaign', input.tagline)
}

function addEventArtworkBlocks(
  input: PosterTranscriptInput,
  add: (source: PosterTranscriptSource, value: unknown) => void,
  includesQrBand: boolean,
) {
  const spec = recordOf(input.poster_spec)
  add('poster-spec', spec.title || input.product_name)
  add('poster-spec', spec.hook)
  add('poster-spec', spec.host_line)

  if (!includesQrBand) {
    add('poster-spec', spec.date_line)
    add('poster-spec', spec.time_line)
    add('poster-spec', spec.location_line)
  }
}

function addEventFooterBlocks(
  input: PosterTranscriptInput,
  add: (source: PosterTranscriptSource, value: unknown) => void,
) {
  const spec = recordOf(input.poster_spec)
  const dateLine = normalizedText(spec.date_line)
  const timeLine = normalizedText(spec.time_line)

  add(
    'composited-footer',
    normalizedText(spec.rsvp_label) || eventFooterLabel,
  )
  add(
    'composited-footer',
    [dateLine, timeLine].filter(Boolean).join(' · '),
  )
  add('composited-footer', spec.location_line)
  add('composited-footer', spec.host_line)
}

function deriveShortAlt(
  locale: SupportedLocale,
  productName: string,
  blocks: PosterTranscriptBlock[],
): string {
  const copy = blocks
    .map((block) => block.text)
    .filter((text) => text !== productName)
    .join(' · ')

  if (productName && copy) {
    return truncateCodePoints(translate(locale, 'Poster for {name}: {text}', {
      name: productName,
      text: copy,
    }))
  }
  if (productName) {
    return truncateCodePoints(translate(locale, '{name} poster', {
      name: productName,
    }))
  }
  if (copy) {
    return truncateCodePoints(translate(locale, 'Poster: {text}', {
      text: copy,
    }))
  }
  return translate(locale, 'Generated poster')
}

function truncateCodePoints(value: string): string {
  const codePoints = Array.from(value)
  if (codePoints.length <= SHORT_ALT_MAX_CODE_POINTS) return value
  return `${codePoints
    .slice(0, SHORT_ALT_MAX_CODE_POINTS - 1)
    .join('')
    .trimEnd()}…`
}

function normalizedText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/gu, ' ').trim()
    : ''
}

function stringArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
