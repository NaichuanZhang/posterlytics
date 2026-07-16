import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeCaptureColorScheme,
  normalizeStyleProfile,
} from '../functions/_shared.ts'

test('legacy style profiles remain readable and receive only core defaults', () => {
  const profile = normalizeStyleProfile({
    palette: { primary: '#123', bg: '#fff', text: '#111', accent: '#f60' },
    fonts: { heading: 'Inter', body: 'Arial' },
    tone: 'quiet utility',
    layout_hint: 'centered',
  })
  assert.equal(profile.palette.primary, '#112233')
  assert.equal(profile.palette.bg, '#ffffff')
  assert.equal(profile.fonts.heading, 'Inter')
  assert.equal(profile.tone, 'quiet utility')
  assert.equal(profile.layout_hint, 'centered')
  assert.equal(profile.density, undefined)
})

test('expanded style profiles normalize visual direction and weighted colors', () => {
  const profile = normalizeStyleProfile({
    palette: {
      primary: '#101010',
      bg: '#000000',
      text: '#ffffff',
      accent: '#ff8800',
      secondary: '#2463eb',
      supporting: ['#333333', 'nope', '#333333'],
      proportions: [
        { color: '#000', proportion: 72 },
        { color: '#fff', proportion: 0.2 },
      ],
    },
    fonts: { heading: 'Sohne', body: 'Sohne' },
    tone: 'restrained technical',
    imagery: 'space photography',
    typography_treatment: 'large grotesk headlines',
    lighting: 'black field with edge glow',
    texture: 'clean digital finish',
    motifs: ['orbital arcs', 'orbital arcs', 'star maps'],
    composition: 'large quiet field around one focal point',
    density: 'sparse',
  })
  assert.equal(profile.palette.secondary, '#2463eb')
  assert.deepEqual(profile.palette.supporting, ['#333333'])
  assert.deepEqual(profile.palette.proportions, [
    { color: '#000000', proportion: 0.72 },
    { color: '#ffffff', proportion: 0.2 },
  ])
  assert.equal(profile.imagery, 'space photography')
  assert.deepEqual(profile.motifs, ['orbital arcs', 'star maps'])
  assert.equal(profile.density, 'sparse')
})

test('analyze color scheme validation defaults to light and rejects unknown values', () => {
  assert.equal(normalizeCaptureColorScheme(undefined), 'light')
  assert.equal(normalizeCaptureColorScheme('dark'), 'dark')
  assert.equal(normalizeCaptureColorScheme('system'), null)
})
