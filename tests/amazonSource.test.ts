import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  acquireProductSource,
  resolveInheritedStyleBoard,
} from '../functions/_sourceAcquisition.ts'
import { resolveProductUseCaseRecipe } from '../functions/_useCasePolicy.ts'
import {
  AMAZON_SOURCE_HOSTS,
  classifyProductSourceUrl,
  getSourceUseCaseSwitchTarget,
  isAmazonSourceUrl,
} from '../src/lib/amazonSource.ts'

test('product source classification distinguishes empty, invalid, website, and Amazon URLs', () => {
  assert.equal(classifyProductSourceUrl('  '), 'empty')
  assert.equal(classifyProductSourceUrl('B0EXAMPLE1'), 'invalid')
  assert.equal(classifyProductSourceUrl('ftp://amazon.com/dp/B0EXAMPLE1'), 'invalid')
  assert.equal(classifyProductSourceUrl('https://example.com/product'), 'website')
  assert.equal(
    classifyProductSourceUrl(' https://www.amazon.com/dp/B0EXAMPLE1 '),
    'amazon',
  )
})

test('source mismatch helper offers only the safe opposite-use-case switches', () => {
  assert.equal(
    getSourceUseCaseSwitchTarget('website', 'amazon'),
    'amazon_listing',
  )
  assert.equal(
    getSourceUseCaseSwitchTarget('amazon', 'website'),
    'website_product',
  )
  assert.equal(getSourceUseCaseSwitchTarget('amazon', 'amazon'), null)
  assert.equal(getSourceUseCaseSwitchTarget('amazon', 'invalid'), null)
  assert.equal(getSourceUseCaseSwitchTarget('none', 'website'), null)
})

test('Amazon source classifier accepts only the supported exact hosts', () => {
  assert.deepEqual(AMAZON_SOURCE_HOSTS, [
    'amazon.com',
    'www.amazon.com',
    'a.co',
    'amzn.to',
    'amzn.asia',
    'amzn.eu',
  ])

  const accepted = [
    'https://amazon.com/dp/B0EXAMPLE1',
    'https://www.amazon.com/gp/product/B0EXAMPLE2',
    'https://a.co/d/example',
    'http://amzn.to/example',
    'https://amzn.asia/d/example',
    'https://amzn.eu/d/example',
  ]

  for (const url of accepted) {
    assert.equal(isAmazonSourceUrl(url), true, url)
  }
})

test('Amazon source classifier rejects lookalikes, unsupported regions, and bare ASINs', () => {
  const rejected = [
    'B0EXAMPLE1',
    'https://amazon.com.evil.example/dp/B0EXAMPLE1',
    'https://www.amazon.com.evil.example/dp/B0EXAMPLE1',
    'https://amazon.com@evil.example/dp/B0EXAMPLE1',
    'https://smile.amazon.com/dp/B0EXAMPLE1',
    'https://amazon.co.uk/dp/B0EXAMPLE1',
    'javascript:https://amazon.com/dp/B0EXAMPLE1',
  ]

  for (const url of rejected) {
    assert.equal(isAmazonSourceUrl(url), false, url)
  }
})

test('Amazon acquisition returns reference mode without raw fetch or capture I/O', async () => {
  let fetchCalls = 0
  let captureCalls = 0

  const acquisition = await acquireProductSource(
    'https://www.amazon.com/dp/B0EXAMPLE1',
    'light',
    resolveProductUseCaseRecipe('amazon_listing'),
    {
      fetchHtml: async () => {
        fetchCalls += 1
        return '<html>captcha</html>'
      },
      capture: async () => {
        captureCalls += 1
        return {
          tokens: null,
          styleBoardDataUrl: 'data:image/jpeg;base64,Y2FwdGNoYQ==',
          error: null,
        }
      },
    },
  )

  assert.deepEqual(acquisition, {
    mode: 'amazon-reference',
    html: '',
    capture: null,
  })
  assert.equal(fetchCalls, 0)
  assert.equal(captureCalls, 0)
})

