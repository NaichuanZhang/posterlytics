import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { zhCN } from '../src/i18n/messages.ts'

const source = readFileSync(
  new URL('../src/lib/generationApi.ts', import.meta.url),
  'utf8',
)

test('reference-only enqueue and retry errors have exact localized mappings', () => {
  assert.match(
    source,
    /'Social cover generation requires at least one reference image\.':\s+'Reference-only generation requires at least one reference image\.'/,
  )
  assert.match(
    source,
    /'RedNote post generation requires at least one reference image\.':\s+'Reference-only generation requires at least one reference image\.'/,
  )
  assert.match(
    source,
    /'RedNote post generation requires draft copy\.':\s+'RedNote post generation requires draft copy\.'/,
  )
  assert.match(
    source,
    /enqueue_poster_generation[\s\S]*localizeGenerationApiError\(/,
  )
  assert.match(
    source,
    /retry_poster_generation[\s\S]*localizeGenerationApiError\(/,
  )
  assert.equal(
    zhCN['Reference-only generation requires at least one reference image.'],
    '仅使用参考素材生成时至少需要一张参考图片。',
  )
  assert.equal(
    zhCN['RedNote post generation requires at least one reference image.'],
    '生成小红书笔记至少需要一张参考图片。',
  )
  assert.equal(
    zhCN['RedNote post generation requires draft copy.'],
    '生成小红书笔记需要填写笔记草稿。',
  )
})
