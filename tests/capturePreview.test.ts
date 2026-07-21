import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  MAX_CAPTURE_PREVIEW_COLORS,
  MAX_CAPTURE_PREVIEW_FONTS,
  MAX_CAPTURE_PREVIEW_IMAGES,
  mapCapturePreview,
  parseCapturePreviewRequest,
  validateCapturePreviewRequest,
} from '../functions/_capturePreview.ts'
import {
  MAX_CAPTURE_PREVIEW_RETRY_AFTER_SECONDS,
  mapCapturePreviewRateLimit,
} from '../functions/_captureRateLimit.ts'
import {
  acquireProductPreviewSource,
  acquireProductSourceWithoutCapture,
  resolveProductSourceMode,
  type ProductSourceAcquisition,
} from '../functions/_sourceAcquisition.ts'
import { resolveProductUseCaseRecipe } from '../functions/_useCasePolicy.ts'
import type {
  CaptureResult,
  DesignTokens,
} from '../functions/_shared.ts'

test('capture preview parses request fields and normalizes a website URL immutably', () => {
  const body = {
    url: ' Example.com/products/widget#details ',
    use_case: 'website_product',
  }
  const snapshot = { ...body }
  const parsed = parseCapturePreviewRequest(body)

  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.deepEqual(parsed.value, {
    url: body.url,
    useCase: 'website_product',
    colorScheme: 'light',
  })

  const validated = validateCapturePreviewRequest(parsed.value)
  assert.equal(validated.ok, true)
  if (!validated.ok) return
  assert.deepEqual(validated.value, {
    url: 'https://example.com/products/widget',
    useCase: 'website_product',
    colorScheme: 'light',
  })
  assert.deepEqual(body, snapshot)
})

test('capture preview rejects malformed bodies and invalid color schemes as bad requests', () => {
  assert.deepEqual(parseCapturePreviewRequest(null), {
    ok: false,
    status: 400,
    error: {
      code: 'invalid_request',
      message: 'The request body must be a JSON object.',
      retryable: false,
    },
  })
  assert.equal(
    parseCapturePreviewRequest({
      url: 'https://example.com',
      use_case: 'website_product',
      color_scheme: 'sepia',
    }).ok,
    false,
  )
})

test('capture preview rejects unsupported use cases, invalid URLs, and Amazon mismatches', () => {
  const wrongUseCase = validateCapturePreviewRequest({
    url: 'https://example.com/product',
    useCase: 'amazon_listing',
    colorScheme: 'light',
  })
  assert.equal(wrongUseCase.ok, false)
  if (!wrongUseCase.ok) {
    assert.equal(wrongUseCase.status, 422)
    assert.equal(wrongUseCase.error.code, 'unsupported_use_case')
  }

  const amazon = validateCapturePreviewRequest({
    url: 'amazon.com/dp/B0EXAMPLE1',
    useCase: 'website_product',
    colorScheme: 'light',
  })
  assert.equal(amazon.ok, false)
  if (!amazon.ok) {
    assert.equal(amazon.status, 422)
    assert.equal(amazon.error.code, 'use_case_source_mismatch')
  }

  const invalid = validateCapturePreviewRequest({
    url: '/relative-only',
    useCase: 'website_product',
    colorScheme: 'dark',
  })
  assert.equal(invalid.ok, false)
  if (!invalid.ok) {
    assert.equal(invalid.status, 422)
    assert.equal(invalid.error.code, 'invalid_source_url')
  }
})

test('capture preview leaves private-network enforcement to the capture service', () => {
  const validated = validateCapturePreviewRequest({
    url: 'http://127.0.0.1/internal',
    useCase: 'website_product',
    colorScheme: 'light',
  })

  assert.equal(validated.ok, true)
  if (validated.ok) {
    assert.equal(validated.value.url, 'http://127.0.0.1/internal')
  }
})

test('capture preview quota mapper accepts the RPC row and array shapes', () => {
  assert.deepEqual(
    mapCapturePreviewRateLimit(
      [{ allowed: true, retry_after_seconds: 0 }],
      null,
    ),
    { kind: 'allow' },
  )
  assert.deepEqual(
    mapCapturePreviewRateLimit(
      { allowed: true, retry_after_seconds: 0 },
      null,
    ),
    { kind: 'allow' },
  )
})

