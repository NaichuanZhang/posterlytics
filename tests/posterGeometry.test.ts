import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ARTWORK_HEIGHT,
  ARTWORK_WIDTH,
  BASE_QR_BAND_GEOMETRY,
  DEFAULT_POSTER_SIZE,
  FOOTER_H,
  getPosterMatteX,
  getPosterQrBandGeometry,
  getSelectablePosterSizes,
  getPosterSize,
  getPosterSizeTwin,
  hasPosterQrBand,
  resolvePosterFormat,
  splitPosterFormat,
  MATTE_GAP,
  MATTE_X,
  POSTER_HEIGHT,
  POSTER_SIZES,
  POSTER_WIDTH,
  SHEET_MARGIN_Y,
} from '../src/lib/posterSize.ts'
import { getUseCase } from '../src/lib/useCases.ts'

const PRESET_EXPECTATIONS = [
  {
    slug: 'a4_2x3',
    artwork: { width: 980, height: 1470 },
    sheet: { width: 1240, height: 1754 },
    providerAspectRatio: '2:3',
    pixelRatio: 2,
    exportSize: { width: 2480, height: 3508 },
    filenameSuffix: 'A4',
    qrBand: { mode: 'scaled', scale: 1 },
  },
  {
    slug: 'a4_2x3_cover',
    artwork: { width: 980, height: 1470 },
    sheet: { width: 980, height: 1470 },
    providerAspectRatio: '2:3',
    pixelRatio: 2,
    exportSize: { width: 1960, height: 2940 },
    filenameSuffix: 'FullBleed-2x3',
    qrBand: { mode: 'none' },
  },
  {
    slug: 'rednote_3x4',
    artwork: { width: 960, height: 1280 },
    sheet: { width: 1242, height: 1656 },
    providerAspectRatio: '3:4',
    pixelRatio: 1,
    exportSize: { width: 1242, height: 1656 },
    filenameSuffix: 'Portrait-3x4',
    qrBand: {
      mode: 'scaled',
      scale: (1656 - 1280) / (
        BASE_QR_BAND_GEOMETRY.sheetMarginY * 2
        + BASE_QR_BAND_GEOMETRY.gap
        + BASE_QR_BAND_GEOMETRY.footerHeight
      ),
    },
  },
  {
    slug: 'rednote_cover_3x4',
    artwork: { width: 1242, height: 1656 },
    sheet: { width: 1242, height: 1656 },
    providerAspectRatio: '3:4',
    pixelRatio: 1,
    exportSize: { width: 1242, height: 1656 },
    filenameSuffix: 'FullBleed-3x4',
    qrBand: { mode: 'none' },
  },
  {
    slug: 'yt_thumb_16x9',
    artwork: { width: 800, height: 450 },
    sheet: { width: 1280, height: 720 },
    providerAspectRatio: '16:9',
    pixelRatio: 1,
    exportSize: { width: 1280, height: 720 },
    filenameSuffix: 'Landscape-16x9',
    qrBand: {
      mode: 'scaled',
      scale: (720 - 450) / (
        BASE_QR_BAND_GEOMETRY.sheetMarginY * 2
        + BASE_QR_BAND_GEOMETRY.gap
        + BASE_QR_BAND_GEOMETRY.footerHeight
      ),
    },
  },
  {
    slug: 'yt_thumb_16x9_cover',
    artwork: { width: 800, height: 450 },
    sheet: { width: 800, height: 450 },
    providerAspectRatio: '16:9',
    pixelRatio: 1,
    exportSize: { width: 800, height: 450 },
    filenameSuffix: 'FullBleed-16x9',
    qrBand: { mode: 'none' },
  },
  {
    slug: 'luma_1x1',
    artwork: { width: 800, height: 800 },
    sheet: { width: 1080, height: 1080 },
    providerAspectRatio: '1:1',
    pixelRatio: 1,
    exportSize: { width: 1080, height: 1080 },
    filenameSuffix: 'Square-1x1',
    qrBand: {
      mode: 'scaled',
      scale: (1080 - 800) / (
        BASE_QR_BAND_GEOMETRY.sheetMarginY * 2
        + BASE_QR_BAND_GEOMETRY.gap
        + BASE_QR_BAND_GEOMETRY.footerHeight
      ),
    },
  },
  {
    slug: 'luma_1x1_cover',
    artwork: { width: 800, height: 800 },
    sheet: { width: 800, height: 800 },
    providerAspectRatio: '1:1',
    pixelRatio: 1,
    exportSize: { width: 800, height: 800 },
    filenameSuffix: 'FullBleed-1x1',
    qrBand: { mode: 'none' },
  },
] as const

