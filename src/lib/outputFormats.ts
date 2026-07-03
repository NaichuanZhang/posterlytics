// Output-format registry — the single source of truth for the size + QR layout of
// an exported asset. Today the poster is hardcoded 1080×1620 in three coordinated
// places (AiPoster native size + band geometry, Poster preview scale,
// PosterExportButton's toPng width/height). This registry turns those into DATA so
// a differently-sized output (the 1:1 Luma cover, a 9:16 story, a flyer, a share
// card) becomes ONE entry here — not a new render path or a coordinated edit across
// files.
//
// Phase 0 seeds only `poster_2x3` (today's exact poster), so behavior is unchanged.
// Phase 2/3 add `luma_cover_1x1` (layout 'bare_no_qr'), `story_9x16`, etc.

// How the QR (and any logistics text) is placed on an output.
//   'qr_band_bottom' — the poster's dedicated bottom band (portrait). Today's poster.
//   'qr_corner'      — a compact QR card in a corner (for landscape / share cards).
//   'bare_no_qr'     — no QR at all (the on-Luma cover; tracking lives on Luma's page).
export type OutputLayout = 'qr_band_bottom' | 'qr_corner' | 'bare_no_qr'

// A concrete exportable output: native pixel size + how the QR is laid out.
export interface OutputFormat {
  id: string
  label: string
  w: number // native width (px)
  h: number // native height (px)
  layout: OutputLayout
}

// The default poster: portrait 2:3 with the QR in its own bottom band. These are
// the exact dimensions the app has always used, so passing this format anywhere
// reproduces today's output byte-for-byte.
export const POSTER_2x3: OutputFormat = {
  id: 'poster_2x3',
  label: 'Poster (2:3)',
  w: 1080,
  h: 1620,
  layout: 'qr_band_bottom',
}

// The registry. Add a size = add one entry here (+ handle its layout in AiPoster).
export const OUTPUT_FORMATS: Record<string, OutputFormat> = {
  [POSTER_2x3.id]: POSTER_2x3,
}

// Resolve a format id to its descriptor, falling back to the default poster for an
// unknown/absent id so callers never crash on a stale value.
export function getOutputFormat(id: string | null | undefined): OutputFormat {
  return (id && OUTPUT_FORMATS[id]) || POSTER_2x3
}
