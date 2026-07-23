import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GEO_LOOKUP_TIMEOUT_MS,
  forwardedClientIp,
  geoFromHeaders,
  geoFromProviderPayload,
  resolveRequestGeo,
  resolveRequestGeoDetailed,
} from '../functions/_shared.ts'

test('geoFromHeaders prefers hosting geo and decodes the paired city', () => {
  const headers = new Headers({
    'cf-ipcountry': 'us',
    'cf-ipcity': 'New%20York',
    'x-vercel-ip-country': 'CA',
  })

  assert.deepEqual(geoFromHeaders(headers), {
    country: 'US',
    city: 'New York',
  })
})

test('geoFromHeaders rejects CDN unknown-country sentinels', () => {
  assert.equal(geoFromHeaders(new Headers({ 'cf-ipcountry': 'XX' })), null)
  assert.equal(geoFromHeaders(new Headers({ 'cf-ipcountry': 'T1' })), null)
})

test('forwardedClientIp uses trusted proxy headers before the forwarded chain', () => {
  const headers = new Headers({
    'cf-connecting-ip': '2001:4860:4860::8888',
    'x-forwarded-for': '8.8.8.8, 10.0.0.1',
  })

  assert.equal(forwardedClientIp(headers), '2001:4860:4860::8888')
  assert.equal(
    forwardedClientIp(new Headers({ 'x-forwarded-for': '8.8.4.4, 10.0.0.1' })),
    '8.8.4.4',
  )
  assert.equal(forwardedClientIp(new Headers({ 'x-forwarded-for': 'not-an-ip' })), null)
})

test('geoFromProviderPayload keeps only coarse validated fields', () => {
  assert.deepEqual(
    geoFromProviderPayload({
      success: true,
      country_code: 'de',
      city: 'Berlin',
      latitude: 52.52,
      longitude: 13.405,
      ip: '8.8.8.8',
    }),
    { country: 'DE', city: 'Berlin' },
  )
  assert.equal(geoFromProviderPayload({ success: false, country_code: 'US' }), null)
  assert.equal(geoFromProviderPayload({ success: true, country_code: 'Unknown' }), null)
})

test('resolveRequestGeo skips the provider when CDN geo is available', async () => {
  let calls = 0
  const geo = await resolveRequestGeo(
    new Headers({ 'cf-ipcountry': 'GB' }),
    async () => {
      calls += 1
      throw new Error('provider should not be called')
    },
  )

  assert.deepEqual(geo, { country: 'GB', city: null })
  assert.equal(calls, 0)
})

test('resolveRequestGeo requests only country and city for the forwarded address', async () => {
  let requestedUrl = ''
  const resolution = await resolveRequestGeoDetailed(
    new Headers({ 'x-forwarded-for': '8.8.4.4, 10.0.0.1' }),
    async (input) => {
      requestedUrl = input
      return new Response(JSON.stringify({
        success: true,
        country_code: 'US',
        city: 'Mountain View',
      }))
    },
  )

  assert.deepEqual(resolution.geo, { country: 'US', city: 'Mountain View' })
  assert.equal(resolution.source, 'ipwhois')
  assert.equal(resolution.outcome, 'resolved')
  assert.ok(resolution.durationMs >= 0)
  assert.match(requestedUrl, /^https:\/\/ipwho\.is\/8\.8\.4\.4\?fields=success,country_code,city$/)
  assert.doesNotMatch(JSON.stringify(resolution), /8\.8\.4\.4/)
  assert.deepEqual(Object.keys(resolution).sort(), [
    'durationMs',
    'geo',
    'outcome',
    'source',
  ])
})

test('resolveRequestGeoDetailed reports a missing forwarded address without fetching', async () => {
  let calls = 0
  const resolution = await resolveRequestGeoDetailed(
    new Headers(),
    async () => {
      calls += 1
      throw new Error('provider should not be called')
    },
  )

  assert.deepEqual(resolution.geo, { country: null, city: null })
  assert.equal(resolution.source, 'none')
  assert.equal(resolution.outcome, 'missing_ip')
  assert.equal(calls, 0)
})

test('resolveRequestGeoDetailed classifies provider HTTP failures', async () => {
  const resolution = await resolveRequestGeoDetailed(
    new Headers({ 'x-forwarded-for': '8.8.8.8' }),
    async () => new Response(null, { status: 429 }),
  )

  assert.deepEqual(resolution.geo, { country: null, city: null })
  assert.equal(resolution.source, 'ipwhois')
  assert.equal(resolution.outcome, 'http_error')
  assert.equal(resolution.upstreamStatus, 429)
})

test('resolveRequestGeoDetailed classifies invalid provider payloads', async () => {
  const resolution = await resolveRequestGeoDetailed(
    new Headers({ 'x-forwarded-for': '8.8.8.8' }),
    async () => new Response(JSON.stringify({
      success: true,
      country_code: 'Unknown',
      ip: '8.8.8.8',
    })),
  )

  assert.deepEqual(resolution.geo, { country: null, city: null })
  assert.equal(resolution.source, 'ipwhois')
  assert.equal(resolution.outcome, 'invalid_response')
  assert.doesNotMatch(JSON.stringify(resolution), /8\.8\.8\.8/)
})

test('resolveRequestGeoDetailed classifies provider request failures', async () => {
  const resolution = await resolveRequestGeoDetailed(
    new Headers({ 'x-forwarded-for': '8.8.8.8' }),
    async () => {
      throw new Error('network unavailable')
    },
  )

  assert.deepEqual(resolution.geo, { country: null, city: null })
  assert.equal(resolution.source, 'ipwhois')
  assert.equal(resolution.outcome, 'request_error')
})

test('resolveRequestGeo fails open when the provider exceeds its deadline', async () => {
  assert.equal(GEO_LOOKUP_TIMEOUT_MS, 800)
  assert.ok(GEO_LOOKUP_TIMEOUT_MS <= 2000)
  const resolution = await resolveRequestGeoDetailed(
    new Headers({ 'x-forwarded-for': '8.8.8.8' }),
    (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }),
    5,
  )

  assert.deepEqual(resolution.geo, { country: null, city: null })
  assert.equal(resolution.source, 'ipwhois')
  assert.equal(resolution.outcome, 'timeout')

  const geo = await resolveRequestGeo(
    new Headers({ 'x-forwarded-for': '8.8.8.8' }),
    (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }),
    5,
  )
  assert.deepEqual(geo, { country: null, city: null })
})
