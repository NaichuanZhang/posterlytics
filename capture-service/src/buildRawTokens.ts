// Pure aggregation: ElementSample[] -> RawTokens.
//
// No DOM, no Playwright, no I/O — just data in, data out. This is the unit-
// tested seam of the capture container. The browser collects raw per-element
// readings; this file ranks/dedupes them by usage so the response stays small.

import type {
  ElementSample,
  RawTokens,
  ColorRole,
  FontRole,
} from './types.js';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

// --- small helpers -------------------------------------------------------

// Round to a sensible bucket so near-identical values collapse together.
function bucket(n: number, step: number): number {
  return Math.round(n / step) * step;
}

// Frequency-rank string keys, weighting by an accumulated score, returning the
// top `limit` entries with their summed count.
function rankCounts(
  entries: Array<{ key: string; weight: number }>,
  limit: number,
): Array<{ value: string; count: number }> {
  const totals = new Map<string, number>();
  for (const { key, weight } of entries) {
    if (!key) continue;
    totals.set(key, (totals.get(key) ?? 0) + weight);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count: Math.round(count) }));
}

// Distinct numeric scale: bucket, count, keep the most-used, return sorted asc.
function numericScale(values: number[], step: number, limit: number): number[] {
  const counts = new Map<number, number>();
  for (const v of values) {
    if (!Number.isFinite(v) || v <= 0) continue;
    const b = bucket(v, step);
    if (b <= 0) continue;
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([v]) => v)
    .sort((a, b) => a - b);
}

// Normalize a CSS color string to a stable key; drop fully-transparent.
function colorKey(c: string): string | null {
  const s = (c || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s || s === TRANSPARENT || s === 'transparent') return null;
  // Drop near-zero-alpha rgba(...) — not a real visible color.
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) {
    const parts = m[1].split(',').map((p) => p.trim());
    if (parts.length === 4 && Number(parts[3]) < 0.05) return null;
  }
  return s;
}

// --- main ----------------------------------------------------------------

export function buildRawTokens(
  samples: ElementSample[],
  fontLinks: string[],
  meta: RawTokens['meta'],
): RawTokens {
  // Fonts: rank by total area (dominant fonts win), split heading vs body.
  const fontEntries: Array<{ key: string; weight: number; role: FontRole }> = [];
  const sizeVals: number[] = [];
  const weightVals: number[] = [];
  const radiusVals: number[] = [];
  const spacingVals: number[] = [];
  const shadowSet = new Map<string, number>();

  const colorEntries: Array<{ key: string; weight: number; role: ColorRole }> = [];

  for (const s of samples) {
    const fam = primaryFamily(s.fontFamily);
    if (fam) fontEntries.push({ key: fam, weight: Math.max(1, s.area), role: s.role });

    if (s.fontSize > 0) sizeVals.push(s.fontSize);
    if (s.fontWeight > 0) weightVals.push(s.fontWeight);
    if (s.borderRadius > 0) radiusVals.push(s.borderRadius);
    if (s.paddingX > 0) spacingVals.push(s.paddingX);
    if (s.paddingY > 0) spacingVals.push(s.paddingY);
    if (s.boxShadow && s.boxShadow !== 'none') {
      shadowSet.set(s.boxShadow, (shadowSet.get(s.boxShadow) ?? 0) + s.area);
    }

    // Color roles. Text color is weighted by area; bg by area; links/buttons tagged.
    const fg = colorKey(s.color);
    if (fg) colorEntries.push({ key: fg, weight: s.area, role: s.isLink ? 'link' : 'text' });
    const bg = colorKey(s.backgroundColor);
    if (bg) {
      const role: ColorRole = s.isButton ? 'button-bg' : 'bg';
      colorEntries.push({ key: bg, weight: s.area, role });
    }
    if (s.isButton) {
      const btf = colorKey(s.color);
      if (btf) colorEntries.push({ key: btf, weight: s.area, role: 'button-text' });
    }
  }

  // Rank fonts per role so heading vs body is separable downstream.
  const headingFonts = rankCounts(
    fontEntries.filter((e) => e.role === 'heading').map((e) => ({ key: e.key, weight: e.weight })),
    3,
  ).map((r) => ({ ...r, role: 'heading' as FontRole }));
  const bodyFonts = rankCounts(
    fontEntries.filter((e) => e.role !== 'heading').map((e) => ({ key: e.key, weight: e.weight })),
    3,
  ).map((r) => ({ ...r, role: 'body' as FontRole }));

  // Colors: rank globally but keep role hints; we keep a generous list so the
  // downstream normalizer can pick roles (bg/text/primary/accent).
  const colorTotals = new Map<string, { count: number; role: ColorRole }>();
  for (const e of colorEntries) {
    const cur = colorTotals.get(e.key);
    if (cur) {
      cur.count += e.weight;
      // Prefer the more specific role (button/link) over generic text/bg.
      if (cur.role === 'text' || cur.role === 'bg' || cur.role === 'other') cur.role = e.role;
    } else {
      colorTotals.set(e.key, { count: e.weight, role: e.role });
    }
  }
  const colors = [...colorTotals.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 12)
    .map(([value, v]) => ({ value, count: Math.round(v.count), role: v.role }));

  // Representative button: the largest-area button sample.
  const buttonSample = samples
    .filter((s) => s.isButton)
    .sort((a, b) => b.area - a.area)[0];
  const button = buttonSample
    ? {
        bg: colorKey(buttonSample.backgroundColor) ?? '',
        color: colorKey(buttonSample.color) ?? '',
        radius: Math.round(buttonSample.borderRadius),
        paddingX: Math.round(buttonSample.paddingX),
        paddingY: Math.round(buttonSample.paddingY),
        weight: buttonSample.fontWeight,
        shadow: buttonSample.boxShadow ?? 'none',
      }
    : null;

  return {
    fonts: [...headingFonts, ...bodyFonts],
    fontSizes: numericScale(sizeVals, 1, 8),
    fontWeights: [...new Set(weightVals.map((w) => bucket(w, 100)))].sort((a, b) => a - b),
    colors,
    radii: numericScale(radiusVals, 1, 5),
    shadows: [...shadowSet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s]) => s),
    spacing: numericScale(spacingVals, 4, 6),
    button,
    fontLinks: [...new Set(fontLinks)].slice(0, 8),
    meta,
  };
}

// "Inter, system-ui, sans-serif" -> "Inter". Strips quotes/whitespace.
export function primaryFamily(stack: string): string {
  if (!stack) return '';
  const first = stack.split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? '';
  // Skip generic-only families as the "primary" name.
  const generics = new Set(['system-ui', 'sans-serif', 'serif', 'monospace', '-apple-system', 'inherit']);
  if (generics.has(first.toLowerCase())) return first;
  return first;
}
