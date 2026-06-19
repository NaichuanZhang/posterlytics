import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseColor, toHex, vividness, isVivid, relativeLuminance } from '../src/lib/colorUtils.ts'

test('parseColor handles hex, short hex, rgb, rgba', () => {
  assert.deepEqual(parseColor('#4f46e5'), [79, 70, 229])
  assert.deepEqual(parseColor('#fff'), [255, 255, 255])
  assert.deepEqual(parseColor('rgb(79, 70, 229)'), [79, 70, 229])
  assert.deepEqual(parseColor('rgba(79, 70, 229, 0.8)'), [79, 70, 229])
})

test('parseColor rejects transparent / invalid', () => {
  assert.equal(parseColor('rgba(0, 0, 0, 0)'), null)
  assert.equal(parseColor('transparent' as unknown as string), null)
  assert.equal(parseColor('not-a-color'), null)
  assert.equal(parseColor(''), null)
  assert.equal(parseColor(null), null)
})

test('toHex round-trips', () => {
  assert.equal(toHex([79, 70, 229]), '#4f46e5')
  assert.equal(toHex([255, 255, 255]), '#ffffff')
})

test('vividness: saturated mid-tone high, gray/near-black/near-white low', () => {
  assert.ok(vividness([79, 70, 229]) > 0.4) // indigo
  assert.ok(vividness([128, 128, 128]) < 0.1) // gray
  assert.ok(vividness([0, 0, 0]) < 0.1) // black
  assert.ok(vividness([255, 255, 255]) < 0.1) // white
})

test('isVivid threshold', () => {
  assert.equal(isVivid('#4f46e5'), true)
  assert.equal(isVivid('#808080'), false)
  assert.equal(isVivid('#000000'), false)
  assert.equal(isVivid(undefined), false)
})

test('relativeLuminance ordering', () => {
  assert.ok(relativeLuminance([255, 255, 255]) > relativeLuminance([17, 24, 39]))
})
