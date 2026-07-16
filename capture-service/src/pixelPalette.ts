import type { PixelEvidence, VisualPaletteColor, VisualTheme } from './types.js';

interface ColorBin {
  count: number;
  r: number;
  g: number;
  b: number;
}

const QUANTIZATION_STEP = 24;
const MERGE_DISTANCE = 42;

export function extractPixelEvidence(
  pixels: Uint8Array,
  channels: number,
  maxColors = 8,
): PixelEvidence {
  if (channels < 3 || pixels.length < channels) {
    return { visualPalette: [], theme: 'mixed' };
  }

  const bins = new Map<string, ColorBin>();
  let validPixels = 0;
  for (let offset = 0; offset + channels - 1 < pixels.length; offset += channels) {
    if (channels >= 4 && pixels[offset + 3] < 32) continue;
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    const key = `${Math.floor(r / QUANTIZATION_STEP)}:${Math.floor(g / QUANTIZATION_STEP)}:${Math.floor(b / QUANTIZATION_STEP)}`;
    const current = bins.get(key);
    if (current) {
      current.count += 1;
      current.r += r;
      current.g += g;
      current.b += b;
    } else {
      bins.set(key, { count: 1, r, g, b });
    }
    validPixels += 1;
  }

  const clusters: ColorBin[] = [];
  const rankedBins = [...bins.values()].sort((a, b) => b.count - a.count);
  for (const bin of rankedBins) {
    const color = averageColor(bin);
    const match = clusters.find((cluster) => colorDistance(color, averageColor(cluster)) <= MERGE_DISTANCE);
    if (match) {
      match.count += bin.count;
      match.r += bin.r;
      match.g += bin.g;
      match.b += bin.b;
    } else {
      clusters.push({ ...bin });
    }
  }

  const visualPalette: VisualPaletteColor[] = clusters
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(1, maxColors))
    .map((cluster) => ({
      color: toHex(averageColor(cluster)),
      proportion: validPixels > 0 ? round(cluster.count / validPixels, 4) : 0,
    }));

  return {
    visualPalette,
    theme: classifyPixelTheme(pixels, channels),
  };
}

export function classifyPixelTheme(pixels: Uint8Array, channels: number): VisualTheme {
  if (channels < 3 || pixels.length < channels) return 'mixed';
  let dark = 0;
  let light = 0;
  let total = 0;
  for (let offset = 0; offset + channels - 1 < pixels.length; offset += channels) {
    if (channels >= 4 && pixels[offset + 3] < 32) continue;
    const luminance = relativeLuminance([pixels[offset], pixels[offset + 1], pixels[offset + 2]]);
    if (luminance <= 0.35) dark += 1;
    if (luminance >= 0.68) light += 1;
    total += 1;
  }
  if (total === 0) return 'mixed';
  if (dark / total >= 0.62) return 'dark';
  if (light / total >= 0.62) return 'light';
  return 'mixed';
}

function averageColor(bin: ColorBin): [number, number, number] {
  return [bin.r / bin.count, bin.g / bin.count, bin.b / bin.count];
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function relativeLuminance(rgb: [number, number, number]): number {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => clamp255(channel).toString(16).padStart(2, '0')).join('')}`;
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
