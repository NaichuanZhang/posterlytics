import assert from 'node:assert/strict'
import { test } from 'node:test'
import { jsonDeepEqual } from '../src/lib/jsonDeepEqual.ts'

test('compares scalar values with Object.is semantics', () => {
  assert.equal(jsonDeepEqual('poster', 'poster'), true)
  assert.equal(jsonDeepEqual(42, 42), true)
  assert.equal(jsonDeepEqual(Number.NaN, Number.NaN), true)
  assert.equal(jsonDeepEqual(0, -0), false)
  assert.equal(jsonDeepEqual('42', 42), false)
  assert.equal(jsonDeepEqual(true, false), false)
})

test('distinguishes null from objects and arrays', () => {
  assert.equal(jsonDeepEqual(null, {}), false)
  assert.equal(jsonDeepEqual(null, []), false)
  assert.equal(jsonDeepEqual({}, null), false)
  assert.equal(jsonDeepEqual(null, null), true)
})

test('compares nested JSON arrays in order', () => {
  const left = {
    reference_images: [
      { key: 'references/one.png', purpose: 'product' },
      { key: 'references/two.png', purpose: 'style' },
    ],
    poster_layout: {
      zones: [
        { band: 'top', role: 'brand' },
        { band: 'upper', role: 'headline' },
      ],
    },
  }
  const same = {
    reference_images: [
      { key: 'references/one.png', purpose: 'product' },
      { key: 'references/two.png', purpose: 'style' },
    ],
    poster_layout: {
      zones: [
        { band: 'top', role: 'brand' },
        { band: 'upper', role: 'headline' },
      ],
    },
  }
  const reordered = {
    ...same,
    poster_layout: {
      zones: [...same.poster_layout.zones].reverse(),
    },
  }

  assert.equal(jsonDeepEqual(left, same), true)
  assert.equal(jsonDeepEqual(left, reordered), false)
})

test('ignores record key insertion order at every depth', () => {
  const left = {
    id: 'campaign-1',
    style_profile: {
      palette: { bg: '#ffffff', accent: '#ff0000' },
      mood: 'editorial',
    },
  }
  const right = {
    style_profile: {
      mood: 'editorial',
      palette: { accent: '#ff0000', bg: '#ffffff' },
    },
    id: 'campaign-1',
  }

  assert.equal(jsonDeepEqual(left, right), true)
})

test('detects a change confined to one nested field', () => {
  const left = {
    id: 'generation-1',
    poster_layout: {
      zones: [{ band: 'top', content: 'Launch today' }],
    },
    updated_at: '2026-07-24T20:00:00.000Z',
  }
  const changedCopy = {
    ...left,
    poster_layout: {
      zones: [{ band: 'top', content: 'Launch tomorrow' }],
    },
  }
  const changedTimestamp = {
    ...left,
    updated_at: '2026-07-24T20:00:01.000Z',
  }

  assert.equal(jsonDeepEqual(left, changedCopy), false)
  assert.equal(jsonDeepEqual(left, changedTimestamp), false)
})

test('accepts independently allocated identical deep structures', () => {
  const makeValue = () => ({
    campaign: {
      id: 'campaign-1',
      reference_images: [{ key: 'reference.png', metadata: { width: 800 } }],
    },
    generations: [
      {
        id: 'generation-1',
        poster_layout: { zones: [{ role: 'headline', lines: ['One', 'Two'] }] },
      },
    ],
  })

  assert.equal(jsonDeepEqual(makeValue(), makeValue()), true)
})
