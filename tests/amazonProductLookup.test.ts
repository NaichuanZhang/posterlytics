import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  MAX_AMAZON_PRODUCT_HTML_BYTES,
  fetchAmazonProductPage,
  lookupAmazonProductTitle,
  validateAmazonProductLookupRequest,
} from '../functions/_amazonProductLookup.ts'
import {
  createAmazonProductLookupHandler,
} from '../functions/amazon-product-lookup.ts'
import { extractAmazonProductTitle } from '../src/lib/amazonProduct.ts'
import type { CaptureResult } from '../functions/_shared.ts'

const ASIN = 'B0TITLE001'
const CANONICAL_URL = `https://www.amazon.com/dp/${ASIN}`
const resolvePublic = async () => ['54.239.28.85']

test('Amazon lookup source remains independent from generation acquisition and recipes', () => {
  for (const path of [
    '../functions/_amazonProductLookup.ts',
    '../functions/amazon-product-lookup.ts',
    '../src/lib/amazonProductLookup.ts',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.doesNotMatch(
      source,
      /_sourceAcquisition|AMAZON_RECIPE|resolveProductUseCaseRecipe|from ['"].*analyze/,
      path,
    )
  }
})

test('Amazon lookup validation accepts an ASIN URL and rejects malformed request shapes', () => {
  assert.deepEqual(
    validateAmazonProductLookupRequest({
      url: ` https://amazon.com/gp/product/${ASIN}?tag=seller-20 `,
    }),
    {
      ok: true,
      value: {
        asin: ASIN,
        canonicalUrl: CANONICAL_URL,
      },
    },
  )

  const malformed = validateAmazonProductLookupRequest({ url: 42 })
  assert.equal(malformed.ok, false)
  if (!malformed.ok) assert.equal(malformed.status, 400)

  for (const url of [
    'https://a.co/d/short-link',
    'https://amazon.com.evil.example/dp/B0TITLE001',
    'https://www.amazon.com/dp/short',
  ]) {
    const invalid = validateAmazonProductLookupRequest({ url })
    assert.equal(invalid.ok, false)
    if (!invalid.ok) {
      assert.equal(invalid.status, 422)
      assert.equal(invalid.error.code, 'invalid_amazon_product_url')
    }
  }
})

test('Amazon HTML fetch uses the canonical URL and validates each redirect before requesting it', async () => {
  const calls: string[] = []
  const page = await fetchAmazonProductPage(CANONICAL_URL, ASIN, {
    resolveHostname: resolvePublic,
    fetchImpl: async (url) => {
      calls.push(String(url))
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: {
            location: `/dp/${ASIN}?ref_=canonical`,
          },
        })
      }
      return htmlResponse(fixture('product-title.html'))
    },
  })

  assert.deepEqual(calls, [
    CANONICAL_URL,
    `${CANONICAL_URL}?ref_=canonical`,
  ])
  assert.equal(page.finalUrl, `${CANONICAL_URL}?ref_=canonical`)
  assert.match(page.html, /Northstar/)
})

test('Amazon HTML fetch blocks unsafe redirect DNS before the second request', async () => {
  for (const privateAddress of ['127.0.0.1', '::1']) {
    let dnsCalls = 0
    let fetchCalls = 0

    await assert.rejects(
      fetchAmazonProductPage(CANONICAL_URL, ASIN, {
        resolveHostname: async () => {
          dnsCalls += 1
          return dnsCalls === 1 ? ['54.239.28.85'] : [privateAddress]
        },
        fetchImpl: async () => {
          fetchCalls += 1
          return new Response(null, {
            status: 302,
            headers: { location: `${CANONICAL_URL}?hop=2` },
          })
        },
      }),
    )

    assert.equal(dnsCalls, 2)
    assert.equal(fetchCalls, 1)
  }
})

test('Amazon HTML fetch rejects unsafe redirects and ASIN changes', async () => {
  let fetchCalls = 0
  await assert.rejects(
    fetchAmazonProductPage(CANONICAL_URL, ASIN, {
      resolveHostname: resolvePublic,
      fetchImpl: async () => {
        fetchCalls += 1
        return new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example/private' },
        })
      },
    }),
  )
  assert.equal(fetchCalls, 1)

  await assert.rejects(
    fetchAmazonProductPage(CANONICAL_URL, ASIN, {
      resolveHostname: resolvePublic,
      fetchImpl: async (url) => String(url) === CANONICAL_URL
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://www.amazon.com/dp/B0TITLE999' },
          })
        : htmlResponse(fixture('product-title.html')),
    }),
  )
})

