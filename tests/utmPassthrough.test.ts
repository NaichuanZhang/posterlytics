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

test('decorateDestinationUrl preserves Amazon Attribution query bytes exactly', () => {
  assert.equal(
    decorateDestinationUrl(
      'https://www.amazon.com/dp/B0EXAMPLE1?maas=maas_adg_123&ref_=aa_maas&tag=seller-20&ascsubtag=summer%2Flaunch%20one#customerReviews',
      attribution,
    ),
    'https://www.amazon.com/dp/B0EXAMPLE1?maas=maas_adg_123&ref_=aa_maas&tag=seller-20&ascsubtag=summer%2Flaunch%20one&utm_source=posterlytics&utm_medium=qr&utm_campaign=Summer+Launch&utm_content=retail-window-7#customerReviews',
  )
})

test('decorateDestinationUrl detects encoded UTM keys without reserializing them', () => {
  assert.equal(
    decorateDestinationUrl(
      'https://www.amazon.com/dp/B0EXAMPLE1?%75tm_source=owner%20campaign&ascsubtag=launch%2Fone',
      attribution,
    ),
    'https://www.amazon.com/dp/B0EXAMPLE1?%75tm_source=owner%20campaign&ascsubtag=launch%2Fone&utm_medium=qr&utm_campaign=Summer+Launch&utm_content=retail-window-7',
  )
})

test('decorateDestinationUrl returns fully attributed destinations byte-for-byte', () => {
  const destination =
    'https://www.amazon.com/dp/B0EXAMPLE1?utm_source=owner%20source&utm_medium=affiliate&utm_campaign=summer%2Flaunch&utm_content=hero%20slot'
  assert.equal(decorateDestinationUrl(destination, attribution), destination)
})

test('decorateDestinationUrl returns an unparseable destination unchanged', () => {
  const destination = 'not a valid destination'
  assert.equal(decorateDestinationUrl(destination, attribution), destination)
})

test('an untitled campaign omits utm_campaign but keeps the other three keys', () => {
  const decorated = decorateDestinationUrl('https://shop.example/product', {
    campaign: null,
    placementCode: 'abc123',
  })
  const url = new URL(decorated)
  assert.equal(url.searchParams.has('utm_campaign'), false)
  assert.equal(url.searchParams.get('utm_source'), 'posterlytics')
  assert.equal(url.searchParams.get('utm_medium'), 'qr')
  assert.equal(url.searchParams.get('utm_content'), 'abc123')
  // Never a squatted empty key.
  assert.doesNotMatch(decorated, /utm_campaign=/)
  assert.doesNotMatch(decorated, /utm_campaign=null/)

  // A blank or whitespace-only title behaves identically.
  for (const campaign of ['', '   ']) {
    const blank = decorateDestinationUrl('https://shop.example/product', {
      campaign,
      placementCode: 'abc123',
    })
    assert.equal(blank, decorated)
  }
})

test('omitting utm_campaign still leaves Amazon attribution bytes unreserialized', () => {
  const amazon = 'https://www.amazon.com/dp/B0EXAMPLE?maas=x%2Fy&ascsubtag=z'
  const decorated = decorateDestinationUrl(amazon, {
    campaign: null,
    placementCode: 'abc123',
  })
  assert.ok(decorated.startsWith(`${amazon}&`))
  assert.match(decorated, /maas=x%2Fy/)
  assert.equal(decorated.includes('utm_campaign'), false)
})