test('registry contains the approved presets in stable order', () => {
  assert.deepEqual(
    POSTER_SIZES.map((size) => size.slug),
    PRESET_EXPECTATIONS.map((size) => size.slug),
  )
})

test('selectable formats preserve registry order and grandfather the current format', () => {
  assert.deepEqual(
    getSelectablePosterSizes(['luma_1x1', 'a4_2x3']).map((size) => size.slug),
    ['a4_2x3', 'luma_1x1'],
  )
  assert.deepEqual(
    getSelectablePosterSizes(
      ['a4_2x3', 'luma_1x1'],
      'rednote_cover_3x4',
    ).map((size) => size.slug),
    ['a4_2x3', 'rednote_cover_3x4', 'luma_1x1'],
  )
})

test('default registry entry preserves the established A4 descriptor exactly', () => {
  assert.equal(DEFAULT_POSTER_SIZE.slug, 'a4_2x3')
  assert.deepEqual(DEFAULT_POSTER_SIZE.artwork, { width: 980, height: 1470 })
  assert.deepEqual(DEFAULT_POSTER_SIZE.sheet, { width: 1240, height: 1754 })
  assert.equal(DEFAULT_POSTER_SIZE.providerAspectRatio, '2:3')
  assert.equal(DEFAULT_POSTER_SIZE.export.pixelRatio, 2)
  assert.equal(DEFAULT_POSTER_SIZE.export.filenameSuffix, 'A4')
  assert.deepEqual(DEFAULT_POSTER_SIZE.qrBand, { mode: 'scaled', scale: 1 })
})

test('both social-cover modes reuse the existing 1242x1656 descriptors', () => {
  const social = getUseCase('social_cover')
  const modes = social.allowedPosterFormats.map((slug) => getPosterSize(slug))

  assert.deepEqual(
    modes.map((size) => size.slug),
    ['rednote_cover_3x4', 'rednote_3x4'],
  )
  assert.deepEqual(
    modes.map((size) => size.sheet),
    [
      { width: 1242, height: 1656 },
      { width: 1242, height: 1656 },
    ],
  )
  assert.equal(hasPosterQrBand(modes[0]), false)
  assert.equal(hasPosterQrBand(modes[1]), true)
  assert.equal(POSTER_SIZES.length, PRESET_EXPECTATIONS.length)
})

test('only a missing legacy slug falls back to the default registry entry', () => {
  assert.equal(getPosterSize(null), DEFAULT_POSTER_SIZE)
  assert.equal(getPosterSize(undefined), DEFAULT_POSTER_SIZE)
  for (const size of POSTER_SIZES) {
    assert.equal(getPosterSize(size.slug), size)
  }
  assert.throws(() => getPosterSize(''), /Unknown poster size/)
  assert.throws(() => getPosterSize('future_format'), /Unknown poster size/)
})

for (const expected of PRESET_EXPECTATIONS) {
  test(`${expected.slug} keeps artwork, sheet, QR band, and export geometry coherent`, () => {
    const size = getPosterSize(expected.slug)
    const qrBand = getPosterQrBandGeometry(size)
    const [ratioWidth, ratioHeight] = expected.providerAspectRatio.split(':').map(Number)

    assert.deepEqual(size.artwork, expected.artwork)
    assert.deepEqual(size.sheet, expected.sheet)
    assert.equal(size.providerAspectRatio, expected.providerAspectRatio)
    assert.equal(size.artwork.width * ratioHeight, size.artwork.height * ratioWidth)
    assert.ok(getPosterMatteX(size) >= 0)
    assert.equal(
      getPosterMatteX(size) + size.artwork.width + getPosterMatteX(size),
      size.sheet.width,
    )

    const composedHeight =
      qrBand.sheetMarginY
      + size.artwork.height
      + qrBand.gap
      + qrBand.footerHeight
      + qrBand.sheetMarginY
    assert.ok(
      Math.abs(composedHeight - size.sheet.height) < 1e-9,
      `${expected.slug} composed height ${composedHeight} vs ${size.sheet.height}`,
    )
    assert.deepEqual(size.qrBand, expected.qrBand)
    if (hasPosterQrBand(size)) {
      assert.ok(size.qrBand.scale > 0)
      assert.deepEqual(qrBand, {
        sheetMarginY: BASE_QR_BAND_GEOMETRY.sheetMarginY * size.qrBand.scale,
        gap: BASE_QR_BAND_GEOMETRY.gap * size.qrBand.scale,
        footerHeight: BASE_QR_BAND_GEOMETRY.footerHeight * size.qrBand.scale,
        qrSize: BASE_QR_BAND_GEOMETRY.qrSize * size.qrBand.scale,
      })
    } else {
      assert.deepEqual(qrBand, {
        sheetMarginY: 0,
        gap: 0,
        footerHeight: 0,
        qrSize: 0,
      })
      assert.deepEqual(size.artwork, size.sheet)
      assert.equal(getPosterMatteX(size), 0)
    }

    assert.equal(size.export.pixelRatio, expected.pixelRatio)
    assert.deepEqual(
      {
        width: size.sheet.width * size.export.pixelRatio,
        height: size.sheet.height * size.export.pixelRatio,
      },
      expected.exportSize,
    )
    assert.equal(size.export.filenameSuffix, expected.filenameSuffix)
  })
}