test('Amazon HTML fetch truncates at the exact byte cap and cancels the stream', async () => {
  const retainedPrefix =
    '<html><body><span id="productTitle">Early Product Title</span>'
  const maxBytes = retainedPrefix.length
  const body = `${retainedPrefix}${'x'.repeat(64)}</body></html>`
  const encodedBody = new TextEncoder().encode(body)
  let streamCancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encodedBody)
    },
    cancel() {
      streamCancelled = true
    },
  })

  const result = await fetchAmazonProductPage(CANONICAL_URL, ASIN, {
    resolveHostname: resolvePublic,
    maxBytes,
    fetchImpl: async () => new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': String(encodedBody.byteLength),
      },
    }),
  })

  assert.equal(result.html.length, maxBytes)
  assert.equal(result.html, body.slice(0, maxBytes))
  assert.equal(extractAmazonProductTitle(result.html), 'Early Product Title')
  assert.equal(streamCancelled, true)
})

test('Amazon lookup finds a title in an oversized retained prefix without capture', async () => {
  const documentStart = '<html><body>'
  const titleOffset = 446_000
  const beforeTitle =
    documentStart + 'x'.repeat(titleOffset - documentStart.length)
  const titleMarkup =
    '<span id="productTitle">Real Product Name</span>'
  const body = beforeTitle
    + titleMarkup
    + 'x'.repeat(
      MAX_AMAZON_PRODUCT_HTML_BYTES
        - beforeTitle.length
        - titleMarkup.length
        + 128,
    )
    + '</body></html>'

  assert.equal(body.indexOf(titleMarkup), titleOffset)
  assert.ok(body.length > MAX_AMAZON_PRODUCT_HTML_BYTES)

  const result = await lookupAmazonProductTitle(
    { asin: ASIN, canonicalUrl: CANONICAL_URL },
    {
      resolveHostname: resolvePublic,
      fetchImpl: async () => htmlResponse(body),
      capture: async () => {
        throw new Error('Capture unavailable.')
      },
    },
  )

  assert.deepEqual(result, {
    status: 'found',
    title: 'Real Product Name',
  })
})

test('Amazon lookup treats an oversized CAPTCHA prefix as unavailable', async () => {
  const captcha = fixture('captcha.html')
  const body = captcha
    + 'x'.repeat(MAX_AMAZON_PRODUCT_HTML_BYTES - captcha.length + 128)

  assert.ok(body.length > MAX_AMAZON_PRODUCT_HTML_BYTES)

  const result = await lookupAmazonProductTitle(
    { asin: ASIN, canonicalUrl: CANONICAL_URL },
    {
      resolveHostname: resolvePublic,
      fetchImpl: async () => htmlResponse(body),
      capture: async () => {
        throw new Error('Capture unavailable.')
      },
    },
  )

  assert.deepEqual(result, { status: 'unavailable' })
})

test('Amazon lookup prefers HTML title evidence while starting capture concurrently', async () => {
  let releaseFetch: ((response: Response) => void) | null = null
  let captureStarted = false
  const pending = lookupAmazonProductTitle(
    { asin: ASIN, canonicalUrl: CANONICAL_URL },
    {
      resolveHostname: resolvePublic,
      fetchImpl: async () => await new Promise<Response>((resolve) => {
        releaseFetch = resolve
      }),
      capture: async () => {
        captureStarted = true
        return successfulCapture('Lower priority capture title')
      },
    },
  )

  await waitFor(() => releaseFetch !== null)
  assert.equal(captureStarted, true)
  releaseFetch!(htmlResponse(fixture('product-title.html')))

  assert.deepEqual(await pending, {
    status: 'found',
    title: 'Northstar & Co. Portable Signal Lamp',
  })
})

test('Amazon lookup uses capture title only for the same final ASIN', async () => {
  const fallback = await lookupAmazonProductTitle(
    { asin: ASIN, canonicalUrl: CANONICAL_URL },
    {
      resolveHostname: resolvePublic,
      fetchImpl: async () => htmlResponse(fixture('captcha.html')),
      capture: async () => successfulCapture('Capture fallback product title'),
    },
  )
  assert.deepEqual(fallback, {
    status: 'found',
    title: 'Capture fallback product title',
  })

  for (const capture of [
    successfulCapture(
      'Wrong product title',
      'https://www.amazon.com/dp/B0TITLE999',
    ),
    successfulCapture('Robot Check'),
    {
      tokens: null,
      styleBoardDataUrl: null,
      error: {
        code: 'capture_timeout',
        message: 'internal host details',
        retryable: true,
      },
    },
  ] satisfies CaptureResult[]) {
    const result = await lookupAmazonProductTitle(
      { asin: ASIN, canonicalUrl: CANONICAL_URL },
      {
        resolveHostname: resolvePublic,
        fetchImpl: async () => htmlResponse(fixture('blocked.html')),
        capture: async () => capture,
      },
    )
    assert.deepEqual(result, { status: 'unavailable' })
  }
})

