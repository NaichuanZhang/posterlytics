import type { LayoutBand, PosterLayout, PosterLayoutZone } from './types'

// Pure helpers for the designer-mode layout WIREFRAME preview. These mirror the
// band→vertical-position mapping that `compileLayoutPrompt` (functions/_shared.ts)
// bakes into the image prompt, so the preview matches what `hero` will paint:
//   top   0–12%   upper 12–40%   mid 40–60%   lower 60–74%
// and the bottom ~26% is reserved for the QR band composited by AiPoster.
//
// Kept separate from the JSX (and unit-tested) so the geometry stays a single
// source of truth.

// Ordered top→lower, matching LAYOUT_BANDS in functions/_shared.ts.
export const LAYOUT_BAND_ORDER: LayoutBand[] = ['top', 'upper', 'mid', 'lower']

export interface BandRow {
  band: LayoutBand | 'reserved'
  label: string
  heightPct: number // share of the native 1620px height
}

// The content bands sum to 74; the synthetic reserved row owns the bottom 26%
// (where AiPoster composites the real QR band). Sums to 100.
export const BAND_GEOMETRY: BandRow[] = [
  { band: 'top', label: 'TOP', heightPct: 12 },
  { band: 'upper', label: 'UPPER', heightPct: 28 },
  { band: 'mid', label: 'MIDDLE', heightPct: 20 },
  { band: 'lower', label: 'LOWER', heightPct: 14 },
  { band: 'reserved', label: 'QR BAND', heightPct: 26 },
]

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
