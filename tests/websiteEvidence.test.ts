import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BackendClient } from '../functions/_shared.ts'
import {
  discardUploadedAnalysisAssets,
  extractAssets,
  extractColors,
  rehost,
  rehostBrandAssets,
  uploadStyleBoard,
} from '../functions/_websiteEvidence.ts'

type StoredObject = { url: string; key: string }
type RemoveObject = (key: string) => Promise<unknown>
type UploadObject = (
  key: string,
  blob: Blob,
) => Promise<{ data: StoredObject | null; error: unknown }>

function storageClient({
  remove = async () => null,
  upload = async (key) => ({
    data: { url: `https://assets.example/${key}`, key },
    error: null,
  }),
}: {
  remove?: RemoveObject
  upload?: UploadObject
} = {}): BackendClient {
  return {
    storage: {
      from: (bucket: string) => {
        assert.equal(bucket, 'assets')
        return { remove, upload }
      },
    },
  } as unknown as BackendClient
}

test('asset extraction preserves image order and ranked deduplicated logo candidates', () => {
  const html = `
    <meta property="og:image" content="/hero.webp?size=large">
    <meta name="twitter:image" content="https://example.com/hero.webp?size=large">
    <script type="application/ld+json">{"logo":"/canonical-logo.svg"}</script>
    <link rel="brand-logo" href="/canonical-logo.svg">
    <meta property="og:logo" content="/social-logo.png">
    <img alt="Acme logo" src="/masthead-logo.webp">
    <header><img src="/header.svg"></header>
    <link rel="icon" href="/favicon.png">
    <link rel="apple-touch-icon" href="/apple-touch.png">
    <img src="/product-one.png">
    <img src="/product-one.png">
    <img src="/sprite.png">
    <img src="/product-two.jpg?size=2">
    <meta name="theme-color" content="#AbC123">
  `

  assert.deepEqual(extractAssets(html, 'https://example.com/catalog/item'), {
    logo: 'https://example.com/canonical-logo.svg',
    logoCandidates: [
      'https://example.com/canonical-logo.svg',
      'https://example.com/social-logo.png',
      'https://example.com/masthead-logo.webp',
      'https://example.com/header.svg',
      'https://example.com/apple-touch.png',
      'https://example.com/favicon.png',
    ],
    images: [
      'https://example.com/hero.webp?size=large',
      'https://example.com/product-one.png',
      'https://example.com/product-two.jpg?size=2',
    ],
    themeColor: '#AbC123',
  })
})

test('HTML color fallback deduplicates colors and orders them by frequency', () => {
  const html = `
    #FF5500 #ff5500 #FF5500
    #0066CC #0066cc
    #22AA77
    #777777 #000000 #ffffff
  `

  assert.deepEqual(extractColors(html), ['#ff5500', '#0066cc', '#22aa77'])
  assert.deepEqual(extractColors(''), [])
})

