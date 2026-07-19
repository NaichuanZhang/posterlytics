import type { TranslationKey } from '../i18n/messages'

export interface PosterDimensions {
  readonly width: number
  readonly height: number
}

export type PosterQrBand =
  | {
      readonly mode: 'scaled'
      readonly scale: number
    }
  | {
      readonly mode: 'none'
    }

export interface PosterSizeDescriptor<Slug extends string = string> {
  readonly slug: Slug
  readonly label: TranslationKey
  readonly artwork: PosterDimensions
  readonly sheet: PosterDimensions
  readonly providerAspectRatio: string
  readonly export: {
    readonly pixelRatio: number
    readonly filenameSuffix: string
  }
  readonly qrBand: PosterQrBand
}

// Every fixed footer measurement is multiplied by a scaled preset's single
// QR-band scale. Bandless presets resolve every footer measurement to zero.
// The A4 values are the established render and export contract.
export const BASE_QR_BAND_GEOMETRY = {
  sheetMarginY: 24,
  gap: 16,
  footerHeight: 220,
  qrSize: 150,
} as const

const BASE_QR_BAND_TOTAL_HEIGHT =
  BASE_QR_BAND_GEOMETRY.sheetMarginY * 2
  + BASE_QR_BAND_GEOMETRY.gap
  + BASE_QR_BAND_GEOMETRY.footerHeight

function catalogLabel<Key extends TranslationKey>(label: Key): Key {
  return label
}

export const POSTER_SIZES = [
  {
    slug: 'a4_2x3',
    label: catalogLabel('A4 poster (2:3 artwork)'),
    artwork: { width: 980, height: 1470 },
    sheet: { width: 1240, height: 1754 },
    providerAspectRatio: '2:3',
    export: {
      pixelRatio: 2,
      filenameSuffix: 'A4',
    },
    qrBand: {
      mode: 'scaled',
      scale: 1,
    },
  },
  {
    slug: 'rednote_3x4',
    label: catalogLabel('Portrait 3:4 with QR footer'),
    artwork: { width: 960, height: 1280 },
    sheet: { width: 1242, height: 1656 },
    providerAspectRatio: '3:4',
    export: {
      pixelRatio: 1,
      filenameSuffix: 'Portrait-3x4',
    },
    qrBand: {
      mode: 'scaled',
      scale: (1656 - 1280) / BASE_QR_BAND_TOTAL_HEIGHT,
    },
  },
  {
    slug: 'rednote_cover_3x4',
    label: catalogLabel('Portrait 3:4 full bleed'),
    artwork: { width: 1242, height: 1656 },
    sheet: { width: 1242, height: 1656 },
    providerAspectRatio: '3:4',
    export: {
      pixelRatio: 1,
      filenameSuffix: 'FullBleed-3x4',
    },
    qrBand: {
      mode: 'none',
    },
  },
  {
    slug: 'yt_thumb_16x9',
    label: catalogLabel('Landscape 16:9'),
    artwork: { width: 800, height: 450 },
    sheet: { width: 1280, height: 720 },
    providerAspectRatio: '16:9',
    export: {
      pixelRatio: 1,
      filenameSuffix: 'Landscape-16x9',
    },
    qrBand: {
      mode: 'scaled',
      scale: (720 - 450) / BASE_QR_BAND_TOTAL_HEIGHT,
    },
  },
  {
    slug: 'luma_1x1',
    label: catalogLabel('Square 1:1'),
    artwork: { width: 800, height: 800 },
    sheet: { width: 1080, height: 1080 },
    providerAspectRatio: '1:1',
    export: {
      pixelRatio: 1,
      filenameSuffix: 'Square-1x1',
    },
    qrBand: {
      mode: 'scaled',
      scale: (1080 - 800) / BASE_QR_BAND_TOTAL_HEIGHT,
    },
  },
] as const satisfies readonly PosterSizeDescriptor[]

