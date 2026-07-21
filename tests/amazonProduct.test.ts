import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  canonicalAmazonProductUrl,
  extractAmazonProductTitle,
  isAmazonBlockedContent,
  parseAmazonAsin,
  sanitizeAmazonProductTitle,
} from '../src/lib/amazonProduct.ts'

test('Amazon ASIN parsing accepts product paths and canonicalizes without source query bytes', () => {
  for (const [url, asin] of [
    ['https://www.amazon.com/dp/B0TITLE001?tag=seller-20#details', 'B0TITLE001'],
    ['http://amazon.com/gp/product/0123456789/ref=something', '0123456789'],
    ['https://www.amazon.com/gp/aw/d/b0title002', 'B0TITLE002'],
    ['https://www.amazon.com/exec/obidos/ASIN/B0TITLE003', 'B0TITLE003'],
  ] as const) {
    assert.equal(parseAmazonAsin(url), asin)
    assert.equal(
      canonicalAmazonProductUrl(asin),
      `https://www.amazon.com/dp/${asin}`,
    )
  }
})

test('Amazon ASIN parsing rejects short links, lookalikes, credentials, and malformed identifiers', () => {
  for (const value of [
    'B0TITLE001',
    'https://a.co/d/short-link',
    'https://amazon.com.evil.example/dp/B0TITLE001',
    'https://user:secret@www.amazon.com/dp/B0TITLE001',
    'https://smile.amazon.com/dp/B0TITLE001',
    'https://www.amazon.com/dp/B0SHORT',
    'https://www.amazon.com/search?asin=B0TITLE001',
    'javascript:https://www.amazon.com/dp/B0TITLE001',
  ]) {
    assert.equal(parseAmazonAsin(value), null, value)
  }
  assert.equal(canonicalAmazonProductUrl('not-an-asin'), null)
})

test('Amazon title extraction prefers productTitle, then Product JSON-LD, then Open Graph', () => {
  assert.equal(
    extractAmazonProductTitle(fixture('product-title.html')),
    'Northstar & Co. Portable Signal Lamp',
  )
  assert.equal(
    extractAmazonProductTitle(fixture('json-ld.html')),
    'Northstar Field Lamp & Charging Stand',
  )
  assert.equal(
    extractAmazonProductTitle(fixture('open-graph.html')),
    'Northstar Compact Lamp "Studio Edition"',
  )
})

test('Amazon title extraction ignores malformed JSON-LD and uses lower-priority evidence', () => {
  assert.equal(
    extractAmazonProductTitle(`
      <script type="application/ld+json">{"@type":"Product",}</script>
      <meta property="og:title" content="Fallback product title">
    `),
    'Fallback product title',
  )
})

test('Amazon CAPTCHA and automated-access block pages reject every embedded title', () => {
  for (const name of ['captcha.html', 'blocked.html']) {
    const html = fixture(name)
    assert.equal(isAmazonBlockedContent(html), true)
    assert.equal(extractAmazonProductTitle(html), null)
  }

  for (const title of [
    'Robot Check',
    'Amazon.com',
    'Sorry! Something went wrong',
    'Enter the characters you see below',
  ]) {
    assert.equal(sanitizeAmazonProductTitle(title), null)
  }
})

test('Amazon title sanitization removes marketplace wrappers without damaging product colons', () => {
  assert.equal(
    sanitizeAmazonProductTitle(
      'Amazon.com: Honeywell LED Floor Lamp : Home & Kitchen',
    ),
    'Honeywell LED Floor Lamp',
  )
  assert.equal(sanitizeAmazonProductTitle('Amazon.com'), null)
  assert.equal(
    sanitizeAmazonProductTitle('Sony WH-1000XM5: Wireless Headphones'),
    'Sony WH-1000XM5: Wireless Headphones',
  )
})

function fixture(name: string): string {
  return readFileSync(
    new URL(`./fixtures/amazon-product/${name}`, import.meta.url),
    'utf8',
  )
}
