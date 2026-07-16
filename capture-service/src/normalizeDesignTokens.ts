import type { ColorRole, DesignTokens, PixelEvidence, RawTokens } from './types.js';

type RGB = [number, number, number];

const GENERIC_FONTS = new Set([
  'system-ui',
  '-apple-system',
  'sans-serif',
  'serif',
  'monospace',
  'inherit',
  'blinkmacsystemfont',
]);

export function normalizeDesignTokens(
  raw: RawTokens | null | undefined,
  pixelEvidence?: PixelEvidence,
): DesignTokens | null {
  if (!raw) return null;
  if (!raw.colors?.length && !raw.fonts?.length && !pixelEvidence?.visualPalette.length) return null;

  const fonts = (raw.fonts ?? []).filter((font) => font?.value);
  const headingFamily = firstNonGenericFont(fonts, 'heading');
  const bodyFamily = firstNonGenericFont(fonts, 'body');
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
    : null;

  const assignedColors = assignColors(raw, pixelEvidence);
  const visualColors = pixelEvidence?.visualPalette.map((entry) => entry.color) ?? [];

  return {
    typography: {
      headingFamily,
      bodyFamily: bodyFamily || headingFamily,
      scale: cleanNums(raw.fontSizes, 8),
      weights: cleanNums(raw.fontWeights, 6),
    },
    colors: {
      ...assignedColors,
      palette: dedupeStrings([...visualColors, ...assignedColors.palette]).slice(0, 10),
      ...(pixelEvidence?.visualPalette.length
        ? { visualPalette: pixelEvidence.visualPalette }
        : {}),
      ...(pixelEvidence?.theme ? { theme: pixelEvidence.theme } : {}),
    },
    radii: cleanNums(raw.radii, 5),
    shadows: (raw.shadows ?? []).filter((shadow) => shadow && shadow !== 'none').slice(0, 4),
    spacing: cleanNums(raw.spacing, 6),
    button,
    fontLinks: [...new Set((raw.fontLinks ?? []).filter(Boolean))].slice(0, 8),
  };
}

function firstNonGenericFont(
  fonts: Array<{ value: string; role: string }>,
  role: string,
): string {
  const inRole = fonts.filter((font) => font.role === role && font.value);
  const named = inRole.find((font) => !GENERIC_FONTS.has(font.value.toLowerCase()));
  return (named ?? inRole[0])?.value ?? '';
}

function assignColors(
  raw: RawTokens,
  pixelEvidence?: PixelEvidence,
): DesignTokens['colors'] {
  const entries = (raw.colors ?? [])
    .map((color) => ({
      rgb: parseColor(color.value),
      count: color.count ?? 1,
      role: color.role ?? 'other',
    }))
    .filter((color): color is { rgb: RGB; count: number; role: ColorRole } => color.rgb !== null);

  const palette = dedupeHex(entries.map((entry) => entry.rgb));
  const backgrounds = entries.filter((entry) => entry.role === 'bg');
  const theme = pixelEvidence?.theme ?? 'mixed';
  const bg = pickBy(
    backgrounds.length ? backgrounds : entries,
    (entry) => {
      const luminance = relativeLuminance(entry.rgb);
      const usage = Math.log2(entry.count + 2);
      if (theme === 'dark') return (1 - luminance) * usage;
      if (theme === 'light') return luminance * usage;
      return usage;
    },
  ) ?? [255, 255, 255];
  const textColors = entries.filter((entry) => entry.role === 'text');
  const text = pickBy(
    textColors.length ? textColors : entries,
    (entry) => {
      const luminance = relativeLuminance(entry.rgb);
      const usage = Math.log2(entry.count + 2);
      if (theme === 'dark') return luminance * usage;
      if (theme === 'light') return (1 - luminance) * usage;
      return Math.abs(luminance - relativeLuminance(bg)) * usage;
    },
  ) ?? [17, 24, 39];
  const brandColors = entries.filter((entry) =>
    entry.role === 'button-bg' || entry.role === 'link' || entry.role === 'border'
  );
  const primary = pickBy(
    brandColors.length ? brandColors : entries,
    (entry) => (vividness(entry.rgb) + 0.15) * Math.log2(entry.count + 2),
  ) ?? [31, 41, 55];
  const visualEntries = (pixelEvidence?.visualPalette ?? [])
    .map((entry) => ({
      rgb: parseColor(entry.color),
      count: Math.max(1, Math.round(entry.proportion * 100_000)),
      role: 'other' as ColorRole,
    }))
    .filter((entry): entry is { rgb: RGB; count: number; role: ColorRole } => entry.rgb !== null);
  const accent = pickBy(
    [...entries, ...visualEntries],
    (entry) => vividness(entry.rgb),
  ) ?? primary;

  return {
    bg: toHex(bg),
    text: toHex(text),
    primary: toHex(primary),
    accent: toHex(accent),
    palette,
  };
}

function parseColor(input: string | undefined | null): RGB | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  const functionMatch = /^rgba?\(([^)]+)\)$/.exec(value);
  if (functionMatch) {
    const parts = functionMatch[1].split(',').map((part) => part.trim());
    if (parts.length < 3) return null;
    const [r, g, b] = parts.slice(0, 3).map(Number);
    const alpha = parts.length >= 4 ? Number(parts[3]) : 1;
    if (![r, g, b].every(Number.isFinite) || (Number.isFinite(alpha) && alpha < 0.05)) return null;
    return [clamp255(r), clamp255(g), clamp255(b)];
  }

  let hex = value.replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map((character) => character + character).join('');
  if (!/^[0-9a-f]{6}$/.test(hex)) return null;
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function relativeLuminance(rgb: RGB): number {
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
}

function vividness(rgb: RGB): number {
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const luminance = relativeLuminance(rgb);
  return saturation * (luminance > 0.18 && luminance < 0.9 ? 1 : 0.25);
}

function pickBy<T extends { rgb: RGB }>(entries: T[], score: (entry: T) => number): RGB | null {
  let best: RGB | null = null;
  let bestScore = -Infinity;
  for (const entry of entries) {
    const value = score(entry);
    if (value > bestScore) {
      best = entry.rgb;
      bestScore = value;
    }
  }
  return best;
}

function dedupeHex(values: RGB[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const hex = toHex(value);
    if (!seen.has(hex)) {
      seen.add(hex);
      output.push(hex);
    }
    if (output.length >= 10) break;
  }
  return output;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizeHex(value: string | undefined): string | null {
  const rgb = parseColor(value);
  return rgb ? toHex(rgb) : null;
}

function toHex(rgb: RGB): string {
  return `#${rgb.map((channel) => clamp255(channel).toString(16).padStart(2, '0')).join('')}`;
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function cleanNums(values: number[] | undefined, limit: number): number[] {
  return [...new Set(
    (values ?? [])
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.round(value)),
  )].sort((a, b) => a - b).slice(0, limit);
}

function numOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.round(value as number) : fallback;
}
