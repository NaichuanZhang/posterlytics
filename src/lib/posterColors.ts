import type { StyleProfile } from './types'

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

// Parse #rgb / #rrggbb into [r,g,b] (0-255), or null.
function parseHex(hex: string | undefined): [number, number, number] | null {
  if (!hex) return null
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

// Saturation-ish + not-too-dark/light score: how usable a hue is as a vivid accent.
function vividness(rgb: [number, number, number]): number {
  const [r, g, b] = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const sat = max === 0 ? 0 : (max - min) / max
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  // Penalize near-black and near-white; reward saturation.
  const lumOk = lum > 0.18 && lum < 0.9 ? 1 : 0.25
  return sat * lumOk
}

function lighten(rgb: [number, number, number], amt: number): string {
  const [r, g, b] = rgb.map((c) => Math.round(c + (255 - c) * amt)) as [number, number, number]
  return `rgb(${r}, ${g}, ${b})`
}

export function posterColors(style: StyleProfile | null): PosterColors {
  const palette = style?.palette
  const accentRgb = parseHex(palette?.accent)
  const primaryRgb = parseHex(palette?.primary)

  // Pick the more vivid of accent/primary as the headline accent.
  const candidates = [accentRgb, primaryRgb].filter(Boolean) as Array<[number, number, number]>
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