test('capture preview quota mapper returns a sanitized retryable 429 denial', () => {
  const decision = mapCapturePreviewRateLimit(
    [{ allowed: false, retry_after_seconds: 87 }],
    null,
  )

  assert.deepEqual(decision, {
    kind: 'deny',
    status: 429,
    error: {
      code: 'rate_limited',
      message: 'Website capture is temporarily limited. Try again shortly.',
      retryable: true,
    },
    retryAfterSeconds: 87,
  })
})

test('capture preview quota mapper bounds retry-after hints', () => {
  for (const [value, expected] of [
    [-5, 1],
    [0, 1],
    [1.2, 2],
    [MAX_CAPTURE_PREVIEW_RETRY_AFTER_SECONDS + 1, 86_400],
  ] as const) {
    const decision = mapCapturePreviewRateLimit(
      [{ allowed: false, retry_after_seconds: value }],
      null,
    )
    assert.equal(decision.kind, 'deny')
    if (decision.kind === 'deny') {
      assert.equal(decision.retryAfterSeconds, expected)
    }
  }
})

test('capture preview quota mapper fails closed without leaking RPC failures', () => {
  const sensitive = 'relation capture_preview_attempts does not exist at db:5432'
  for (const [data, error] of [
    [null, null],
    [[], null],
    [[{ allowed: true }, { allowed: true }], null],
    [[{ allowed: 'yes' }], null],
    [[{ allowed: true }], null],
    [[{ allowed: true, retry_after_seconds: 1 }], null],
    [[{ allowed: false }], null],
    [[{ allowed: false, retry_after_seconds: Number.POSITIVE_INFINITY }], null],
    [[{ allowed: false, retry_after_seconds: '60' }], null],
    [[{ allowed: true }], new Error(sensitive)],
  ] as const) {
    const decision = mapCapturePreviewRateLimit(data, error)
    assert.deepEqual(decision, {
      kind: 'unavailable',
      status: 503,
      error: {
        code: 'capture_preview_unavailable',
        message: 'Website capture is temporarily unavailable.',
        retryable: true,
      },
    })
    if (decision.kind === 'unavailable') {
      assert.equal(decision.error.message.includes('db:5432'), false)
      assert.equal(decision.error.message.includes('relation'), false)
    }
  }
})

test('capture preview filters source image URLs and bounds immutable evidence', () => {
  const capture: CaptureResult = {
    tokens: designTokens(),
    styleBoardDataUrl: 'data:image/jpeg;base64,c3R5bGUtYm9hcmQ=',
    error: null,
  }
  const acquisition: ProductSourceAcquisition = {
    mode: 'website',
    html: `
      <meta property="og:image" content="data:image/png;base64,aW1hZ2U=">
      <meta name="twitter:image" content="https://user:secret@assets.example/private.png">
      <script type="application/ld+json">{"logo":"javascript:unsafe.png"}</script>
      <meta property="og:logo" content="https://assets.example/logo.png#mark">
      <img src="https://assets.example/product-1.png">
      <img src="https://assets.example/product-2.jpg">
      <img src="https://assets.example/product-3.webp">
      <img src="https://assets.example/product-4.png">
      <img src="https://assets.example/product-5.png">
    `,
    capture,
  }
  const snapshot = JSON.parse(JSON.stringify(acquisition))

  const response = mapCapturePreview(
    'https://example.com/products/widget',
    acquisition,
    previewMetadata('dark'),
  )

  assert.equal(response.preview.captureId, '10000000-0000-4000-8000-000000000001')
  assert.equal(response.preview.capturedAt, '2026-07-21T06:00:00.000Z')
  assert.equal(response.preview.colorScheme, 'dark')
  assert.deepEqual(response.preview.designTokens, capture.tokens)
  assert.equal(
    response.preview.styleBoardDataUrl,
    'data:image/jpeg;base64,c3R5bGUtYm9hcmQ=',
  )
  assert.equal(response.preview.logoUrl, 'https://assets.example/logo.png')
  assert.deepEqual(response.preview.imageUrls, [
    'https://assets.example/product-1.png',
    'https://assets.example/product-2.jpg',
    'https://assets.example/product-3.webp',
    'https://assets.example/product-4.png',
  ])
  assert.equal(response.preview.imageUrls.length, MAX_CAPTURE_PREVIEW_IMAGES)
  assert.deepEqual(response.preview.colors, [
    '#101010',
    '#112233',
    '#445566',
    '#778899',
    '#aabbcc',
    '#ddeeff',
  ])
  assert.equal(response.preview.colors.length, MAX_CAPTURE_PREVIEW_COLORS)
  assert.deepEqual(response.preview.fonts, ['Capture Display', 'Capture Text'])
  assert.equal(response.preview.fonts.length, MAX_CAPTURE_PREVIEW_FONTS)
  assert.deepEqual(acquisition, snapshot)
})

