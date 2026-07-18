import assert from 'node:assert/strict'
import { test } from 'node:test'
import view, {
  resolveViewLocale,
  statusHtml,
} from '../functions/view.ts'

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

test('view status pages localize markup and language response headers', async () => {
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
  assert.match(body, /<title>链接不存在<\/title>/)
  assert.match(body, /此链接当前不可用。/)

  const unpublished = statusHtml('unpublished', 'zh-CN')
  assert.match(unpublished, /<title>海报尚未发布<\/title>/)
  assert.match(
    unpublished,
    /此海报所属的推广活动尚未发布。发布后，该链接即可访问。/,
  )
})