test('brand rehosting skips an SVG logo and preserves generation-scoped key order', async () => {
  const originalFetch = globalThis.fetch
  const fetched: string[] = []
  const storageCalls: string[] = []
  const responses = new Map<string, () => Response>([
    [
      'https://source.example/canonical.svg',
      () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
    ],
    [
      'https://source.example/masthead.png',
      () => new Response(Uint8Array.from([1, 2]), { headers: { 'content-type': 'image/png' } }),
    ],
    [
      'https://source.example/product.jpg',
      () => new Response(Uint8Array.from([3, 4]), { headers: { 'content-type': 'image/jpeg' } }),
    ],
    [
      'https://source.example/detail.webp',
      () => new Response(Uint8Array.from([5, 6]), { headers: { 'content-type': 'image/webp' } }),
    ],
  ])
  globalThis.fetch = async (input) => {
    const url = String(input)
    fetched.push(url)
    const response = responses.get(url)
    assert.ok(response, `unexpected fetch ${url}`)
    return response()
  }
  const client = storageClient({
    remove: async (key) => {
      storageCalls.push(`remove:${key}`)
      return null
    },
    upload: async (key) => {
      storageCalls.push(`upload:${key}`)
      return {
        data: { url: `https://assets.example/${key}`, key },
        error: null,
      }
    },
  })

  try {
    const brandAssets = await rehostBrandAssets(
      client,
      {
        logo: 'https://source.example/canonical.svg',
        logoCandidates: [
          'https://source.example/canonical.svg',
          'https://source.example/masthead.png',
          'https://source.example/unused.png',
        ],
        images: [
          'https://source.example/product.jpg',
          'https://source.example/detail.webp',
          'https://source.example/unused-product.png',
        ],
        themeColor: null,
      },
      'campaign-1',
      'generation-2',
    )

    assert.deepEqual(fetched, [
      'https://source.example/canonical.svg',
      'https://source.example/masthead.png',
      'https://source.example/product.jpg',
      'https://source.example/detail.webp',
    ])
    assert.deepEqual(storageCalls, [
      'remove:brand/campaign-1/generation-2/logo-2.png',
      'upload:brand/campaign-1/generation-2/logo-2.png',
      'remove:brand/campaign-1/generation-2/img-1.jpg',
      'upload:brand/campaign-1/generation-2/img-1.jpg',
      'remove:brand/campaign-1/generation-2/img-2.webp',
      'upload:brand/campaign-1/generation-2/img-2.webp',
    ])
    assert.deepEqual(brandAssets, {
      images: [
        {
          url: 'https://assets.example/brand/campaign-1/generation-2/img-1.jpg',
          key: 'brand/campaign-1/generation-2/img-1.jpg',
        },
        {
          url: 'https://assets.example/brand/campaign-1/generation-2/img-2.webp',
          key: 'brand/campaign-1/generation-2/img-2.webp',
        },
      ],
      logo_url: 'https://assets.example/brand/campaign-1/generation-2/logo-2.png',
      logo_key: 'brand/campaign-1/generation-2/logo-2.png',
      primary_image_url: 'https://assets.example/brand/campaign-1/generation-2/img-1.jpg',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rehost keeps the five-second timeout and rejects oversized or SVG logo payloads', async () => {
  const originalFetch = globalThis.fetch
  const originalSetTimeout = globalThis.setTimeout
  const timeoutValues: number[] = []
  const uploaded: string[] = []
  let response = () =>
    new Response(new Uint8Array(5_000_000), {
      headers: { 'content-type': 'image/png' },
    })
  globalThis.fetch = async () => response()
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    timeoutValues.push(timeout ?? 0)
    return originalSetTimeout(handler, timeout, ...args)
  }) as typeof setTimeout
  const client = storageClient({
    upload: async (key) => {
      uploaded.push(key)
      return {
        data: { url: `https://assets.example/${key}`, key },
        error: null,
      }
    },
  })

  try {
    assert.deepEqual(
      await rehost(client, 'https://source.example/exact.png', 'limits/exact'),
      {
        url: 'https://assets.example/limits/exact.png',
        key: 'limits/exact.png',
      },
    )

    response = () =>
      new Response(new Uint8Array(5_000_001), {
        headers: { 'content-type': 'image/png' },
      })
    assert.equal(
      await rehost(client, 'https://source.example/large.png', 'limits/large'),
      null,
    )

    response = () =>
      new Response('<svg/>', {
        headers: { 'content-type': 'image/svg+xml' },
      })
    assert.equal(
      await rehost(
        client,
        'https://source.example/logo.svg',
        'limits/logo',
        { rasterOnly: true },
      ),
      null,
    )

    assert.deepEqual(timeoutValues, [5000, 5000, 5000])
    assert.deepEqual(uploaded, ['limits/exact.png'])
  } finally {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalSetTimeout
  }
})

test('style-board upload replaces inherited pointers at the generation key', async () => {
  const calls: Array<{ operation: string; key: string; type?: string; size?: number }> = []
  const key = 'style-board/campaign-1/generation-2/style-board.jpg'
  const client = storageClient({
    remove: async (removedKey) => {
      calls.push({ operation: 'remove', key: removedKey })
      return null
    },
    upload: async (uploadedKey, blob) => {
      calls.push({
        operation: 'upload',
        key: uploadedKey,
        type: blob.type,
        size: blob.size,
      })
      return {
        data: {
          url: 'https://assets.example/fresh-style-board.jpg',
          key: uploadedKey,
        },
        error: null,
      }
    },
  })

  const result = await uploadStyleBoard(
    client,
    'data:image/jpeg;base64,YWJj',
    'website',
    'https://assets.example/old-style-board.jpg',
    'style-board/old/style-board.jpg',
    'campaign-1',
    'generation-2',
  )

  assert.deepEqual(calls, [
    { operation: 'remove', key },
    { operation: 'upload', key, type: 'image/jpeg', size: 3 },
  ])
  assert.deepEqual(result, {
    screenshotUrl: 'https://assets.example/fresh-style-board.jpg',
    screenshotKey: key,
    uploadedStyleBoardKey: key,
  })
})

test('style-board upload retains inherited website pointers when no fresh board exists', async () => {
  const client = storageClient({
    remove: async () => {
      throw new Error('storage should not be called')
    },
    upload: async () => {
      throw new Error('storage should not be called')
    },
  })

  assert.deepEqual(
    await uploadStyleBoard(
      client,
      null,
      'website',
      'https://assets.example/old-style-board.jpg',
      'style-board/old/style-board.jpg',
      'campaign-1',
      'generation-2',
    ),
    {
      screenshotUrl: 'https://assets.example/old-style-board.jpg',
      screenshotKey: 'style-board/old/style-board.jpg',
      uploadedStyleBoardKey: null,
    },
  )
})

test('analysis asset cleanup removes every uploaded key and settles failures', async () => {
  const removed: string[] = []
  const client = storageClient({
    remove: async (key) => {
      removed.push(key)
      if (key.includes('logo')) throw new Error('already removed')
      return null
    },
  })

  await discardUploadedAnalysisAssets(
    client,
    'style-board/campaign-1/generation-2/style-board.jpg',
    {
      logo_url: 'https://assets.example/logo.png',
      logo_key: 'brand/campaign-1/generation-2/logo-1.png',
      images: [
        {
          url: 'https://assets.example/image-1.jpg',
          key: 'brand/campaign-1/generation-2/img-1.jpg',
        },
        {
          url: 'https://assets.example/image-2.webp',
          key: 'brand/campaign-1/generation-2/img-2.webp',
        },
      ],
      primary_image_url: 'https://assets.example/image-1.jpg',
    },
  )

  assert.deepEqual(removed, [
    'style-board/campaign-1/generation-2/style-board.jpg',
    'brand/campaign-1/generation-2/logo-1.png',
    'brand/campaign-1/generation-2/img-1.jpg',
    'brand/campaign-1/generation-2/img-2.webp',
  ])
})