test('default compatibility exports remain pixel-identical to the A4 descriptor', () => {
  assert.equal(ARTWORK_WIDTH, 980)
  assert.equal(ARTWORK_HEIGHT, 1470)
  assert.equal(POSTER_WIDTH, 1240)
  assert.equal(POSTER_HEIGHT, 1754)
  assert.equal(MATTE_X + ARTWORK_WIDTH + MATTE_X, POSTER_WIDTH)
  assert.equal(
    SHEET_MARGIN_Y + ARTWORK_HEIGHT + MATTE_GAP + FOOTER_H + SHEET_MARGIN_Y,
    POSTER_HEIGHT,
  )
  assert.equal(POSTER_WIDTH * DEFAULT_POSTER_SIZE.export.pixelRatio, 2480)
  assert.equal(POSTER_HEIGHT * DEFAULT_POSTER_SIZE.export.pixelRatio, 3508)
})

test('default sheet ratio still matches portrait A4 (210:297) within 0.1%', () => {
  const sheet = POSTER_WIDTH / POSTER_HEIGHT
  const a4 = 210 / 297
  assert.ok(Math.abs(sheet - a4) / a4 < 0.001, `sheet ${sheet} vs A4 ${a4}`)
})

test('resolvePosterFormat and splitPosterFormat round-trip every registry slug', () => {
  for (const size of POSTER_SIZES) {
    const { aspect, qrEnabled } = splitPosterFormat(size.slug)
    assert.equal(aspect, size.providerAspectRatio, size.slug)
    assert.equal(qrEnabled, hasPosterQrBand(size), size.slug)
    // resolve(split(slug)) must return the same slug.
    assert.equal(resolvePosterFormat(aspect, qrEnabled), size.slug, size.slug)
  }
})

test('getPosterSizeTwin flips the band for aspects that have a twin, null otherwise', () => {
  const pairs = [
    ['a4_2x3', 'a4_2x3_cover'],
    ['rednote_3x4', 'rednote_cover_3x4'],
    ['yt_thumb_16x9', 'yt_thumb_16x9_cover'],
    ['luma_1x1', 'luma_1x1_cover'],
  ]
  for (const [banded, bandless] of pairs) {
    assert.equal(getPosterSizeTwin(banded), bandless, banded)
    assert.equal(getPosterSizeTwin(bandless), banded, bandless)
    // A twin always shares the aspect and flips the band.
    assert.equal(
      getPosterSize(banded).providerAspectRatio,
      getPosterSize(bandless).providerAspectRatio,
    )
    assert.notEqual(
      hasPosterQrBand(getPosterSize(banded)),
      hasPosterQrBand(getPosterSize(bandless)),
    )
  }
})

test('every bandless twin satisfies the aspect invariant (artwork === sheet at the true ratio)', () => {
  for (const size of POSTER_SIZES) {
    if (size.qrBand.mode !== 'none') continue
    // artwork === sheet (no matte) and width*ratioHeight === height*ratioWidth.
    assert.deepEqual(size.artwork, size.sheet, size.slug)
    const [rw, rh] = size.providerAspectRatio.split(':').map(Number)
    assert.equal(size.artwork.width * rh, size.artwork.height * rw, size.slug)
  }
})
