import type { LayoutBand, PosterLayout, PosterLayoutZone } from './types'
import type { PosterSize } from './posterSize'

// Pure helpers for the designer-mode layout WIREFRAME preview. These mirror the
// band→vertical-position mapping that `compileLayoutPrompt` (functions/_shared.ts)
// bakes into the image prompt, so the preview matches what `hero` will paint:
//   top   0–12%   upper 12–42%   mid 42–72%   lower 72–100%
// The artwork fills its complete registered frame; the QR footer lives OUTSIDE
// the artwork on the output sheet (AiPoster composites it below), so no band is
// reserved.
//
// Kept separate from the JSX (and unit-tested) so the geometry stays a single
// source of truth.

// Ordered top→lower, matching LAYOUT_BANDS in functions/_shared.ts.
export const LAYOUT_BAND_ORDER: LayoutBand[] = ['top', 'upper', 'mid', 'lower']

export interface BandRow {
  band: LayoutBand
  heightPct: number // share of the artwork height
}

// The four content bands own the complete artwork frame. Sums to 100.
export const BAND_GEOMETRY: BandRow[] = [
  { band: 'top', heightPct: 12 },
  { band: 'upper', heightPct: 30 },
  { band: 'mid', heightPct: 30 },
  { band: 'lower', heightPct: 28 },
]

export function getBandHeight(row: BandRow, posterSize: PosterSize): number {
  return (row.heightPct / 100) * posterSize.artwork.height
}

export interface BandGroup {
  band: LayoutBand
  zones: PosterLayoutZone[]
}

// Group a layout's zones into the four content bands, top→lower, preserving each
// band's input order so multiple zones in one band (e.g. mid = feature grid +
// stat row) stack cleanly. Unknown bands bucket to 'mid' — the same fallback
// normalizePosterLayout uses — so a malformed layout never drops a zone.
export function groupZonesByBand(layout: PosterLayout): BandGroup[] {
  const buckets: Record<LayoutBand, PosterLayoutZone[]> = { top: [], upper: [], mid: [], lower: [] }
  for (const zone of layout.zones ?? []) {
    const band: LayoutBand = LAYOUT_BAND_ORDER.includes(zone.band) ? zone.band : 'mid'
    buckets[band].push(zone)
  }
  return LAYOUT_BAND_ORDER.map((band) => ({ band, zones: buckets[band] }))
}
