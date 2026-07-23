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
    'Visits grouped by device, operating system, and available country data.':
      '按设备、操作系统和可用的国家或地区数据汇总访问。',
    'Location unavailable': '无法确定位置',
    'Location could not be determined for some visits.': '部分访问无法确定地理位置。',
    'Images provided': '提供的图片',
    'Images used for the poster': '海报使用的图片',
    'Tracked link': '追踪链接',
    'Portrait 3:4 with QR footer': '竖版 3:4（带二维码页脚）',
    'Portrait 3:4 full bleed': '竖版 3:4（满版）',
    'Landscape 16:9': '横版 16:9',
    'Square 1:1': '方形 1:1',
    'Artwork-only export. No QR code or placement tracking is included.':
      '仅导出画面，不包含二维码或投放追踪。',
    'Page {number} of {count}': '第 {number} / {count} 页',
    'Export page {number} of {count} as {format} PNG':
      '将第 {number} / {count} 页导出为 {format} PNG',
    'Export all {count} pages as {format} ZIP':
      '将全部 {count} 页导出为 {format} ZIP',
    'Exporting page {number} of {count}...':
      '正在导出第 {number} / {count} 页…',
    'All pages are ready in one ZIP.': '全部页面已打包为 ZIP。',
    'All-page export failed. Please try again.': '全部页面导出失败，请重试。',
    'Create an account': '创建新账户',
    'Reset code': '验证码',
    'Verify code': '验证',
    'From website to wall.': '从网页，到墙面。',
    'Refine without starting over.': '迭代，不必推倒重来。',
    'Know what got scanned.': '每次扫码，都有迹可循。',
    'Campaign type does not match its source.': '推广活动类型与来源不匹配。',
    'Choose a campaign type': '选择推广活动类型',
    'Create from a product website and its visual identity.':
      '基于产品官网的内容和视觉风格创建。',
    'Create from an Amazon listing plus seller-provided copy and images.':
      '基于亚马逊商品页及卖家提供的文案和图片创建。',
    'RedNote post': '小红书笔记',
    'Create a 3:4 RedNote cover from draft copy and creative references.':
      '根据笔记草稿和创意参考图创建 3:4 小红书封面。',
    'Draft copy': '笔记草稿',
    'Paste the full draft copy for this RedNote post.':
      '粘贴这篇小红书笔记的完整草稿。',
    'The draft copy is interpreted together with the reference images.':
      '笔记草稿会与参考图片一起解读。',
    'Listing copy and product images': '商品文案与产品图片',
    'Product title unavailable. Enter the product name.':
      '无法获取商品标题，请手动输入产品名称。',
    'Switch to Amazon listing': '切换到亚马逊商品',
    'Switch to Website product': '切换到网站产品',
    'Target platform: {platform}': '目标平台：{platform}',
  }

  for (const [key, value] of Object.entries(expected)) {
    assert.equal(zhCN[key as TranslationKey], value)
  }
})
