import assert from 'node:assert/strict'
import test from 'node:test'
import { decorateDestinationUrl } from '../functions/_shared.ts'

const attribution = {
  campaign: 'Summer Launch',
  placementCode: 'retail-window-7',
}

test('decorateDestinationUrl appends attribution to a plain URL', () => {
  assert.equal(
    decorateDestinationUrl('https://example.com/shop', attribution),
    'https://example.com/shop?utm_source=posterlytics&utm_medium=qr&utm_campaign=Summer+Launch&utm_content=retail-window-7',
  )
})

test('decorateDestinationUrl preserves an existing query string', () => {
  assert.equal(
    decorateDestinationUrl('https://example.com/shop?ref=partner&offer=summer', attribution),
    'https://example.com/shop?ref=partner&offer=summer&utm_source=posterlytics&utm_medium=qr&utm_campaign=Summer+Launch&utm_content=retail-window-7',
  )
})

test('decorateDestinationUrl preserves an owner-provided utm_source', () => {
  assert.equal(
    decorateDestinationUrl('https://example.com/shop?utm_source=owner-newsletter', attribution),
    'https://example.com/shop?utm_source=owner-newsletter&utm_medium=qr&utm_campaign=Summer+Launch&utm_content=retail-window-7',
  )
})

test('decorateDestinationUrl preserves a destination fragment', () => {
  assert.equal(
    decorateDestinationUrl('https://example.com/shop#pricing', attribution),
    'https://example.com/shop?utm_source=posterlytics&utm_medium=qr&utm_campaign=Summer+Launch&utm_content=retail-window-7#pricing',
  )
})

test('decorateDestinationUrl returns an unparseable destination unchanged', () => {
  const destination = 'not a valid destination'
  assert.equal(decorateDestinationUrl(destination, attribution), destination)
})
