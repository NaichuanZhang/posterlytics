import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  contrastRatio,
  getBottomEdgeStripHeight,
  MIN_ACCENT_CONTRAST,
  MIN_SECONDARY_TEXT_CONTRAST,
  pickSecondaryTextColor,
  pickTextColor,
  pickVisibleAccent,
  sampledFooterPalette,
  sampleEdgeColor,
  wcagRelativeLuminance,
} from '../src/lib/posterEdgeColor.ts'

type RGBA = [number, number, number, number]

test('bottom strip uses three percent of intrinsic height with a one-pixel floor', () => {
  assert.equal(getBottomEdgeStripHeight(0), 0)
  assert.equal(getBottomEdgeStripHeight(Number.NaN), 0)
  assert.equal(getBottomEdgeStripHeight(1), 1)
  assert.equal(getBottomEdgeStripHeight(100), 3)
  assert.equal(getBottomEdgeStripHeight(101), 4)
})

test('solid edge pixels preserve their exact color', () => {
  assert.equal(
    sampleEdgeColor(imageData([
      [237, 243, 238, 255],
      [237, 243, 238, 255],
      [237, 243, 238, 255],
    ])),
    '#edf3ee',
  )
})

test('dominant bin wins a split edge instead of averaging unrelated colors', () => {
  const red: RGBA = [240, 16, 32, 255]
  const blue: RGBA = [16, 32, 240, 255]
  assert.equal(
    sampleEdgeColor(imageData([
      red, red, red, red, red, red,
      blue, blue, blue, blue,
    ])),
    '#f01020',
  )
})

test('gradient ties choose the bin nearest the strip mean independent of scan order', () => {
  const gradient = Array.from(
    { length: 256 },
    (_, value): RGBA => [value, value, value, 255],
  )
  assert.equal(sampleEdgeColor(imageData(gradient)), '#707070')
  assert.equal(sampleEdgeColor(imageData([...gradient].reverse())), '#707070')
})

test('equal count and distance ties use the lowest numeric bin key', () => {
  const red: RGBA = [240, 0, 0, 255]
  const blue: RGBA = [0, 0, 240, 255]
  const split = [red, blue, red, blue, red, blue, red, blue]
  assert.equal(sampleEdgeColor(imageData(split)), '#0000f0')
  assert.equal(sampleEdgeColor(imageData([...split].reverse())), '#0000f0')
})

test('transparent and malformed buffers do not contribute a color', () => {
  assert.equal(
    sampleEdgeColor(imageData([
      [255, 0, 0, 0],
      [12, 34, 56, 255],
      [255, 0, 0, 127],
    ])),
    '#0c2238',
  )
  assert.equal(sampleEdgeColor(imageData([[255, 0, 0, 0]])), null)
  assert.equal(sampleEdgeColor({ data: Uint8Array.from([0, 0, 0]), width: 1, height: 1 }), null)
  assert.equal(sampleEdgeColor({ data: Uint8Array.from([]), width: 0, height: 1 }), null)
})

test('WCAG luminance and contrast match canonical black and white values', () => {
  assert.equal(wcagRelativeLuminance('#000000'), 0)
  assert.equal(wcagRelativeLuminance('#ffffff'), 1)
  assert.equal(contrastRatio('#000000', '#ffffff'), 21)
})

test('text polarity flips and always supports a 4.5 to 1 secondary color', () => {
  for (const background of ['#101010', '#777777', '#f0f0f0']) {
    const text = pickTextColor(background)
    const secondary = pickSecondaryTextColor(background, text)
    assert.ok(
      contrastRatio(background, text) >= MIN_SECONDARY_TEXT_CONTRAST,
      `${background} / ${text}`,
    )
    assert.ok(
      contrastRatio(background, secondary) >= MIN_SECONDARY_TEXT_CONTRAST,
      `${background} / ${secondary}`,
    )
  }
  assert.equal(pickTextColor('#101010'), '#ffffff')
  assert.equal(pickTextColor('#f0f0f0'), '#0b0c0b')
})

test('accent is retained at 3 to 1 and otherwise falls back to text', () => {
  assert.equal(
    pickVisibleAccent('#ffffff', '#000000', '#0b0c0b'),
    '#000000',
  )
  const fallback = pickVisibleAccent('#f0f0f0', '#eeeeee', '#0b0c0b')
  assert.equal(fallback, '#0b0c0b')
  assert.ok(contrastRatio('#f0f0f0', fallback) >= MIN_ACCENT_CONTRAST)
})

test('sampled footer palette applies text and accent contrast gates together', () => {
  const palette = sampledFooterPalette('#edf3ee', '#10b981')
  assert.deepEqual(
    {
      background: palette.background,
      text: palette.text,
      accent: palette.accent,
    },
    {
      background: '#edf3ee',
      text: '#0b0c0b',
      accent: '#0b0c0b',
    },
  )
  assert.ok(
    contrastRatio(palette.background, palette.secondaryText)
      >= MIN_SECONDARY_TEXT_CONTRAST,
  )
})

function imageData(pixels: RGBA[]) {
  return {
    data: Uint8ClampedArray.from(pixels.flat()),
    width: pixels.length,
    height: 1,
  }
}
