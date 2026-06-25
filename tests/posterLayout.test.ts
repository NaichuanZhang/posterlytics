import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizePosterLayout,
  compileLayoutPrompt,
  type PosterLayout,
} from '../functions/_shared.ts'

const PALETTE = { bg: '#0b1020', text: '#e8ecf5', primary: '#3b82f6', accent: '#f97316' }

test('normalizePosterLayout fills defaults from palette when fields are missing', () => {
  const l = normalizePosterLayout({}, PALETTE)
  assert.equal(l.palette_roles.bg, '#0b1020')
  assert.equal(l.palette_roles.accent, '#f97316')
  assert.ok(l.composition.length > 0)
  assert.ok(l.mood.length > 0)
  assert.ok(l.art_style.length > 0)
  assert.deepEqual(l.zones, [])
})

test('normalizePosterLayout keeps valid zones, drops empty ones, clamps band/emphasis/align', () => {
  const raw = {
    composition: 'asymmetric hero top-left',
    mood: 'editorial, premium',
    art_style: 'flat vector',
    palette_roles: { bg: '#fff', text: '#111', primary: '#222', accent: '#f00', surface: '#eee' },
    zones: [
      { band: 'top', role: 'brand row', content: 'Acme', emphasis: 'low', align: 'left' },
      { band: 'nonsense', role: 'hero', content: 'Big', emphasis: 'wild', align: 'sideways' },
      { band: 'lower', role: '', content: '' }, // dropped: no role/content
    ],
  }
  const l = normalizePosterLayout(raw, PALETTE)
  assert.equal(l.zones.length, 2)
  assert.equal(l.zones[0].band, 'top')
  assert.equal(l.zones[0].emphasis, 'low')
  assert.equal(l.zones[0].align, 'left')
  // invalid band → 'mid'; invalid emphasis/align dropped
  assert.equal(l.zones[1].band, 'mid')
  assert.equal(l.zones[1].emphasis, undefined)
  assert.equal(l.zones[1].align, undefined)
  assert.equal(l.palette_roles.surface, '#eee')
})

test('normalizePosterLayout caps zones at 8 and truncates long strings', () => {
  const zones = Array.from({ length: 12 }, (_, i) => ({ band: 'mid', role: `r${i}`, content: `c${i}` }))
  const l = normalizePosterLayout({ zones, composition: 'x'.repeat(500) }, PALETTE)
  assert.equal(l.zones.length, 8)
  assert.ok(l.composition.length <= 240)
})

const LAYOUT: PosterLayout = {
  composition: 'asymmetric, oversized hero top-left',
  mood: 'editorial, calm, premium',
  art_style: 'flat vector + soft gradients',
  palette_roles: PALETTE,
  zones: [
    { band: 'lower', role: 'call to action', content: 'Start free today', emphasis: 'high', align: 'center' },
    { band: 'top', role: 'brand row', content: 'Acme Analytics' },
    { band: 'upper', role: 'hero headline', content: 'Ship dashboards fast' },
  ],
}

test('compileLayoutPrompt orders zones top→lower regardless of input order', () => {
  const prompt = compileLayoutPrompt(LAYOUT, { product: 'Acme', essence: 'a crisp blue data brand' })
  const iTop = prompt.indexOf('Acme Analytics')
  const iUpper = prompt.indexOf('Ship dashboards fast')
  const iLower = prompt.indexOf('Start free today')
  assert.ok(iTop > -1 && iUpper > -1 && iLower > -1)
  assert.ok(iTop < iUpper && iUpper < iLower, 'top must come before upper before lower')
})

test('compileLayoutPrompt embeds exact zone text, palette, 2:3 framing, and the bottom-margin rule', () => {
  const prompt = compileLayoutPrompt(LAYOUT, { product: 'Acme', essence: 'a crisp blue data brand' })
  assert.ok(prompt.includes('"Start free today"'))
  assert.ok(prompt.includes('"Ship dashboards fast"'))
  assert.ok(prompt.includes('2:3'))
  assert.ok(/BOTTOM ~20%/.test(prompt), 'must reserve the bottom 20% empty for the QR band')
  assert.ok(prompt.includes('#3b82f6') && prompt.includes('#f97316'))
  assert.ok(prompt.includes('a crisp blue data brand'))
  // never asks the model to draw a QR/barcode
  assert.ok(/QR code or barcode drawn by you/i.test(prompt))
})

test('compileLayoutPrompt tolerates an empty zone list with a sensible default', () => {
  const prompt = compileLayoutPrompt({ ...LAYOUT, zones: [] }, { product: 'Acme', essence: '' })
  assert.ok(prompt.includes('2:3'))
  assert.ok(/BOTTOM ~20%/.test(prompt))
})
