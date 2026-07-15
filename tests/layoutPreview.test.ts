import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BAND_GEOMETRY, LAYOUT_BAND_ORDER, groupZonesByBand } from '../src/lib/layoutPreview.ts'
import type { PosterLayout } from '../src/lib/types.ts'

const PALETTE = { bg: '#0b1020', text: '#e8ecf5', primary: '#3b82f6', accent: '#f97316' }

function layout(zones: PosterLayout['zones']): PosterLayout {
  return { composition: 'c', mood: 'm', art_style: 'a', palette_roles: PALETTE, zones }
}

test('BAND_GEOMETRY is exactly the four content bands, top→lower, summing to 100', () => {
  const total = BAND_GEOMETRY.reduce((sum, r) => sum + r.heightPct, 0)
  assert.equal(total, 100)
  // The artwork owns its complete frame — no reserved QR row (the footer lives
  // outside the artwork on the A4 sheet).
  assert.deepEqual(BAND_GEOMETRY.map((r) => r.band), LAYOUT_BAND_ORDER)
})

test('BAND_GEOMETRY matches the band ranges compileLayoutPrompt bakes into the image prompt', () => {
  // top 0–12, upper 12–42, mid 42–72, lower 72–100
  assert.deepEqual(BAND_GEOMETRY.map((r) => r.heightPct), [12, 30, 30, 28])
})

test('groupZonesByBand returns all four bands top→lower regardless of input order', () => {
  const groups = groupZonesByBand(
    layout([
      { band: 'lower', role: 'closing', content: 'Built for teams' },
      { band: 'top', role: 'brand', content: 'Acme' },
      { band: 'upper', role: 'hero', content: 'Ship faster' },
    ]),
  )
  assert.deepEqual(groups.map((g) => g.band), LAYOUT_BAND_ORDER)
  assert.equal(groups[0].zones[0].content, 'Acme')
  assert.equal(groups[1].zones[0].content, 'Ship faster')
  assert.equal(groups[3].zones[0].content, 'Built for teams')
})

test('groupZonesByBand stacks multiple zones in one band, preserving order', () => {
  const groups = groupZonesByBand(
    layout([
      { band: 'mid', role: 'feature grid', content: 'Fast · Safe · Easy' },
      { band: 'mid', role: 'stat row', content: '99.9% uptime' },
    ]),
  )
  const mid = groups.find((g) => g.band === 'mid')!
  assert.equal(mid.zones.length, 2)
  assert.equal(mid.zones[0].role, 'feature grid')
  assert.equal(mid.zones[1].role, 'stat row')
})

test('groupZonesByBand buckets an unknown band into mid (no zone dropped)', () => {
  const groups = groupZonesByBand(
    layout([{ band: 'nonsense' as PosterLayout['zones'][number]['band'], role: 'x', content: 'y' }]),
  )
  const mid = groups.find((g) => g.band === 'mid')!
  assert.equal(mid.zones.length, 1)
  assert.equal(mid.zones[0].content, 'y')
  // Total zones preserved across all bands.
  const total = groups.reduce((n, g) => n + g.zones.length, 0)
  assert.equal(total, 1)
})

test('groupZonesByBand tolerates an empty / missing zone list', () => {
  const groups = groupZonesByBand(layout([]))
  assert.deepEqual(groups.map((g) => g.band), LAYOUT_BAND_ORDER)
  assert.ok(groups.every((g) => g.zones.length === 0))
})