test('capture preview color preference is tokens, then theme color, then HTML colors', () => {
  const tokenResponse = mapCapturePreview(
    'https://example.com',
    acquisition({
      html: '<meta name="theme-color" content="#abcdef"> #ff5500 #ff5500',
      capture: {
        tokens: designTokens(),
        styleBoardDataUrl: null,
        error: null,
      },
    }),
    previewMetadata(),
  )
  assert.equal(tokenResponse.preview.colors[0], '#101010')
  assert.equal(tokenResponse.preview.colors.includes('#abcdef'), false)

  const themeResponse = mapCapturePreview(
    'https://example.com',
    acquisition({
      html: '<meta name="theme-color" content="#AbCdEf"> #ff5500 #ff5500',
    }),
    previewMetadata(),
  )
  assert.deepEqual(themeResponse.preview.colors, ['#abcdef'])

  const htmlResponse = mapCapturePreview(
    'https://example.com',
    acquisition({
      html: '#FF5500 #ff5500 #ff5500 #0066CC #0066cc #22AA77',
    }),
    previewMetadata(),
  )
  assert.deepEqual(
    htmlResponse.preview.colors,
    ['#ff5500', '#0066cc', '#22aa77'],
  )
})

test('capture preview preserves partial evidence and maps capture failures', () => {
  const response = mapCapturePreview(
    'http://127.0.0.1/internal',
    acquisition({
      html: '<img src="https://assets.example/partial.png">',
      capture: {
        tokens: null,
        styleBoardDataUrl: 'not-an-inline-image',
        error: {
          code: 'unsafe_target',
          message: 'Target resolves to a private network.',
          retryable: false,
        },
      },
    }),
    previewMetadata(),
  )

  assert.deepEqual(response.preview.imageUrls, [
    'https://assets.example/partial.png',
  ])
  assert.equal(response.preview.styleBoardDataUrl, null)
  assert.deepEqual(response.error, {
    code: 'unsafe_target',
    message: 'Website capture did not complete.',
    retryable: false,
  })

  const sensitiveMessage =
    'Playwright failed at https://posterlytics-capture.fly.dev:3000/capture'
  const networkFailure = mapCapturePreview(
    'https://example.com',
    acquisition({
      html: '',
      capture: {
        tokens: null,
        styleBoardDataUrl: null,
        error: {
          code: 'capture_network_error',
          message: sensitiveMessage,
          retryable: true,
        },
      },
    }),
    previewMetadata(),
  )
  assert.deepEqual(networkFailure.error, {
    code: 'capture_network_error',
    message: 'Website capture was unavailable.',
    retryable: true,
  })
  assert.equal(networkFailure.error?.message.includes('fly.dev'), false)
  assert.equal(networkFailure.error?.message.includes('Playwright'), false)
  assert.equal(networkFailure.error?.message.includes(':3000'), false)

  const missingCapture = mapCapturePreview(
    'https://example.com',
    {
      mode: 'website',
      html: '',
      capture: null,
    },
    previewMetadata(),
  )
  assert.equal(missingCapture.error?.code, 'capture_unavailable')
  assert.equal(missingCapture.preview.captureId, null)
  assert.equal(missingCapture.preview.capturedAt, null)
  assert.equal(missingCapture.preview.designTokens, null)
})

test('preview acquisition captures before HTML fetch', async () => {
  const calls: string[] = []
  const result = await acquireProductPreviewSource(
    'https://example.com/product',
    'dark',
    resolveProductUseCaseRecipe('website_product'),
    {
      capture: async (url, colorScheme) => {
        calls.push(`capture:${url}:${colorScheme}`)
        return successfulCapture()
      },
      fetchHtml: async (url) => {
        calls.push(`fetch:${url}`)
        return '<html>captured</html>'
      },
    },
  )

  assert.deepEqual(calls, [
    'capture:https://example.com/product:dark',
    'fetch:https://example.com/product',
  ])
  assert.equal(result.html, '<html>captured</html>')
  assert.equal(result.capture?.error, null)
})

