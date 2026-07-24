import {
  getPosterMatteX,
  getPosterQrBandGeometry,
  getPosterSize,
  type PosterSizeSlug,
} from '../lib/posterSize'

export type FormatSampleOrientation = 'portrait' | 'landscape' | 'square'

export interface FormatSampleGeometry {
  readonly orientation: FormatSampleOrientation
  readonly qrBandMode: 'scaled' | 'none'
  readonly sheetAspectRatio: string
  readonly artworkWidthPct: number
  readonly artworkHeightPct: number
  readonly matteXPct: number
  readonly marginYPct: number
  readonly gapPct: number
  readonly footerHeightPct: number
  readonly qrSizePct: number
}

function percentage(value: number, total: number): number {
  return (value / total) * 100
}

export function getFormatSampleGeometry(
  slug: PosterSizeSlug,
): Readonly<FormatSampleGeometry> {
  const size = getPosterSize(slug)
  const qrBand = getPosterQrBandGeometry(size)
  const orientation = size.artwork.width === size.artwork.height
    ? 'square'
    : size.artwork.width > size.artwork.height
      ? 'landscape'
      : 'portrait'

  return {
    orientation,
    qrBandMode: size.qrBand.mode,
    sheetAspectRatio: `${size.sheet.width} / ${size.sheet.height}`,
    artworkWidthPct: percentage(size.artwork.width, size.sheet.width),
    artworkHeightPct: percentage(size.artwork.height, size.sheet.height),
    matteXPct: percentage(getPosterMatteX(size), size.sheet.width),
    marginYPct: percentage(qrBand.sheetMarginY, size.sheet.height),
    gapPct: percentage(qrBand.gap, size.sheet.height),
    footerHeightPct: percentage(qrBand.footerHeight, size.sheet.height),
    qrSizePct: percentage(qrBand.qrSize, size.artwork.width),
  }
}
