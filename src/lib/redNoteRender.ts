import { parseColor, toHex, type RGB } from './colorUtils'
import {
  getRedNotePageComposition,
  isRedNotePostFormat,
  parseRedNotePostPlan,
  type RedNoteContentPage,
  type RedNoteCoverPage,
  type RedNotePostPlan,
} from './redNotePost'
import type { PosterLayout } from './types'

export const REDNOTE_BACKGROUND_RENDER_MODE = 'rednote-background-v1' as const

export interface RedNoteRenderInput {
  use_case?: unknown
  poster_format?: unknown
  poster_layout?: unknown
  poster_content?: unknown
}

export type RedNoteRenderState =
  | 'legacy'
  | 'invalid'
  | {
      mode: 'composite'
      plan: RedNotePostPlan
    }

export interface RedNoteCoverRenderModel {
  kind: 'cover'
  page: RedNoteCoverPage
  composition: ReturnType<typeof getRedNotePageComposition>
  titleSize: number
  subtitleSize: number
  pageMarker: string
}

export interface RedNoteContentRenderModel {
  kind: 'content'
  page: RedNoteContentPage
  composition: ReturnType<typeof getRedNotePageComposition>
  headingSize: number
  bodySize: number
  pageMarker: string
}

export type RedNotePageRenderModel =
  | RedNoteCoverRenderModel
  | RedNoteContentRenderModel

export interface RedNoteRenderPalette {
  background: string
  panel: string
  text: string
  accent: string
  coverText: string
  coverScrim: string
}

const DARK_COVER_TEXT = '#111111' as const
const LIGHT_COVER_TEXT = '#ffffff' as const
const COVER_TEXT_MINIMUM_CONTRAST = 4.5
const COVER_SCRIM_MID_STOP = 34
const COVER_SCRIM_TEXT_BAND_STOP = 50
const COVER_SCRIM_END_STOP = 100

export function resolveRedNoteRenderState(
  input: RedNoteRenderInput,
): RedNoteRenderState {
  const layout = recordOf(input.poster_layout)
  if (layout.render_mode !== REDNOTE_BACKGROUND_RENDER_MODE) return 'legacy'
  if (
    input.use_case !== 'rednote_post'
    || !isRedNotePostFormat(input.poster_format)
  ) {
    return 'invalid'
  }

  const content = recordOf(input.poster_content)
  const plan = parseRedNotePostPlan(content.rednote_post)
  return plan ? { mode: 'composite', plan } : 'invalid'
}

export function clampRedNotePageIndex(
  requested: number,
  pageCount: number,
): number {
  if (!Number.isInteger(pageCount) || pageCount <= 0) return 0
  if (!Number.isInteger(requested)) return 0
  return Math.min(Math.max(requested, 0), pageCount - 1)
}

export function getRedNotePageRenderModel(
  plan: RedNotePostPlan,
  pageIndex: number,
): RedNotePageRenderModel {
  const validated = parseRedNotePostPlan(plan)
  if (!validated) throw new RangeError('Invalid RedNote post plan.')
  const page = validated.pages[pageIndex]
  if (!page) throw new RangeError('RedNote page index is outside the post.')
  const composition = getRedNotePageComposition(
    page,
    pageIndex,
    validated.pages.length,
  )
  const pageMarker = `${String(pageIndex + 1).padStart(2, '0')} / ${
    String(validated.pages.length).padStart(2, '0')
  }`

  return page.kind === 'cover'
    ? {
        kind: 'cover',
        page,
        composition,
        titleSize: coverTitleSize(page.title),
        subtitleSize: coverSubtitleSize(page.subtitle ?? ''),
        pageMarker,
      }
    : {
        kind: 'content',
        page,
        composition,
        headingSize: contentHeadingSize(page.heading),
        bodySize: contentBodySize(page.blocks),
        pageMarker,
      }
}

export function resolveRedNoteCoverContrast(
  background: string,
): {
  text: typeof DARK_COVER_TEXT | typeof LIGHT_COVER_TEXT
  scrim: RGB
  textBandAlpha: number
} {
  const backgroundRgb = parseColor(
    normalizedColor(background, '#f4f5f1'),
  ) ?? [244, 245, 241]
  const darkText: RGB = [17, 17, 17]
  const lightText: RGB = [255, 255, 255]
  const text = contrastRatio(darkText, backgroundRgb)
      >= contrastRatio(lightText, backgroundRgb)
    ? DARK_COVER_TEXT
    : LIGHT_COVER_TEXT
  const textRgb = text === LIGHT_COVER_TEXT ? lightText : darkText
  const scrim: RGB = text === LIGHT_COVER_TEXT
    ? [0, 0, 0]
    : [255, 255, 255]
  // The opposite extreme bounds contrast for every possible underlying pixel.
  const adversePixel: RGB = text === LIGHT_COVER_TEXT
    ? [255, 255, 255]
    : [0, 0, 0]
  const requiredAlpha = minimumScrimAlpha(
    textRgb,
    scrim,
    [backgroundRgb, adversePixel],
  )
  const legacyAlpha = legacyCoverScrimAlpha(text)
  const legacyTextBandAlpha = legacyAlpha.mid
    + (legacyAlpha.end - legacyAlpha.mid)
      * (
        (COVER_SCRIM_TEXT_BAND_STOP - COVER_SCRIM_MID_STOP)
        / (COVER_SCRIM_END_STOP - COVER_SCRIM_MID_STOP)
      )

  return {
    text,
    scrim,
    textBandAlpha: Math.max(requiredAlpha, legacyTextBandAlpha),
  }
}

