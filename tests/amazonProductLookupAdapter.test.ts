import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  AmazonProductLookupRequestError,
  lookupAmazonProductTitle,
} from '../src/lib/amazonProductLookup.ts'

const responses = JSON.parse(readFileSync(
  new URL('./fixtures/amazon-product/lookup-responses.json', import.meta.url),
  'utf8',
)) as Record<string, unknown>

test('Amazon lookup adapter sends the URL with the caller signal and normalizes found data', async () => {
  const controller = new AbortController()
  let captured: RequestInit | null = null
  const result = await lookupAmazonProductTitle({
    url: 'https://www.amazon.com/dp/B0TITLE001?tag=seller-20',
    signal: controller.signal,
    transport: async (init) => {
      captured = init
      return jsonResponse(responses.found)
    },
  })

  assert.deepEqual(result, responses.found)
  assert.equal(captured?.method, 'POST')
  assert.equal(captured?.signal, controller.signal)
  assert.deepEqual(JSON.parse(String(captured?.body)), {
    url: 'https://www.amazon.com/dp/B0TITLE001?tag=seller-20',
  })
})

test('Amazon lookup adapter preserves the explicit unavailable result', async () => {
  assert.deepEqual(
    await lookupAmazonProductTitle({
      url: 'https://www.amazon.com/dp/B0TITLE001',
      transport: async () => jsonResponse(responses.unavailable),
    }),
    { status: 'unavailable' },
  )
})

test('Amazon lookup adapter exposes sanitized server errors and rejects malformed success bodies', async () => {
  await assert.rejects(
    lookupAmazonProductTitle({
      url: 'https://www.amazon.com/dp/B0TITLE001',
      transport: async () => jsonResponse(responses.rateLimited, 429),
    }),
    (error: unknown) =>
      error instanceof AmazonProductLookupRequestError
      && error.status === 429
      && error.code === 'rate_limited'
      && error.retryable,
  )

  for (const body of [
    null,
    { status: 'found', title: '' },
    { status: 'found', title: 'Robot Check' },
    { status: 'future' },
  ]) {
    await assert.rejects(
      lookupAmazonProductTitle({
        url: 'https://www.amazon.com/dp/B0TITLE001',
        transport: async () => jsonResponse(body),
      }),
      (error: unknown) =>
        error instanceof AmazonProductLookupRequestError
        && error.code === 'invalid_amazon_product_lookup_response',
    )
  }
})

test('Amazon lookup adapter leaves aborts intact for stale-request handling', async () => {
  const aborted = new DOMException('aborted', 'AbortError')
  await assert.rejects(
    lookupAmazonProductTitle({
      url: 'https://www.amazon.com/dp/B0TITLE001',
      transport: async () => {
        throw aborted
      },
    }),
    (error: unknown) => error === aborted,
  )
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
