import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  REDNOTE_CJK_FONT_FAMILY,
  REDNOTE_CJK_FONT_MAX_BASE64_CHARS,
  REDNOTE_CJK_FONT_MAX_BYTES,
  REDNOTE_FONT_EMBED_CSS_MAX_CHARS,
  buildRedNoteFontEmbedCss,
  getRedNotePageFontUsage,
  isRedNoteCjkCodePoint,
  selectRedNoteFontEmbedCss,
  validateRedNoteFontEmbedCss,
} from '../src/lib/redNoteFont.ts'
import type { RedNotePostPlan } from '../src/lib/redNotePost.ts'

const plan: RedNotePostPlan = {
  schema_version: 1,
  pages: [
    {
      kind: 'cover',
      title: '中文A中😀',
      subtitle: '文 /',
    },
    {
      kind: 'content',
      heading: '章节B',
      blocks: ['正文内容😀', 'Latin only'],
    },
  ],
}

test('font usage extracts exact unique code points including the page marker', () => {
  const usage = getRedNotePageFontUsage(plan, 0)

  assert.equal(usage.allText, '中文A😀 /012')
  assert.equal(usage.cjkText, '中文')
  assert.equal(usage.needsBundledFace, true)
  assert.equal(Array.from(usage.allText).includes('\ud83d'), false)
  assert.equal(Array.from(usage.allText).includes('\ude00'), false)
})

test('font usage is isolated to the selected RedNote page', () => {
  const usage = getRedNotePageFontUsage(plan, 1)

  assert.equal(usage.allText.includes('中文'), false)
  assert.equal(usage.allText, '章节B正文内容😀Latin oly02/')
  assert.equal(usage.cjkText, '章节正文内容')
})

test('CJK detection covers the scoped ranges without claiming deferred scripts', () => {
  for (const value of ['中', '。', '【', '！']) {
    assert.equal(isRedNoteCjkCodePoint(value), true, value)
  }
  for (const value of ['A', '😀', 'ع', 'א', '한']) {
    assert.equal(isRedNoteCjkCodePoint(value), false, value)
  }
})

test('Latin-only RedNote pages select an explicit empty export font CSS', () => {
  const latinPlan: RedNotePostPlan = {
    schema_version: 1,
    pages: [
      { kind: 'cover', title: 'Plain Latin' },
      { kind: 'content', heading: 'More', blocks: ['Copy'] },
    ],
  }
  const usage = getRedNotePageFontUsage(latinPlan, 0)

  assert.equal(usage.cjkText, '')
  assert.equal(usage.needsBundledFace, false)
  assert.equal(selectRedNoteFontEmbedCss(usage, 'not valid CSS'), '')
})

test('embedded CSS contains exactly the bounded RedNote WOFF2 face', () => {
  const css = buildRedNoteFontEmbedCss(
    'data:font/woff2;base64,d09GMg==',
  )

  assert.equal(validateRedNoteFontEmbedCss(css), css)
  assert.match(css, new RegExp(REDNOTE_CJK_FONT_FAMILY))
  assert.match(css, /url\("data:font\/woff2;base64,d09GMg=="\)/)
  assert.doesNotMatch(css, /Space Grotesk/)
  assert.doesNotMatch(css, /url\(["']?(?:\/|\.\.?\/)/)
})

test('embedded CSS validation rejects unrelated, external, and multiple faces', () => {
  assert.throws(
    () => validateRedNoteFontEmbedCss(
      '@font-face{font-family:"Space Grotesk";'
      + 'font-weight:500;src:url("data:font/woff2;base64,d09GMg==")}',
    ),
    TypeError,
  )
  assert.throws(
    () => validateRedNoteFontEmbedCss(
      `@font-face{font-family:"${REDNOTE_CJK_FONT_FAMILY}";`
      + 'font-weight:500;src:url("/assets/font.woff2")}',
    ),
    TypeError,
  )
  const valid = buildRedNoteFontEmbedCss(
    'data:font/woff2;base64,d09GMg==',
  )
  assert.throws(
    () => validateRedNoteFontEmbedCss(`${valid}${valid}`),
    TypeError,
  )
})

test('font byte, base64, and CSS budgets remain mathematically aligned', () => {
  assert.equal(
    REDNOTE_CJK_FONT_MAX_BASE64_CHARS,
    4 * Math.ceil(REDNOTE_CJK_FONT_MAX_BYTES / 3),
  )
  assert.ok(
    REDNOTE_FONT_EMBED_CSS_MAX_CHARS
      > REDNOTE_CJK_FONT_MAX_BASE64_CHARS,
  )
  assert.ok(
    REDNOTE_FONT_EMBED_CSS_MAX_CHARS
      - REDNOTE_CJK_FONT_MAX_BASE64_CHARS
      >= 1_024,
  )
  assert.throws(
    () => buildRedNoteFontEmbedCss(
      `data:font/woff2;base64,${
        'A'.repeat(REDNOTE_CJK_FONT_MAX_BASE64_CHARS + 4)
      }`,
    ),
    RangeError,
  )
  assert.throws(
    () => validateRedNoteFontEmbedCss(
      ' '.repeat(REDNOTE_FONT_EMBED_CSS_MAX_CHARS + 1),
    ),
    RangeError,
  )
})
