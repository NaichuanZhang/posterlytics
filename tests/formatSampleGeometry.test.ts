import assert from 'node:assert/strict'
import { test } from 'node:test'
import { POSTER_SIZES } from '../src/lib/posterSize.ts'
import { getFormatSampleGeometry } from '../src/marketing/formatSampleGeometry.ts'

const TOLERANCE = 1e-9

function assertApproximatelyEqual(
  actual: number,
  expected: number,
  message: string,
) {
  assert.ok(
    Math.abs(actual - expected) < TOLERANCE,
    `${message}: expected ${expected}, received ${actual}`,
  )
}

for (const size of POSTER_SIZES) {
  test(`${size.slug} maps registry geometry into a complete format sample`, () => {
    const geometry = getFormatSampleGeometry(size.slug)
    const expectedOrientation = size.artwork.width === size.artwork.height
      ? 'square'
      : size.artwork.width > size.artwork.height
        ? 'landscape'
        : 'portrait'

    assert.equal(geometry.orientation, expectedOrientation)
    assert.equal(geometry.qrBandMode, size.qrBand.mode)
    assert.equal(
      geometry.sheetAspectRatio,
      `${size.sheet.width} / ${size.sheet.height}`,
    )
    assertApproximatelyEqual(
      geometry.matteXPct * 2 + geometry.artworkWidthPct,
      100,
      `${size.slug} horizontal tracks`,
    )
    assertApproximatelyEqual(
      geometry.marginYPct * 2
        + geometry.artworkHeightPct
        + geometry.gapPct
        + geometry.footerHeightPct,
      100,
      `${size.slug} vertical tracks`,
    )

    if (geometry.qrBandMode === 'scaled') {
      assert.ok(geometry.matteXPct > 0)
      assert.ok(geometry.marginYPct > 0)
      assert.ok(geometry.gapPct > 0)
      assert.ok(geometry.footerHeightPct > 0)
      assert.ok(geometry.qrSizePct > 0)
    } else {
      assert.equal(geometry.matteXPct, 0)
      assert.equal(geometry.marginYPct, 0)
      assert.equal(geometry.gapPct, 0)
      assert.equal(geometry.footerHeightPct, 0)
      assert.equal(geometry.qrSizePct, 0)
      assert.equal(geometry.artworkWidthPct, 100)
      assert.equal(geometry.artworkHeightPct, 100)
    }
  })
}
