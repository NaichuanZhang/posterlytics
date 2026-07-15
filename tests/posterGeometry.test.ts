import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ARTWORK_HEIGHT,
  ARTWORK_WIDTH,
  FOOTER_H,
  MATTE_GAP,
  MATTE_X,
  POSTER_HEIGHT,
  POSTER_WIDTH,
  SHEET_MARGIN_Y,
} from '../src/lib/posterSize.ts'

test('sheet ratio matches portrait A4 (210:297) within 0.1%', () => {
  const sheet = POSTER_WIDTH / POSTER_HEIGHT
  const a4 = 210 / 297
  assert.ok(Math.abs(sheet - a4) / a4 < 0.001, `sheet ${sheet} vs A4 ${a4}`)
})

test('artwork is exactly 2:3', () => {
  assert.equal(ARTWORK_WIDTH * 3, ARTWORK_HEIGHT * 2)
})

test('mattes + artwork span the sheet width exactly', () => {
  assert.equal(MATTE_X + ARTWORK_WIDTH + MATTE_X, POSTER_WIDTH)
})

test('margins + artwork + gap + footer sum to the sheet height exactly (no overlap possible)', () => {
  assert.equal(SHEET_MARGIN_Y + ARTWORK_HEIGHT + MATTE_GAP + FOOTER_H + SHEET_MARGIN_Y, POSTER_HEIGHT)
})

test('2x export lands on 300-DPI A4 pixel dimensions', () => {
  assert.equal(POSTER_WIDTH * 2, 2480)
  assert.equal(POSTER_HEIGHT * 2, 3508)
})
