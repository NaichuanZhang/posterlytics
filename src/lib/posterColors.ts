import type { StyleProfile } from './types'
import { parseColor, vividness, lighten, type RGB } from './colorUtils'

// Derives a poster color scheme from the analyzed brand palette. Both HTML poster
// templates are rendered deterministically (no AI image), so the accent here is
// what actually paints the headline emphasis, dividers, icons, bars, and glow.
//
// The analyzer returns { primary, bg, text, accent }. We want a VIVID accent for
// emphasis — many brands' primary is near-black (e.g. #000), which reads as no
// accent at all — so we pick the most saturated/!grayscale of accent/primary and
// fall back to a tasteful default when the brand is monochrome.

export interface PosterColors {
  accent: string // vivid brand color: headline emphasis, icons, bars, glow
  accent2: string // secondary for gradient bar ends
  ink: string // near-black for dark zone + dark text
  paper: string // light zone background
  paper2: string // light zone gradient end
  textLight: string // body text on light zone
  textDark: string // body text on dark zone
}

const DEFAULT_ACCENT = '#10b981' // emerald
const DEFAULT_ACCENT2 = '#93c5fd' // signal blue

export function posterColors(style: StyleProfile | null): PosterColors {
  const palette = style?.palette
  const accentRgb = parseColor(palette?.accent)
  const primaryRgb = parseColor(palette?.primary)

  // Pick the more vivid of accent/primary as the headline accent.
  const candidates = [accentRgb, primaryRgb].filter(Boolean) as Array<RGB>
  let accent = DEFAULT_ACCENT
  let accentSecondary = DEFAULT_ACCENT2
  if (candidates.length) {
    const best = candidates.reduce((a, b) => (vividness(b) > vividness(a) ? b : a))
    // Only use it if it's actually colorful; monochrome brands keep the default.
    if (vividness(best) > 0.12) {
      accent = `rgb(${best[0]}, ${best[1]}, ${best[2]})`
      // Secondary = a lighter tint of the accent for gradient bar ends.
      accentSecondary = lighten(best, 0.4)
    }
  }

  return {
    accent,
    accent2: accentSecondary,
    ink: '#0b0c0b',
    paper: '#f4f5f1',
    paper2: '#e6e8e2',
    textLight: '#2b2b2b',
    textDark: '#e8e8e8',
  }
}
