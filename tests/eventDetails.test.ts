import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractEventDetails, formatEventLines } from '../functions/_shared.ts'

// A realistic Luma event page: schema.org/Event JSON-LD + OG tags.
function lumaPage(ld: unknown, extraHead = ''): string {
  return `<!doctype html><html><head>
    <meta property="og:title" content="Founders Mixer · Luma">
    <meta property="og:image" content="https://images.lumacdn.com/cover.png">
    ${extraHead}
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
  </head><body></body></html>`
}

const offlineEvent = {
  '@context': 'https://schema.org',
  '@type': 'Event',
  name: 'Founders & Funders Mixer',
  startDate: '2026-07-04T18:30:00-07:00',
  endDate: '2026-07-04T21:00:00-07:00',
  eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
  location: {
    '@type': 'Place',
    name: 'The Grand Hall',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '123 Market St',
      addressLocality: 'San Francisco',
      addressRegion: 'CA',
      addressCountry: 'US',
    },
  },
  organizer: [
    { '@type': 'Organization', name: 'Userlens', url: 'https://luma.com/userlens' },
    { '@type': 'Person', name: 'Ada Lovelace' },
  ],
  image: 'https://images.lumacdn.com/1920.png',
  offers: { '@type': 'Offer', price: '0' },
}

test('parses a full offline Luma Event', () => {
  const ev = extractEventDetails(lumaPage(offlineEvent))
  assert.equal(ev.event_name, 'Founders & Funders Mixer')
  assert.equal(ev.starts_at, '2026-07-04T18:30:00-07:00')
  assert.equal(ev.ends_at, '2026-07-04T21:00:00-07:00')
  assert.equal(ev.tz_offset, '-07:00')
  assert.equal(ev.attendance_mode, 'offline')
  assert.equal(ev.location_name, 'The Grand Hall')
  assert.equal(ev.location_city, 'San Francisco')
  assert.equal(ev.location_region, 'CA')
  assert.equal(ev.host_name, 'Userlens')
  assert.deepEqual(ev.hosts, ['Userlens', 'Ada Lovelace'])
  assert.equal(ev.price_label, 'Free')
  assert.equal(ev.cover_image_url, 'https://images.lumacdn.com/1920.png')
})

test('formats logistics lines in the event local time', () => {
  const ev = extractEventDetails(lumaPage(offlineEvent))
  const lines = formatEventLines(ev)
  assert.equal(lines.date_line, 'Sat, Jul 4') // 2026-07-04 is a Saturday
  assert.equal(lines.time_line, '6:30 PM–9 PM GMT-07:00')
  assert.equal(lines.location_line, 'The Grand Hall · San Francisco')
  assert.equal(lines.host_line, 'Hosted by Userlens')
})

test('register-to-see-address exposes city only, never a fake street', () => {
  const hidden = {
    ...offlineEvent,
    location: { '@type': 'Place', address: 'Register to See Address' },
  }
  const ev = extractEventDetails(lumaPage(hidden))
  assert.equal(ev.address_hidden, true)
  assert.equal(ev.location_address, undefined)
  // With no city available the location line is empty rather than wrong.
  assert.equal(formatEventLines(ev).location_line, '')
})

test('online event renders "Online" for location', () => {
  const online = {
    ...offlineEvent,
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    location: { '@type': 'VirtualLocation', url: 'https://zoom.us/j/123' },
  }
  const ev = extractEventDetails(lumaPage(online))
  assert.equal(ev.attendance_mode, 'online')
  assert.equal(formatEventLines(ev).location_line, 'Online')
})

test('falls back to OG title when JSON-LD is absent', () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Solo Talk · Luma">
    <meta property="og:image" content="https://images.lumacdn.com/x.png">
  </head><body></body></html>`
  const ev = extractEventDetails(html)
  assert.equal(ev.event_name, 'Solo Talk')
  assert.equal(ev.cover_image_url, 'https://images.lumacdn.com/x.png')
})

test('handles @graph-wrapped Event and Z (UTC) offset', () => {
  const graph = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite' }, { '@type': 'Event', name: 'Webinar', startDate: '2026-01-01T09:00:00Z' }] }
  const ev = extractEventDetails(lumaPage(graph))
  assert.equal(ev.event_name, 'Webinar')
  assert.equal(ev.tz_offset, '+00:00')
  // Thu, Jan 1 2026 at 9 AM, no GMT suffix for UTC.
  const lines = formatEventLines(ev)
  assert.equal(lines.date_line, 'Thu, Jan 1')
  assert.equal(lines.time_line, '9 AM')
})

test('empty / junk HTML yields an empty object, never throws', () => {
  assert.deepEqual(extractEventDetails(''), {})
  assert.deepEqual(extractEventDetails('<html><body>no event</body></html>'), {})
})
