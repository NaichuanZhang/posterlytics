type Rgb = readonly [number, number, number];
type Oklab = readonly [number, number, number];

interface ColorAnchor {
  name: string;
  hex: string;
}

// Ordered deliberately: equal-distance matches keep the earlier, more general name.
const COLOR_ANCHORS: readonly ColorAnchor[] = [
  { name: 'black', hex: '#000000' },
  { name: 'charcoal', hex: '#1f2937' },
  { name: 'slate gray', hex: '#475569' },
  { name: 'gray', hex: '#6b7280' },
  { name: 'silver', hex: '#c0c0c0' },
  { name: 'white', hex: '#ffffff' },
  { name: 'cream', hex: '#fff7ed' },
  { name: 'beige', hex: '#d6c7a1' },
  { name: 'tan', hex: '#b08968' },
  { name: 'brown', hex: '#7c2d12' },
  { name: 'maroon', hex: '#7f1d1d' },
  { name: 'red', hex: '#dc2626' },
  { name: 'scarlet', hex: '#f43f5e' },
  { name: 'coral', hex: '#ff6b6b' },
  { name: 'salmon', hex: '#fa8072' },
  { name: 'peach', hex: '#fdba74' },
  { name: 'orange', hex: '#f97316' },
  { name: 'amber', hex: '#f59e0b' },
  { name: 'gold', hex: '#d4a017' },
  { name: 'yellow', hex: '#facc15' },
  { name: 'lime', hex: '#84cc16' },
  { name: 'olive', hex: '#6b8e23' },
  { name: 'green', hex: '#16a34a' },
  { name: 'forest green', hex: '#166534' },
  { name: 'emerald', hex: '#059669' },
  { name: 'mint', hex: '#6ee7b7' },
  { name: 'teal', hex: '#0d9488' },
  { name: 'turquoise', hex: '#2dd4bf' },
  { name: 'cyan', hex: '#06b6d4' },
  { name: 'sky blue', hex: '#0ea5e9' },
  { name: 'blue', hex: '#2563eb' },
  { name: 'royal blue', hex: '#1d4ed8' },
  { name: 'navy', hex: '#1e3a8a' },
  { name: 'indigo', hex: '#4f46e5' },
  { name: 'violet', hex: '#7c3aed' },
  { name: 'purple', hex: '#9333ea' },
  { name: 'plum', hex: '#7e22ce' },
  { name: 'lavender', hex: '#c4b5fd' },
  { name: 'magenta', hex: '#db2777' },
  { name: 'pink', hex: '#ec4899' },
  { name: 'rose', hex: '#e11d48' },
] as const;

const ANCHOR_LABS = COLOR_ANCHORS.map((anchor) => ({
  name: anchor.name,
  lab: rgbToOklab(parseHex(anchor.hex)!),
}));

export function colorNameForHex(value: unknown, fallback: string): string {
  const rgb = parseHex(value);
  if (!rgb) return fallback;

  const lab = rgbToOklab(rgb);
  let nearest = ANCHOR_LABS[0];
  let nearestDistance = squaredDistance(lab, nearest.lab);
  for (let index = 1; index < ANCHOR_LABS.length; index += 1) {
    const candidate = ANCHOR_LABS[index];
    const distance = squaredDistance(lab, candidate.lab);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest.name;
}

// Match the longest CSS hex forms first so an alpha suffix is consumed, not leaked.
const PAINTER_HEX =
  /(^|[^\p{L}\p{N}_])#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})(?![\p{L}\p{N}_])/giu;

export function replacePainterHexColors(text: string): string {
  return text.replace(PAINTER_HEX, (_match, prefix: string, digits: string) => {
    const opaqueHex = digits.length === 8 ? digits.slice(0, 6) : digits;
    return `${prefix}${colorNameForHex(`#${opaqueHex}`, 'source-matched color')}`;
  });
}

function parseHex(value: unknown): Rgb | null {
  if (typeof value !== 'string') return null;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const expanded = match[1].length === 3
    ? [...match[1]].map((digit) => `${digit}${digit}`).join('')
    : match[1];
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

function rgbToOklab([red, green, blue]: Rgb): Oklab {
  const r = srgbToLinear(red / 255);
  const g = srgbToLinear(green / 255);
  const b = srgbToLinear(blue / 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function srgbToLinear(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function squaredDistance(left: Oklab, right: Oklab): number {
  return (
    (left[0] - right[0]) ** 2 +
    (left[1] - right[1]) ** 2 +
    (left[2] - right[2]) ** 2
  );
}