export function resolveRedNotePalette(
  layout: PosterLayout | null | undefined,
): RedNoteRenderPalette {
  const roles = layout?.palette_roles
  const background = normalizedColor(roles?.bg, '#f4f5f1')
  const panel = normalizedColor(roles?.surface, background)
  const text = contrastCheckedColor(roles?.text, panel, '#111111', '#ffffff')
  const accent = contrastCheckedColor(
    roles?.accent ?? roles?.primary,
    panel,
    text,
    text,
    3,
  )
  const cover = resolveRedNoteCoverContrast(background)
  const scrimChannels = cover.scrim.join(',')
  const legacyAlpha = legacyCoverScrimAlpha(cover.text)
  const endAlpha = Math.max(legacyAlpha.end, cover.textBandAlpha)

  return {
    background,
    panel,
    text,
    accent,
    coverText: cover.text,
    coverScrim:
      `linear-gradient(180deg, rgba(${scrimChannels},0) 0%, `
      + `rgba(${scrimChannels},${legacyAlpha.mid}) ${COVER_SCRIM_MID_STOP}%, `
      + `rgba(${scrimChannels},${cover.textBandAlpha}) ${COVER_SCRIM_TEXT_BAND_STOP}%, `
      + `rgba(${scrimChannels},${endAlpha}) ${COVER_SCRIM_END_STOP}%)`,
  }
}

export function contrastCheckedColor(
  preferred: unknown,
  background: unknown,
  darkFallback = '#111111',
  lightFallback = '#ffffff',
  minimumRatio = 4.5,
): string {
  const backgroundRgb = parseColor(
    typeof background === 'string' ? background : null,
  ) ?? [255, 255, 255]
  const preferredRgb = parseColor(
    typeof preferred === 'string' ? preferred : null,
  )
  if (
    preferredRgb
    && contrastRatio(preferredRgb, backgroundRgb) >= minimumRatio
  ) {
    return toHex(preferredRgb)
  }

  const dark = parseColor(darkFallback) ?? [17, 17, 17]
  const light = parseColor(lightFallback) ?? [255, 255, 255]
  return contrastRatio(dark, backgroundRgb) >= contrastRatio(light, backgroundRgb)
    ? toHex(dark)
    : toHex(light)
}

export function contrastRatio(foreground: RGB, background: RGB): number {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

function minimumScrimAlpha(
  text: RGB,
  scrim: RGB,
  backgroundPixels: readonly RGB[],
): number {
  for (let percent = 0; percent <= 100; percent += 1) {
    const alpha = percent / 100
    const allPixelsPass = backgroundPixels.every((pixel) =>
      contrastRatio(text, compositeScrim(scrim, pixel, alpha))
        >= COVER_TEXT_MINIMUM_CONTRAST
    )
    if (allPixelsPass) return alpha
  }
  return 1
}

function legacyCoverScrimAlpha(
  text: typeof DARK_COVER_TEXT | typeof LIGHT_COVER_TEXT,
): { mid: number; end: number } {
  return text === LIGHT_COVER_TEXT
    ? { mid: 0.22, end: 0.78 }
    : { mid: 0.3, end: 0.9 }
}

function compositeScrim(scrim: RGB, pixel: RGB, alpha: number): RGB {
  return pixel.map((channel, index) =>
    scrim[index] * alpha + channel * (1 - alpha)
  ) as RGB
}

export function redNoteCodePointLength(value: string): number {
  return Array.from(value).length
}

function coverTitleSize(value: string): number {
  const length = redNoteCodePointLength(value)
  if (length <= 12) return 132
  if (length <= 22) return 108
  if (length <= 34) return 88
  return 70
}

function coverSubtitleSize(value: string): number {
  const length = redNoteCodePointLength(value)
  if (length <= 32) return 48
  if (length <= 64) return 40
  return 34
}

function contentHeadingSize(value: string): number {
  const length = redNoteCodePointLength(value)
  if (length <= 18) return 72
  if (length <= 36) return 60
  return 48
}

function contentBodySize(blocks: readonly string[]): number {
  const longest = Math.max(0, ...blocks.map(redNoteCodePointLength))
  const total = blocks.reduce(
    (sum, block) => sum + redNoteCodePointLength(block),
    0,
  )
  if (longest <= 48 && total <= 120) return 40
  if (longest <= 96 && total <= 260) return 34
  return 26
}

function normalizedColor(value: unknown, fallback: string): string {
  const parsed = parseColor(typeof value === 'string' ? value : null)
  return parsed ? toHex(parsed) : fallback
}

function luminance(rgb: RGB): number {
  const channels = rgb.map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return (
    0.2126 * channels[0]
    + 0.7152 * channels[1]
    + 0.0722 * channels[2]
  )
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
