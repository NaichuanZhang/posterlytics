import assert from 'node:assert/strict'
import { test } from 'node:test'
import view, {
  handleViewRequest,
  resolveViewLocale,
  statusHtml,
} from '../functions/view.ts'
import type { RequestGeoResolution } from '../functions/_shared.ts'

const POSTERLYTICS_HOME = 'https://3f9q2998.insforge.site/'

test('view locale negotiation respects quality values and header order', () => {
  assert.equal(
    resolveViewLocale('en-US;q=0.4, zh-Hans-CN;q=0.9'),
    'zh-CN',
  )
  assert.equal(
    resolveViewLocale('zh-CN;q=0.4, en-GB;q=0.8'),
    'en-US',
  )
  assert.equal(
    resolveViewLocale('fr-FR;q=1, zh;q=0.7, en;q=0.5'),
    'zh-CN',
  )
  assert.equal(
    resolveViewLocale('en;q=0.8, zh;q=0.8'),
    'en-US',
  )
})

test('view locale negotiation maps Chinese variants to Simplified Chinese', () => {
  for (const language of [
    'zh',
    'zh-CN',
    'zh-Hans',
    'zh-Hans-CN',
    'zh-TW',
  ]) {
    assert.equal(resolveViewLocale(language), 'zh-CN', language)
  }
})

test('view locale negotiation ignores malformed or excluded ranges', () => {
  for (const header of [
    '',
    ',,,',
    'zh_CN',
    'zh-CN;q=invalid',
    'zh-CN;q=1.5',
    'zh-CN;q',
    'zh-CN;q=0',
  ]) {
    assert.equal(resolveViewLocale(header), 'en-US', header)
  }
  assert.equal(resolveViewLocale(null), 'en-US')
  assert.equal(
    resolveViewLocale('zh-CN;q=invalid, en-US;q=0.5'),
    'en-US',
  )
})

test('view locale negotiation falls back to English', () => {
  assert.equal(resolveViewLocale('fr-FR'), 'en-US')
  assert.equal(resolveViewLocale('de-DE, es;q=0.8'), 'en-US')
  assert.equal(resolveViewLocale('en-AU'), 'en-US')
  assert.equal(resolveViewLocale('*'), 'en-US')
})

test('view no-code response is visibly and semantically a localized 400', async () => {
  const response = await view(new Request('https://example.test/functions/view', {
    headers: {
      'Accept-Language': 'zh-Hans-CN, en;q=0.8',
    },
  }))
  const body = await response.text()

  assert.equal(response.status, 400)
  assert.equal(response.headers.get('Content-Language'), 'zh-CN')
  assert.equal(response.headers.get('Vary'), 'Accept-Language')
  assert.match(body, /<html lang="zh-CN">/)
  assert.match(body, /<title>追踪链接无效<\/title>/)
  assert.match(body, />400<\/h1>/)
  assert.match(body, /此追踪链接缺少识别码。/)
  assert.match(body, /前往 Posterlytics/)
  assert.match(body, new RegExp(`href="${POSTERLYTICS_HOME}"`))
})

