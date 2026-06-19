// Shared, pure color helpers. Previously this saturation/luminance heuristic was
// duplicated in three places (analyze.extractColors, analyze.isVivid,
// posterColors.vividness). This is the single source of truth.

export type RGB = [number, number, number]

// Parse #rgb / #rrggbb / rgb(...) / rgba(...) into [r,g,b] (0-255), or null.
// Fully-transparent colors (alpha < 0.05) return null.
export function parseColor(input: string | undefined | null): RGB | null {
  if (!input) return null
  const s = input.trim().toLowerCase()

  // rgb()/rgba()
  const fn = /^rgba?\(([^)]+)\)$/.exec(s)
  if (fn) {
    const parts = fn[1].split(',').map((p) => p.trim())
    if (parts.length < 3) return null
    const r = Number(parts[0])
    const g = Number(parts[1])
    const b = Number(parts[2])
    const a = parts.length >= 4 ? Number(parts[3]) : 1
    if (![r, g, b].every((n) => Number.isFinite(n))) return null
    if (Number.isFinite(a) && a < 0.05) return null
    return [clamp255(r), clamp255(g), clamp255(b)]
  }

  // hex
  let h = s.replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

export function toHex(rgb: RGB): string {
  return '#' + rgb.map((c) => clamp255(c).toString(16).padStart(2, '0')).join('')
}

// Saturation × not-too-dark/light: how usable a color is as a vivid accent.
// 0 = grayscale/near-black/near-white, →1 = saturated mid-tone.
export function vividness(rgb: RGB): number {
  const [r, g, b] = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const sat = max === 0 ? 0 : (max - min) / max
  const lum = relativeLuminance(rgb)
  const lumOk = lum > 0.18 && lum < 0.9 ? 1 : 0.25
  return sat * lumOk
}

// Perceptual luminance 0..1 (the same weights used across the codebase).
export function relativeLuminance(rgb: RGB): number {
  const [r, g, b] = rgb
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

// Is this color colorful enough to be an intentional accent?
export function isVivid(input: string | undefined | null): boolean {
  const rgb = parseColor(input)
  return rgb ? vividness(rgb) >= 0.25 : false
}

export function lighten(rgb: RGB, amt: number): string {
  const [r, g, b] = rgb.map((c) => Math.round(c + (255 - c) * amt)) as RGB
  return `rgb(${r}, ${g}, ${b})`
}
