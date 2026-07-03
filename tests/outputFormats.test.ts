import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OUTPUT_FORMATS, POSTER_2x3, getOutputFormat } from '../src/lib/outputFormats.ts'

test('POSTER_2x3 keeps the historical 1080×1620 / bottom-band shape', () => {
  assert.equal(POSTER_2x3.id, 'poster_2x3')
  assert.equal(POSTER_2x3.w, 1080)
  assert.equal(POSTER_2x3.h, 1620)
  assert.equal(POSTER_2x3.layout, 'qr_band_bottom')
})

test('registry contains the default poster and every entry is self-consistent', () => {
  assert.equal(OUTPUT_FORMATS.poster_2x3, POSTER_2x3)
  for (const [id, fmt] of Object.entries(OUTPUT_FORMATS)) {
    assert.equal(fmt.id, id, `key ${id} must match its format id`)
    assert.ok(fmt.w > 0 && fmt.h > 0, `${id} has positive dimensions`)
    assert.ok(
      ['qr_band_bottom', 'qr_corner', 'bare_no_qr'].includes(fmt.layout),
      `${id} has a known layout`,
    )
    assert.ok(fmt.label.length > 0, `${id} has a label`)
  }
})

test('getOutputFormat falls back to the default poster for unknown/absent ids', () => {
  assert.equal(getOutputFormat('poster_2x3'), POSTER_2x3)
  assert.equal(getOutputFormat(null), POSTER_2x3)
  assert.equal(getOutputFormat(undefined), POSTER_2x3)
  assert.equal(getOutputFormat('does_not_exist'), POSTER_2x3)
})
