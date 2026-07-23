import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  colorNameForHex,
  replacePainterHexColors,
} from '../functions/_painterColors.ts'

test('colorNameForHex maps anchors and arbitrary colors deterministically', () => {
  assert.equal(colorNameForHex('#2563eb', 'fallback'), 'blue')
  assert.equal(colorNameForHex('#fff', 'fallback'), 'white')
  assert.equal(colorNameForHex('#ff5733', 'fallback'), 'coral')
  assert.equal(colorNameForHex('#123456', 'fallback'), 'charcoal')

  const repeated = Array.from(
    { length: 20 },
    () => colorNameForHex('#808080', 'fallback'),
  )
  assert.deepEqual(new Set(repeated), new Set(['gray']))
})

test('colorNameForHex uses the role fallback for invalid input', () => {
  assert.equal(colorNameForHex('#12', 'background color'), 'background color')
  assert.equal(colorNameForHex('#abcd1234', 'accent color'), 'accent color')
  assert.equal(colorNameForHex('not-a-color', 'text color'), 'text color')
})

test('replacePainterHexColors replaces 3, 6, and 8 digit colors completely', () => {
  const replaced = replacePainterHexColors(
    'background #abc; accent #FF5733; overlay #11223388.',
  )

  assert.equal(
    replaced,
    'background silver; accent coral; overlay charcoal.',
  )
  assert.doesNotMatch(replaced, /#[0-9a-f]/i)
  assert.doesNotMatch(replaced, /charcoal88/)
})

test('replacePainterHexColors consumes 4 digit RGBA colors completely', () => {
  const replaced = replacePainterHexColors('#abcd')

  assert.equal(replaced, 'silver')
  assert.doesNotMatch(replaced, /[#d]/i)
})

test('replacePainterHexColors leaves non-color hash text alone', () => {
  assert.equal(
    replacePainterHexColors('Use #launch_day and issue#123 in the caption.'),
    'Use #launch_day and issue#123 in the caption.',
  )
})
