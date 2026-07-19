import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_PLATFORM_HINT_LENGTH,
  PLATFORM_HINT_OPTIONS,
  isPlatformHintPreset,
  normalizePlatformHint,
} from '../src/lib/platformHints.ts'

test('platform hints expose the curated canonical values without an enum contract', () => {
  assert.deepEqual(
    PLATFORM_HINT_OPTIONS.map((option) => option.value),
    ['RedNote / 小红书', 'YouTube', 'Luma', 'Instagram'],
  )
  assert.equal(isPlatformHintPreset('Instagram'), true)
  assert.equal(isPlatformHintPreset('TikTok'), false)
})

test('platform hints trim, null empty input, and cap custom text at 80 characters', () => {
  assert.equal(normalizePlatformHint('  YouTube  '), 'YouTube')
  assert.equal(normalizePlatformHint('   '), null)
  assert.equal(normalizePlatformHint(null), null)
  assert.equal(
    normalizePlatformHint('x'.repeat(MAX_PLATFORM_HINT_LENGTH + 20)),
    'x'.repeat(MAX_PLATFORM_HINT_LENGTH),
  )
})

test('platform hints trim whitespace exposed at the slice boundary', () => {
  const value = `${'x'.repeat(MAX_PLATFORM_HINT_LENGTH - 1)} trailing text`

  assert.equal(
    normalizePlatformHint(value),
    'x'.repeat(MAX_PLATFORM_HINT_LENGTH - 1),
  )
})