test('Amazon lookup endpoint authenticates, validates, consumes quota, then looks up', async () => {
  const calls: string[] = []
  const handler = createAmazonProductLookupHandler({
    createClient: () => ({
      auth: {
        getCurrentUser: async () => {
          calls.push('auth')
          return { data: { user: { id: 'user-1' } } }
        },
      },
      database: {
        rpc: async (name) => {
          calls.push(`rpc:${name}`)
          return {
            data: [{ allowed: true, retry_after_seconds: 0 }],
            error: null,
          }
        },
      },
    }),
    lookup: async (request) => {
      calls.push(`lookup:${request.asin}`)
      return { status: 'found', title: 'Sanitized product title' }
    },
  })

  const response = await handler(postRequest({ url: CANONICAL_URL }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    status: 'found',
    title: 'Sanitized product title',
  })
  assert.deepEqual(calls, [
    'auth',
    'rpc:consume_capture_preview_quota',
    `lookup:${ASIN}`,
  ])
})

test('Amazon lookup endpoint returns only the approved sanitized status surface', async () => {
  const unauthorized = createAmazonProductLookupHandler({
    createClient: () => fakeClient(null),
  })
  assert.equal((await unauthorized(postRequest({ url: CANONICAL_URL }))).status, 401)

  const allowed = fakeClient('user-1')
  const handler = createAmazonProductLookupHandler({
    createClient: () => allowed,
    lookup: async () => {
      throw new Error('secret upstream host:5432')
    },
  })
  const invalidJson = await handler(new Request('https://functions.example/lookup', {
    method: 'POST',
    body: '{',
    headers: { 'Content-Type': 'application/json' },
  }))
  assert.equal(invalidJson.status, 400)
  assert.equal((await handler(postRequest({ url: 'https://a.co/d/short' }))).status, 422)

  const unavailable = await handler(postRequest({ url: CANONICAL_URL }))
  assert.equal(unavailable.status, 200)
  assert.deepEqual(await unavailable.json(), { status: 'unavailable' })

  const method = await handler(new Request('https://functions.example/lookup'))
  assert.equal(method.status, 405)
  assert.equal(method.headers.get('Allow'), 'POST, OPTIONS')
})

test('Amazon lookup endpoint fails closed on quota denial and RPC errors without leaks', async () => {
  let lookupCalls = 0
  const limited = createAmazonProductLookupHandler({
    createClient: () => fakeClient('user-1', {
      data: [{ allowed: false, retry_after_seconds: 27 }],
      error: null,
    }),
    lookup: async () => {
      lookupCalls += 1
      return { status: 'unavailable' }
    },
  })
  const limitedResponse = await limited(postRequest({ url: CANONICAL_URL }))
  assert.equal(limitedResponse.status, 429)
  assert.equal(limitedResponse.headers.get('Retry-After'), '27')
  assert.equal(lookupCalls, 0)

  const sensitive = 'relation capture_preview_attempts at database.internal:5432'
  const unavailable = createAmazonProductLookupHandler({
    createClient: () => fakeClient('user-1', {
      data: null,
      error: new Error(sensitive),
    }),
  })
  const unavailableResponse = await unavailable(postRequest({ url: CANONICAL_URL }))
  assert.equal(unavailableResponse.status, 503)
  assert.equal((await unavailableResponse.text()).includes(sensitive), false)
})

function successfulCapture(
  pageTitle: string,
  finalUrl = CANONICAL_URL,
): CaptureResult {
  return {
    tokens: null,
    styleBoardDataUrl: null,
    pageTitle,
    finalUrl,
    error: null,
  }
}

function fakeClient(
  userId: string | null,
  quota = {
    data: [{ allowed: true, retry_after_seconds: 0 }],
    error: null as unknown,
  },
) {
  return {
    auth: {
      getCurrentUser: async () => ({
        data: userId ? { user: { id: userId } } : { user: null },
      }),
    },
    database: {
      rpc: async () => quota,
    },
  }
}

function postRequest(body: unknown): Request {
  return new Request('https://functions.example/amazon-product-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

function fixture(name: string): string {
  return readFileSync(
    new URL(`./fixtures/amazon-product/${name}`, import.meta.url),
    'utf8',
  )
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for test state.')
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
