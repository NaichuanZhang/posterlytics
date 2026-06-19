import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDesignTokens, type RawTokens } from '../src/lib/designTokens.ts'

const baseRaw: RawTokens = {
  fonts: [
    { value: 'Poppins', count: 5000, role: 'heading' },
    { value: 'system-ui', count: 9000, role: 'body' },
    { value: 'Inter', count: 4000, role: 'body' },
  ],
  fontSizes: [16, 16, 32, 48],
  fontWeights: [400, 400, 700],
  colors: [
    { value: 'rgb(255, 255, 255)', count: 9000, role: 'bg' },
    { value: 'rgb(17, 24, 39)', count: 7000, role: 'text' },
    { value: 'rgb(79, 70, 229)', count: 3000, role: 'button-bg' },
    { value: 'rgb(236, 72, 153)', count: 800, role: 'link' },
  ],
  radii: [8, 8, 12, 24],
  shadows: ['none', '0 4px 12px rgba(0,0,0,0.1)'],
  spacing: [8, 16, 16, 24],
  button: { bg: 'rgb(79, 70, 229)', color: 'rgb(255,255,255)', radius: 12, paddingX: 20, paddingY: 12, weight: 600 },
  fontLinks: ['https://fonts.googleapis.com/css2?family=Poppins'],
}

test('returns null for empty/missing capture', () => {
  assert.equal(normalizeDesignTokens(null), null)
  assert.equal(normalizeDesignTokens({}), null)
  assert.equal(normalizeDesignTokens({ colors: [], fonts: [] }), null)
})

test('prefers a named heading font over a generic family', () => {
  const t = normalizeDesignTokens(baseRaw)!
  assert.equal(t.typography.headingFamily, 'Poppins')
  // body: system-ui is most-used but generic, so the named Inter wins
  assert.equal(t.typography.bodyFamily, 'Inter')
})

test('assigns color roles: light bg, dark text, vivid accent', () => {
  const t = normalizeDesignTokens(baseRaw)!
  assert.equal(t.colors.bg, '#ffffff')
  assert.equal(t.colors.text, '#111827')
  // accent should be one of the vivid brand colors, not white/near-black
  assert.ok(['#4f46e5', '#ec4899'].includes(t.colors.accent), `accent was ${t.colors.accent}`)
  assert.ok(t.colors.palette.includes('#4f46e5'))
})

test('primary biases toward the button/link brand color', () => {
  const t = normalizeDesignTokens(baseRaw)!
  // indigo button-bg is the dominant brand color
  assert.equal(t.colors.primary, '#4f46e5')
})

test('numeric scales are deduped, sorted, bounded', () => {
  const t = normalizeDesignTokens(baseRaw)!
  assert.deepEqual(t.typography.scale, [16, 32, 48])
  assert.deepEqual(t.radii, [8, 12, 24])
  assert.deepEqual(t.typography.weights, [400, 700])
})

test('drops "none" shadows; preserves real ones', () => {
  const t = normalizeDesignTokens(baseRaw)!
  assert.deepEqual(t.shadows, ['0 4px 12px rgba(0,0,0,0.1)'])
})

test('button normalized to hex with rounded metrics', () => {
  const t = normalizeDesignTokens(baseRaw)!
  assert.equal(t.button?.bg, '#4f46e5')
  assert.equal(t.button?.color, '#ffffff')
  assert.equal(t.button?.radius, 12)
  assert.equal(t.button?.weight, 600)
})