test('preview acquisition skips HTML fetch after a capture failure', async () => {
  const calls: string[] = []
  const captureFailure: CaptureResult = {
    tokens: null,
    styleBoardDataUrl: null,
    error: {
      code: 'unsafe_target',
      message: 'Target resolves to a private network.',
      retryable: false,
    },
  }
  const result = await acquireProductPreviewSource(
    'http://127.0.0.1/internal',
    'light',
    resolveProductUseCaseRecipe('website_product'),
    {
      capture: async () => {
        calls.push('capture')
        return captureFailure
      },
      fetchHtml: async () => {
        calls.push('fetch')
        return '<html>must not be fetched</html>'
      },
    },
  )

  assert.deepEqual(calls, ['capture'])
  assert.deepEqual(result, {
    mode: 'website',
    html: '',
    capture: captureFailure,
  })
})

test('eager source acquisition fetches HTML without calling capture', async () => {
  const calls: string[] = []
  const result = await acquireProductSourceWithoutCapture(
    'https://example.com/product',
    resolveProductUseCaseRecipe('website_product'),
    {
      capture: async () => {
        calls.push('capture')
        return successfulCapture()
      },
      fetchHtml: async (url) => {
        calls.push(`fetch:${url}`)
        return '<html>fresh copy</html>'
      },
    },
  )

  assert.deepEqual(calls, ['fetch:https://example.com/product'])
  assert.deepEqual(result, {
    mode: 'website',
    html: '<html>fresh copy</html>',
    capture: null,
  })
})

test('shared source-mode resolution preserves reference-only and Amazon guards', () => {
  assert.equal(
    resolveProductSourceMode(
      'https://example.com',
      resolveProductUseCaseRecipe('social_cover'),
    ),
    'reference-only',
  )
  assert.equal(
    resolveProductSourceMode(
      'https://www.amazon.com/dp/B0EXAMPLE1',
      resolveProductUseCaseRecipe('website_product'),
    ),
    'amazon-reference',
  )
  assert.equal(
    resolveProductSourceMode(
      'https://example.com',
      resolveProductUseCaseRecipe('amazon_listing'),
    ),
    'amazon-reference',
  )
})

test('capture preview handler enforces quota before acquisition without storage writes', () => {
  const source = readFileSync(
    new URL('../functions/capture-preview.ts', import.meta.url),
    'utf8',
  )
  const validation = source.indexOf(
    'const validated = validateCapturePreviewRequest',
  )
  const rateLimit = source.indexOf("'consume_capture_preview_quota'", validation)
  const acquisition = source.indexOf(
    'await acquireProductPreviewSource',
    rateLimit,
  )

  assert.ok(validation >= 0)
  assert.ok(rateLimit > validation)
  assert.ok(acquisition > rateLimit)
  for (const helper of ['rehost', 'rehostBrandAssets', 'uploadStyleBoard']) {
    assert.equal(source.includes(helper), false, helper)
  }
})

function acquisition({
  html,
  capture = successfulCapture(),
}: {
  html: string
  capture?: CaptureResult
}): ProductSourceAcquisition {
  return {
    mode: 'website',
    html,
    capture,
  }
}

function successfulCapture(): CaptureResult {
  return {
    tokens: null,
    styleBoardDataUrl: null,
    error: null,
  }
}

function previewMetadata(colorScheme: 'light' | 'dark' = 'light') {
  return {
    captureId: '10000000-0000-4000-8000-000000000001',
    capturedAt: '2026-07-21T06:00:00.000Z',
    colorScheme,
  } as const
}

function designTokens(): DesignTokens {
  return {
    typography: {
      headingFamily: 'Capture Display',
      bodyFamily: 'Capture Text',
      scale: [16, 24, 48],
      weights: [400, 700],
    },
    colors: {
      bg: '#f4f4f4',
      text: '#202020',
      primary: '#112233',
      accent: '#445566',
      palette: [
        '#778899',
        '#aabbcc',
        '#ddeeff',
        '#123456',
        '#654321',
      ],
      visualPalette: [
        { color: '#101010', proportion: 0.6 },
        { color: '#112233', proportion: 0.4 },
      ],
      theme: 'light',
    },
    radii: [4, 8],
    shadows: [],
    spacing: [8, 16, 24],
    button: null,
    fontLinks: [],
  }
}