test('view unknown-code response returns a visible 404 with recovery', async () => {
  const calls: string[] = []
  const response = await handleViewRequest(
    new Request('https://example.test/functions/view?code=unknown', {
      headers: { Cookie: 'plv=known-visitor' },
    }),
    testRuntime(async (name) => {
      calls.push(name)
      if (name === 'link_status') return { data: 'missing', error: null }
      return { data: null, error: null }
    }),
  )
  const body = await response.text()

  assert.equal(response.status, 404)
  assert.match(body, /<title>Link not found<\/title>/)
  assert.match(body, />404<\/h1>/)
  assert.match(body, /This link isn't active\./)
  assert.match(body, new RegExp(`href="${POSTERLYTICS_HOME}"`))
  assert.deepEqual(calls, ['log_visit_attributed', 'link_status'])
})

test('view preserves the tracked visit to 302 redirect contract', async () => {
  const calls: string[] = []
  const response = await handleViewRequest(
    new Request('https://example.test/functions/view?code=published', {
      headers: { Cookie: 'plv=known-visitor' },
    }),
    testRuntime(async (name) => {
      calls.push(name)
      return name === 'log_visit_attributed'
        ? { data: 'https://destination.example/product', error: null }
        : { data: null, error: null }
    }),
  )

  assert.equal(response.status, 302)
  assert.equal(
    response.headers.get('Location'),
    'https://destination.example/product',
  )
  assert.deepEqual(calls, ['log_visit_attributed'])
})

test('view geo logging cannot alter a successful redirect', async () => {
  let logCalls = 0
  const runtime = {
    ...testRuntime(async () => ({
      data: 'https://destination.example/product',
      error: null,
    })),
    logGeo: () => {
      logCalls += 1
      throw new Error('logging unavailable')
    },
  }
  const response = await handleViewRequest(
    new Request('https://example.test/functions/view?code=published', {
      headers: { Cookie: 'plv=known-visitor' },
    }),
    runtime,
  )

  assert.equal(response.status, 302)
  assert.equal(response.headers.get('Location'), 'https://destination.example/product')
  assert.equal(logCalls, 1)
})

test('view preserves the attributed, geo, and legacy visit RPC fallback order', async () => {
  const calls: Array<{
    name: string
    params: Record<string, unknown> | undefined
  }> = []
  const response = await handleViewRequest(
    new Request('https://example.test/functions/view?code=published', {
      headers: { Cookie: 'plv=known-visitor' },
    }),
    testRuntime(async (name, params) => {
      calls.push({ name, params })
      if (name === 'log_visit_attributed') {
        return { data: null, error: { message: 'not available' } }
      }
      if (params && Object.hasOwn(params, 'p_country')) {
        return { data: null, error: { message: 'geo contract not available' } }
      }
      return { data: 'https://destination.example/product', error: null }
    }),
  )

  assert.equal(response.status, 302)
  assert.deepEqual(calls.map((call) => call.name), [
    'log_visit_attributed',
    'log_visit',
    'log_visit',
  ])
  assert.equal(calls[0].params?.p_country, null)
  assert.equal(calls[1].params?.p_country, null)
  assert.equal(Object.hasOwn(calls[2].params ?? {}, 'p_country'), false)
})

test('view unpublished status copy remains localized and gains recovery', () => {
  const unpublished = statusHtml('unpublished', 'zh-CN')
  assert.match(unpublished, /<title>海报尚未发布<\/title>/)
  assert.match(
    unpublished,
    /此海报所属的推广活动尚未发布。发布后，该链接即可访问。/,
  )
  assert.match(unpublished, /前往 Posterlytics/)
  assert.match(unpublished, new RegExp(`href="${POSTERLYTICS_HOME}"`))
})

test('view status pages expose accessible recovery and byline styles', () => {
  const locales = ['en-US', 'zh-CN'] as const
  const kinds = ['invalid', 'missing', 'unpublished'] as const
  const recoveryStyle =
    'style="display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:11px 16px;box-sizing:border-box;margin-top:12px;color:#3d5f56;font-weight:650"'
  const bylineStyle =
    'style="font-size:.78rem;color:#5b5b5b;margin-top:18px"'

  for (const locale of locales) {
    for (const kind of kinds) {
      const html = statusHtml(kind, locale)
      const context = `${locale}/${kind}`

      assert.ok(html.includes(recoveryStyle), context)
      assert.ok(html.includes(bylineStyle), context)
      assert.ok(!html.includes('opacity:.4'), context)
    }
  }
})

function testRuntime(
  rpc: (
    name: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>,
) {
  const geoResolution: RequestGeoResolution = {
    geo: { country: null, city: null },
    source: 'none',
    outcome: 'missing_ip',
    durationMs: 0,
  }

  return {
    createClient: () => ({
      database: {
        rpc: (name: string, params?: Record<string, unknown>) => rpc(name, params),
      },
    }),
    getVisitorSalt: () => 'test-visitor-salt',
    hashVisitor: async () => 'test-visitor-hash',
    resolveGeo: async () => geoResolution,
    logGeo: () => {},
  }
}