test('reference-only acquisition performs no URL fetch or capture I/O', async () => {
  for (const useCase of ['social_cover', 'rednote_post'] as const) {
    let ioCalls = 0
    const acquisition = await acquireProductSource(
      '',
      'light',
      resolveProductUseCaseRecipe(useCase),
      {
        fetchHtml: async () => {
          ioCalls += 1
          return '<html>unexpected</html>'
        },
        capture: async () => {
          ioCalls += 1
          throw new Error('capture must not run')
        },
      },
    )

    assert.deepEqual(acquisition, {
      mode: 'reference-only',
      html: '',
      capture: null,
    })
    assert.equal(ioCalls, 0)
  }
})

test('ordinary website acquisition retains raw fetch and browser capture', async () => {
  const calls: string[] = []
  const captureResult = {
    tokens: null,
    styleBoardDataUrl: null,
    error: {
      code: 'capture_unconfigured',
      message: 'Capture service is not configured.',
      retryable: false,
    },
  }

  const acquisition = await acquireProductSource(
    'https://example.com/product',
    'dark',
    resolveProductUseCaseRecipe('website_product'),
    {
      fetchHtml: async (url) => {
        calls.push(`fetch:${url}`)
        return '<html>product</html>'
      },
      capture: async (url, colorScheme) => {
        calls.push(`capture:${url}:${colorScheme}`)
        return captureResult
      },
    },
  )

  assert.deepEqual(acquisition, {
    mode: 'website',
    html: '<html>product</html>',
    capture: captureResult,
  })
  assert.deepEqual(calls, [
    'fetch:https://example.com/product',
    'capture:https://example.com/product:dark',
  ])
})

test('recognized Amazon URLs never perform I/O even under website intent', async () => {
  let ioCalls = 0
  const acquisition = await acquireProductSource(
    'https://www.amazon.com/dp/B0EXAMPLE1',
    'light',
    resolveProductUseCaseRecipe('website_product'),
    {
      fetchHtml: async () => {
        ioCalls += 1
        return '<html>unsafe</html>'
      },
      capture: async () => {
        ioCalls += 1
        throw new Error('capture must not run')
      },
    },
  )

  assert.deepEqual(acquisition, {
    mode: 'amazon-reference',
    html: '',
    capture: null,
  })
  assert.equal(ioCalls, 0)
})

test('Amazon intent remains no-I/O if a caller reaches acquisition before rejection', async () => {
  let ioCalls = 0
  const acquisition = await acquireProductSource(
    'https://example.com/product',
    'light',
    resolveProductUseCaseRecipe('amazon_listing'),
    {
      fetchHtml: async () => {
        ioCalls += 1
        return '<html>unsafe</html>'
      },
      capture: async () => {
        ioCalls += 1
        throw new Error('capture must not run')
      },
    },
  )

  assert.equal(acquisition.mode, 'amazon-reference')
  assert.equal(ioCalls, 0)
})

test('Amazon refresh clears inherited style-board pointers without mutating them', () => {
  const inherited = {
    screenshotUrl: 'https://assets.example/style-board.jpg',
    screenshotKey: 'style-board/other-generation/style-board.jpg',
  }

  assert.deepEqual(
    resolveInheritedStyleBoard('amazon-reference', inherited),
    {
      screenshotUrl: null,
      screenshotKey: null,
    },
  )
  assert.deepEqual(inherited, {
    screenshotUrl: 'https://assets.example/style-board.jpg',
    screenshotKey: 'style-board/other-generation/style-board.jpg',
  })
})

test('social reference refresh clears inherited website style-board pointers', () => {
  assert.deepEqual(
    resolveInheritedStyleBoard('reference-only', {
      screenshotUrl: 'https://assets.example/old-style-board.jpg',
      screenshotKey: 'style-board/old.jpg',
    }),
    {
      screenshotUrl: null,
      screenshotKey: null,
    },
  )
})

test('ordinary website refresh retains inherited style-board pointers', () => {
  const inherited = {
    screenshotUrl: 'https://assets.example/style-board.jpg',
    screenshotKey: 'style-board/campaign/generation/style-board.jpg',
  }
  const resolved = resolveInheritedStyleBoard('website', inherited)

  assert.deepEqual(resolved, inherited)
  assert.notEqual(resolved, inherited)
})