export type PosterSizeSlug = (typeof POSTER_SIZES)[number]['slug']
export type PosterSize = PosterSizeDescriptor<PosterSizeSlug>

export const DEFAULT_POSTER_SIZE_SLUG: PosterSizeSlug = 'a4_2x3'
export const DEFAULT_POSTER_SIZE: PosterSize = POSTER_SIZES[0]

const POSTER_SIZE_BY_SLUG = new Map<string, PosterSize>(
  POSTER_SIZES.map((size) => [size.slug, size]),
)

export function isPosterSizeSlug(value: unknown): value is PosterSizeSlug {
  return typeof value === 'string' && POSTER_SIZE_BY_SLUG.has(value)
}

// Nullish values are legacy rows created before poster_format existed. Any
// present but unsupported value is data corruption and must fail explicitly.
export function getPosterSize(value: unknown): PosterSize {
  if (value === null || value === undefined) return DEFAULT_POSTER_SIZE
  if (!isPosterSizeSlug(value)) {
    throw new RangeError(`Unknown poster size: ${String(value)}`)
  }
  return POSTER_SIZE_BY_SLUG.get(value)!
}

export function getSelectablePosterSizes(
  allowedSlugs: readonly PosterSizeSlug[],
  currentSlug?: PosterSizeSlug,
): PosterSize[] {
  const selectable = new Set<PosterSizeSlug>(allowedSlugs)
  if (currentSlug) selectable.add(currentSlug)
  return POSTER_SIZES.filter((size) => selectable.has(size.slug))
}

export function hasPosterQrBand(
  size: PosterSize,
): size is PosterSize & { readonly qrBand: Extract<PosterQrBand, { mode: 'scaled' }> } {
  return size.qrBand.mode === 'scaled'
}

export function scaleQrBandValue(size: PosterSize, value: number): number {
  return hasPosterQrBand(size) ? value * size.qrBand.scale : 0
}

export function getPosterQrBandGeometry(size: PosterSize) {
  return {
    sheetMarginY: scaleQrBandValue(size, BASE_QR_BAND_GEOMETRY.sheetMarginY),
    gap: scaleQrBandValue(size, BASE_QR_BAND_GEOMETRY.gap),
    footerHeight: scaleQrBandValue(size, BASE_QR_BAND_GEOMETRY.footerHeight),
    qrSize: scaleQrBandValue(size, BASE_QR_BAND_GEOMETRY.qrSize),
  }
}

export function getPosterMatteX(size: PosterSize): number {
  return (size.sheet.width - size.artwork.width) / 2
}

export function getPosterFrameLabel(size: PosterSize): string {
  const orientation = size.artwork.width === size.artwork.height
    ? 'SQUARE'
    : size.artwork.width > size.artwork.height
      ? 'LANDSCAPE'
      : 'PORTRAIT'
  return `${orientation} ${size.providerAspectRatio}`
}

// Compatibility exports for code and tests outside the descriptor-aware render
// path. They are derived from the default descriptor, never independent values.
export const POSTER_WIDTH = DEFAULT_POSTER_SIZE.sheet.width
export const POSTER_HEIGHT = DEFAULT_POSTER_SIZE.sheet.height
export const ARTWORK_WIDTH = DEFAULT_POSTER_SIZE.artwork.width
export const ARTWORK_HEIGHT = DEFAULT_POSTER_SIZE.artwork.height
export const MATTE_X = getPosterMatteX(DEFAULT_POSTER_SIZE)
export const SHEET_MARGIN_Y = getPosterQrBandGeometry(DEFAULT_POSTER_SIZE).sheetMarginY
export const MATTE_GAP = getPosterQrBandGeometry(DEFAULT_POSTER_SIZE).gap
export const FOOTER_H = getPosterQrBandGeometry(DEFAULT_POSTER_SIZE).footerHeight
export const QR_PX = getPosterQrBandGeometry(DEFAULT_POSTER_SIZE).qrSize
