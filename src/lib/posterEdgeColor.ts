import { parseColor, toHex, type RGB } from './colorUtils'

export interface ImageDataLike {
  readonly data: ArrayLike<number>
  readonly width: number
  readonly height: number
}

interface ColorBin {
  readonly key: number
  count: number
  red: number
  green: number
  blue: number
}

export interface SampledFooterPalette {
  readonly background: string
  readonly text: string
  readonly secondaryText: string
  readonly accent: string
}

export const EDGE_STRIP_RATIO = 0.03
export const EDGE_COLOR_BIN_SIZE = 32
export const MIN_SECONDARY_TEXT_CONTRAST = 4.5
export const MIN_ACCENT_CONTRAST = 3

const MIN_ALPHA = 128
const LIGHT_TEXT = '#ffffff'
const DARK_TEXT = '#0b0c0b'
const STRICT_DARK_TEXT = '#000000'
const SECONDARY_START_ALPHA = Math.round(0.72 * 255)

export function getBottomEdgeStripHeight(imageHeight: number): number {
  if (!Number.isFinite(imageHeight) || imageHeight <= 0) return 0
  return Math.max(1, Math.ceil(imageHeight * EDGE_STRIP_RATIO))
}

// Select the most common coarse RGB bin, then return the exact integer-rounded
// mean of the source pixels in that bin. Ties prefer the bin nearest the whole
// strip's mean, then the lowest numeric bin key.
export function sampleEdgeColor(imageData: ImageDataLike): string | null {
  const { data, width, height } = imageData
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width <= 0
    || height <= 0
    || data.length < width * height * 4
  ) {
    return null
  }

  const bins = new Map<number, ColorBin>()
  let validPixels = 0
  let totalRed = 0
  let totalGreen = 0
  let totalBlue = 0

  for (let offset = 0; offset < width * height * 4; offset += 4) {
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    const alpha = data[offset + 3]
    if (
      alpha < MIN_ALPHA
      || !isByte(red)
      || !isByte(green)
      || !isByte(blue)
    ) {
      continue
    }

    const key =
      Math.floor(red / EDGE_COLOR_BIN_SIZE) * 64
      + Math.floor(green / EDGE_COLOR_BIN_SIZE) * 8
      + Math.floor(blue / EDGE_COLOR_BIN_SIZE)
    const bin = bins.get(key)
    if (bin) {
      bin.count += 1
      bin.red += red
      bin.green += green
      bin.blue += blue
    } else {
      bins.set(key, {
        key,
        count: 1,
        red,
        green,
        blue,
      })
    }
    validPixels += 1
    totalRed += red
    totalGreen += green
    totalBlue += blue
  }

  if (validPixels === 0) return null

  const stripMean: RGB = [
    Math.round(totalRed / validPixels),
    Math.round(totalGreen / validPixels),
    Math.round(totalBlue / validPixels),
  ]
  let winner: ColorBin | null = null
  let winnerDistance = Number.POSITIVE_INFINITY

  for (const bin of bins.values()) {
    const mean = binMean(bin)
    const distance = squaredDistance(mean, stripMean)
    if (
      !winner
      || bin.count > winner.count
      || (
        bin.count === winner.count
        && (
          distance < winnerDistance
          || (distance === winnerDistance && bin.key < winner.key)
        )
      )
    ) {
      winner = bin
      winnerDistance = distance
    }
  }

  return winner ? toHex(binMean(winner)) : null
}

export function wcagRelativeLuminance(color: string | RGB): number | null {
  const rgb = typeof color === 'string' ? parseColor(color) : color
  if (!rgb) return null
  const [red, green, blue] = rgb.map(linearizeChannel)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function contrastRatio(a: string | RGB, b: string | RGB): number {
  const luminanceA = wcagRelativeLuminance(a)
  const luminanceB = wcagRelativeLuminance(b)
  if (luminanceA === null || luminanceB === null) return 1
  const lighter = Math.max(luminanceA, luminanceB)
  const darker = Math.min(luminanceA, luminanceB)
  return (lighter + 0.05) / (darker + 0.05)
}

export function pickTextColor(background: string): string {
  const lightContrast = contrastRatio(background, LIGHT_TEXT)
  const darkContrast = contrastRatio(background, DARK_TEXT)
  if (lightContrast > darkContrast) {
    return lightContrast >= MIN_SECONDARY_TEXT_CONTRAST
      ? LIGHT_TEXT
      : STRICT_DARK_TEXT
  }

  // #0b0c0b is the established poster ink. Pure black is used only in the
  // narrow crossover range where that near-black misses WCAG 4.5:1.
  return darkContrast >= MIN_SECONDARY_TEXT_CONTRAST
    ? DARK_TEXT
    : STRICT_DARK_TEXT
}

export function pickSecondaryTextColor(
  background: string,
  foreground: string,
): string {
  const backgroundRgb = parseColor(background)
  const foregroundRgb = parseColor(foreground)
  if (!backgroundRgb || !foregroundRgb) return foreground

  for (let alpha = SECONDARY_START_ALPHA; alpha <= 255; alpha += 1) {
    const candidate = toHex(mixColors(foregroundRgb, backgroundRgb, alpha))
    if (contrastRatio(background, candidate) >= MIN_SECONDARY_TEXT_CONTRAST) {
      return candidate
    }
  }
  return foreground
}

export function pickVisibleAccent(
  background: string,
  preferredAccent: string,
  fallback: string,
): string {
  return parseColor(preferredAccent)
    && contrastRatio(background, preferredAccent) >= MIN_ACCENT_CONTRAST
    ? preferredAccent
    : fallback
}

export function sampledFooterPalette(
  background: string,
  preferredAccent: string,
): SampledFooterPalette {
  const text = pickTextColor(background)
  return {
    background,
    text,
    secondaryText: pickSecondaryTextColor(background, text),
    accent: pickVisibleAccent(background, preferredAccent, text),
  }
}

function isByte(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255
}

function binMean(bin: ColorBin): RGB {
  return [
    Math.round(bin.red / bin.count),
    Math.round(bin.green / bin.count),
    Math.round(bin.blue / bin.count),
  ]
}

function squaredDistance(a: RGB, b: RGB): number {
  return (
    (a[0] - b[0]) ** 2
    + (a[1] - b[1]) ** 2
    + (a[2] - b[2]) ** 2
  )
}

function linearizeChannel(channel: number): number {
  const value = channel / 255
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4
}

function mixColors(foreground: RGB, background: RGB, alpha: number): RGB {
  return foreground.map((channel, index) => Math.round(
    (channel * alpha + background[index] * (255 - alpha)) / 255,
  )) as RGB
}
