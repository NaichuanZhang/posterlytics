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
  formatFreshnessTimestamp,
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

test('freshness timestamps use the supported locale without reading the clock', () => {
  const date = new Date(2026, 6, 23, 15, 42)
  const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim()

  assert.equal(
    normalizeWhitespace(formatFreshnessTimestamp(date, 'en-US')),
    'Jul 23, 2026, 3:42 PM',
  )
  assert.equal(
    normalizeWhitespace(formatFreshnessTimestamp(date, 'zh-CN')),
    '2026年7月23日 15:42',
  )
  assert.equal(
    formatFreshnessTimestamp(new Date(Number.NaN), 'en-US'),
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
    'Fictional house brand / format study': '虚构自有品牌 / 格式研究',
    'One brand. Every format.': '一个品牌，适配每种格式。',
    'The same Posterlytics House campaign, adapted for every supported output.':
      '同一套 Posterlytics House 推广视觉，适配所有支持的输出格式。',
    'Posterlytics House': 'Posterlytics House',
    'PH / 01': 'PH / 01',
    'Citrus 01': 'Citrus 01',
    'Make room for bright.': '为明亮留出空间。',
    'Fictional citrus tonic': '虚构柑橘气泡饮',
    'Scan for Citrus 01': '扫码了解 Citrus 01',
    'Posterlytics House / Citrus 01': 'Posterlytics House / Citrus 01',
    'Refine without starting over.': '迭代，不必推倒重来。',
    'Turn any product website into an on-brand poster, then track link visits by placement.':
      '把任意产品网站变成贴合品牌的海报，再按投放点查看追踪链接访问量。',
    'See traffic by placement.': '按投放点查看流量。',
    'Compare tracked-link visits and estimated unique visitors by placement, then inspect device, operating system, and available country data.':
      '比较各投放点的追踪链接访问量与估算独立访客数，并查看设备、操作系统和可用的国家或地区数据。',
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

test('social-cover QR controls and recovery copy stay localized in English and Chinese', () => {
  const expected: Partial<Record<TranslationKey, string>> = {
    'Add a tracked QR footer': '添加追踪二维码页脚',
    'Add a scannable QR footer and track visits to a destination.':
      '添加可扫描的二维码页脚，并追踪前往目标地址的访问。',
    'Use a complete HTTP or HTTPS destination URL.':
      '请输入完整的 HTTP 或 HTTPS 目标 URL。',
    'Keep the full-bleed default or add a tracked QR footer.':
      '保留默认满版画面，或添加追踪二维码页脚。',
    'Save QR settings': '保存二维码设置',
    'QR settings saved.': '已保存二维码设置。',
    'QR settings could not be saved.': '无法保存二维码设置。',
    'QR settings were saved, but the primary placement could not be prepared.':
      '二维码设置已保存，但无法准备主要投放点。',
    'The campaign was saved, but its primary placement could not be prepared.':
      '推广活动已保存，但无法准备主要投放点。',
    'The primary placement could not be prepared.': '无法准备主要投放点。',
    'Primary placement ready.': '主要投放点已就绪。',
    'Retry primary placement': '重试准备主要投放点',
    'Save QR settings before generating a version.':
      '请先保存二维码设置，再生成新版本。',
    'Prepare the primary placement before generating a QR poster.':
      '请先准备主要投放点，再生成二维码海报。',
    'This version needs a tracked placement before it can be previewed.':
      '此版本需要追踪投放点后才能预览。',
    'The poster preview will appear when its tracked code is ready.':
      '追踪代码准备好后将显示海报预览。',
  }

  for (const [key, value] of Object.entries(expected)) {
    const translationKey = key as TranslationKey
    assert.equal(enUS[translationKey], translationKey)
    assert.equal(zhCN[translationKey], value)
  }
})
