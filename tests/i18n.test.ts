import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ENGLISH_MESSAGE_IDS,
  enUS,
  messages,
  zhCN,
  type TranslationKey,
} from '../src/i18n/messages.ts'
import {
  DEFAULT_LOCALE,
  formatLocalizedDate,
  preferredLocale,
  resolveSupportedLocale,
  translate,
  translateEnumLabel,
} from '../src/lib/i18n.ts'

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort()
}

test('catalog keys are unique and locale records stay in exact parity', () => {
  const uniqueKeys = new Set(ENGLISH_MESSAGE_IDS)
  assert.equal(uniqueKeys.size, ENGLISH_MESSAGE_IDS.length)
  assert.deepEqual(Object.keys(enUS).sort(), [...uniqueKeys].sort())
  assert.deepEqual(Object.keys(zhCN).sort(), [...uniqueKeys].sort())
  assert.deepEqual(Object.keys(messages).sort(), ['en-US', 'zh-CN'])
})

test('translations preserve interpolation placeholders and contain no blank values', () => {
  for (const key of ENGLISH_MESSAGE_IDS) {
    assert.ok(enUS[key].trim(), `Missing en-US value for ${key}`)
    assert.ok(zhCN[key].trim(), `Missing zh-CN value for ${key}`)
    assert.deepEqual(
      placeholders(zhCN[key]),
      placeholders(enUS[key]),
      `Placeholder mismatch for ${key}`,
    )
  }
})

test('locale resolution uses supported browser preferences with an English fallback', () => {
  assert.equal(DEFAULT_LOCALE, 'en-US')
  assert.equal(resolveSupportedLocale('en'), 'en-US')
  assert.equal(resolveSupportedLocale('EN-gb'), 'en-US')
  assert.equal(resolveSupportedLocale('zh'), 'zh-CN')
  assert.equal(resolveSupportedLocale('zh-Hans-CN'), 'zh-CN')
  assert.equal(resolveSupportedLocale('fr-FR'), null)
  assert.equal(resolveSupportedLocale(null), null)
  assert.equal(resolveSupportedLocale(42), null)
  assert.equal(resolveSupportedLocale({ locale: 'zh-CN' }), null)
  assert.equal(preferredLocale(['fr-FR', 'zh-Hans', 'en-US']), 'zh-CN')
  assert.equal(preferredLocale(['fr-FR']), 'en-US')
  assert.equal(preferredLocale(undefined), 'en-US')
})

test('translate interpolates values and keeps unresolved placeholders visible', () => {
  assert.equal(
    translate('zh-CN', 'Generation activity, {count} unread', { count: 3 }),
    '生成动态，3 条未读',
  )
  assert.equal(
    translate('en-US', 'Generation activity, {count} unread'),
    'Generation activity, {count} unread',
  )
  assert.equal(
    translate('zh-CN', 'future backend value' as TranslationKey),
    'future backend value',
  )
})

test('unknown enum labels and invalid dates degrade without throwing', () => {
  const labels = {
    ready: 'Ready',
  } as const satisfies Record<'ready', TranslationKey>
  const t = (key: TranslationKey) => translate('en-US', key)

  assert.equal(translateEnumLabel(t, labels, 'ready'), 'Ready')
  assert.equal(
    translateEnumLabel(t, labels, 'future' as 'ready'),
    'future',
  )
  assert.equal(
    formatLocalizedDate('en-US', 'not-a-date', { dateStyle: 'medium' }),
    '—',
  )
})

test('Chinese product glossary and transcreated marketing headings stay consistent', () => {
  const expected: Partial<Record<TranslationKey, string>> = {
    Campaigns: '推广活动',
    Placement: '投放点',
    Versions: '版本',
    Analytics: '数据分析',
    'Images provided': '提供的图片',
    'Images used for the poster': '海报使用的图片',
    'Tracked link': '追踪链接',
    'RedNote cover (3:4)': '小红书首图（3:4）',
    'Artwork-only export. No QR code or placement tracking is included.':
      '仅导出画面，不包含二维码或投放追踪。',
    'Create an account': '创建新账户',
    'Reset code': '验证码',
    'Verify code': '验证',
    'From website to wall.': '从网页，到墙面。',
    'Refine without starting over.': '迭代，不必推倒重来。',
    'Know what got scanned.': '每次扫码，都有迹可循。',
  }

  for (const [key, value] of Object.entries(expected)) {
    assert.equal(zhCN[key as TranslationKey], value)
  }
})
