// Pure normalization: the capture-service's compact `RawTokens` -> the bounded,
// role-assigned `DesignTokens` the rest of the app consumes. No I/O, no LLM —
// this is the deterministic, unit-testable seam between programmatic capture and
// everything downstream (poster style_profile + the landing agent's inputs).
//
// The CANONICAL copy of this logic also lives inlined in functions/_shared.ts
// (Deno bundle can't import across the boundary — same mirror pattern as QrZone).
// Keep the two in sync; this copy is the one exercised by unit tests.

import type { DesignTokens } from './types'
import { parseColor, toHex, vividness, relativeLuminance, type RGB } from './colorUtils'

// Mirror of the capture-service RawTokens wire shape (kept loose / all-optional
// so a partial or empty capture still normalizes safely).
export interface RawTokens {
  fonts?: Array<{ value: string; count: number; role: string }>
  fontSizes?: number[]
  fontWeights?: number[]
  colors?: Array<{ value: string; count: number; role: string }>
  radii?: number[]
  shadows?: string[]
  spacing?: number[]
  button?: {
    bg?: string
    color?: string
    radius?: number
    paddingX?: number
    paddingY?: number
    weight?: number
    shadow?: string
  } | null
  fontLinks?: string[]
  meta?: unknown
}

const GENERIC_FONTS = new Set([
  'system-ui',
  '-apple-system',
  'sans-serif',
  'serif',
  'monospace',
  'inherit',
  'blinkmacsystemfont',
])

function firstNonGenericFont(fonts: Array<{ value: string; role: string }>, role: string): string {
  const inRole = fonts.filter((f) => f.role === role && f.value)
  const named = inRole.find((f) => !GENERIC_FONTS.has(f.value.toLowerCase()))
  return (named ?? inRole[0])?.value ?? ''
}

// Build the role-assigned color set. We rank candidates by visible-color
// frequency, then assign bg (lightest, most-used), text (darkest, most-used),
// primary (dominant brand color, biased toward button/link roles), accent
// (most vivid).
function assignColors(raw: RawTokens): DesignTokens['colors'] {
  const entries = (raw.colors ?? [])
    .map((c) => ({ rgb: parseColor(c.value), count: c.count ?? 1, role: c.role ?? 'other' }))
    .filter((c): c is { rgb: RGB; count: number; role: string } => c.rgb !== null)

  const palette = dedupeHex(entries.map((e) => e.rgb))

  // bg: prefer explicit bg-role colors, else the lightest frequent color.
  const bgCandidates = entries.filter((e) => e.role === 'bg')
  const bg =
    pickBy(bgCandidates.length ? bgCandidates : entries, (e) => relativeLuminance(e.rgb) * Math.log2(e.count + 2)) ??
    [255, 255, 255]

  // text: prefer text-role colors, else the darkest frequent color.
  const textCandidates = entries.filter((e) => e.role === 'text')
  const text =
    pickBy(textCandidates.length ? textCandidates : entries, (e) => (1 - relativeLuminance(e.rgb)) * Math.log2(e.count + 2)) ??
    [17, 24, 39]

  // primary: dominant brand color — bias toward button/link roles, weight by
  // frequency and vividness; falls back to the most vivid overall.
  const brandCandidates = entries.filter((e) => e.role === 'button-bg' || e.role === 'link' || e.role === 'border')
  const primary =
    pickBy(brandCandidates.length ? brandCandidates : entries, (e) => (vividness(e.rgb) + 0.15) * Math.log2(e.count + 2)) ??
    [31, 41, 55]

  // accent: the single most vivid color anywhere.
  const accent = pickBy(entries, (e) => vividness(e.rgb)) ?? primary

  return {
    bg: toHex(bg),
    text: toHex(text),
    primary: toHex(primary),
    accent: toHex(accent),
    palette,
  }
}

// Argmax over a scoring function; returns the rgb of the best entry or null.
function pickBy<T extends { rgb: RGB }>(entries: T[], score: (e: T) => number): RGB | null {
  let best: RGB | null = null
  let bestScore = -Infinity
  for (const e of entries) {
    const s = score(e)
    if (s > bestScore) {
      bestScore = s
      best = e.rgb
    }
  }
  return best
}

function dedupeHex(rgbs: RGB[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const rgb of rgbs) {
    const hex = toHex(rgb)
    if (!seen.has(hex)) {
      seen.add(hex)
      out.push(hex)
    }
    if (out.length >= 10) break
  }
  return out
}

export function normalizeDesignTokens(raw: RawTokens | null | undefined): DesignTokens | null {
  if (!raw || (!raw.colors?.length && !raw.fonts?.length)) return null

  const fonts = (raw.fonts ?? []).filter((f) => f && f.value)
  const headingFamily = firstNonGenericFont(fonts, 'heading')
  const bodyFamily = firstNonGenericFont(fonts, 'body')

  const button = raw.button
    ? {
        bg: normalizeHex(raw.button.bg) ?? '',
        color: normalizeHex(raw.button.color) ?? '',
        radius: numOr(raw.button.radius, 0),
        paddingX: numOr(raw.button.paddingX, 0),
        paddingY: numOr(raw.button.paddingY, 0),
        weight: numOr(raw.button.weight, 600),
        shadow: raw.button.shadow && raw.button.shadow !== 'none' ? raw.button.shadow : undefined,
      }
    : null

  return {
    typography: {
      headingFamily,
      bodyFamily: bodyFamily || headingFamily,
      scale: cleanNums(raw.fontSizes, 8),
      weights: cleanNums(raw.fontWeights, 6),
    },
    colors: assignColors(raw),
    radii: cleanNums(raw.radii, 5),
    shadows: (raw.shadows ?? []).filter((s) => s && s !== 'none').slice(0, 4),
    spacing: cleanNums(raw.spacing, 6),
    button,
    fontLinks: [...new Set((raw.fontLinks ?? []).filter(Boolean))].slice(0, 8),
  }
}

function normalizeHex(c: string | undefined): string | null {
  const rgb = parseColor(c)
  return rgb ? toHex(rgb) : null
}

function numOr(n: number | undefined, fallback: number): number {
  return Number.isFinite(n) ? Math.round(n as number) : fallback
}

function cleanNums(arr: number[] | undefined, limit: number): number[] {
  return [...new Set((arr ?? []).filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.round(n)))]
    .sort((a, b) => a - b)
    .slice(0, limit)
}
