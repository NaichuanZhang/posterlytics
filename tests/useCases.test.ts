import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { zhCN } from '../src/i18n/messages.ts'
import { POSTER_SIZES } from '../src/lib/posterSize.ts'
import {
  CREATABLE_USE_CASES,
  getUseCase,
  isUseCaseId,
  USE_CASE_IDS,
  USE_CASES,
} from '../src/lib/useCases.ts'

const wizard = readFileSync(
  new URL('../src/pages/CampaignWizardPage.tsx', import.meta.url),
  'utf8',
)
const registrySource = readFileSync(
  new URL('../src/lib/useCases.ts', import.meta.url),
  'utf8',
)
const editorSource = readFileSync(
  new URL('../src/pages/PosterEditorPage.tsx', import.meta.url),
  'utf8',
)
const generationTracesSource = readFileSync(
  new URL('../src/lib/generationTraces.ts', import.meta.url),
  'utf8',
)
const designerSource = readFileSync(
  new URL('../functions/designer.ts', import.meta.url),
  'utf8',
)
const heroSource = readFileSync(
  new URL('../functions/hero.ts', import.meta.url),
  'utf8',
)

test('registry contains only the persisted use cases shipped in this cycle', () => {
  assert.deepEqual(USE_CASE_IDS, [
    'website_product',
    'amazon_listing',
    'event',
  ])
  assert.deepEqual(USE_CASES.map((useCase) => useCase.id), USE_CASE_IDS)
  assert.equal(isUseCaseId('website_product'), true)
  assert.equal(isUseCaseId('amazon_listing'), true)
  assert.equal(isUseCaseId('event'), true)
  assert.equal(isUseCaseId('social_cover'), false)
  assert.equal(isUseCaseId('unknown'), false)
})

test('website and Amazon preserve current input requirements', () => {
  const website = getUseCase('website_product')
  const amazon = getUseCase('amazon_listing')

  for (const useCase of [website, amazon]) {
    assert.equal(useCase.creationEnabled, true)
    assert.equal(useCase.inputFields.productUrl.requirement, 'required')
    assert.equal(useCase.inputFields.productName, 'required')
    assert.equal(useCase.inputFields.tagline, 'optional')
    assert.equal(useCase.inputFields.ctaText, 'required')
    assert.equal(useCase.inputFields.destinationUrl, 'required')
    assert.equal(useCase.inputFields.referenceContext, 'optional')
    assert.deepEqual(useCase.inputFields.referenceImages, {
      requirement: 'optional',
      minimumCount: 0,
    })
  }

  assert.equal(website.inputFields.productUrl.sourceKind, 'website')
  assert.equal(amazon.inputFields.productUrl.sourceKind, 'amazon')
})

test('only website and Amazon are exposed for creation with localized descriptions', () => {
  assert.deepEqual(
    CREATABLE_USE_CASES.map((useCase) => useCase.id),
    ['website_product', 'amazon_listing'],
  )
  assert.deepEqual(
    CREATABLE_USE_CASES.map((useCase) => zhCN[useCase.creationDescription!]),
    [
      '基于产品官网的内容和视觉风格创建。',
      '基于亚马逊商品页及卖家提供的文案和图片创建。',
    ],
  )
})

test('event remains a non-creatable historical registry entry', () => {
  const event = getUseCase('event')

  assert.equal(event.creationEnabled, false)
  assert.equal(event.inputFields.productUrl.requirement, 'hidden')
  assert.equal(event.inputFields.productUrl.sourceKind, 'none')
  assert.equal(
    Object.values(event.inputFields).every((field) =>
      typeof field === 'string'
        ? field === 'hidden'
        : field.requirement === 'hidden'
    ),
    true,
  )
})

test('every use case allows the current formats, defaults to A4, and tracks', () => {
  const formatSlugs = POSTER_SIZES.map((size) => size.slug)

  for (const useCase of USE_CASES) {
    assert.deepEqual(useCase.allowedPosterFormats, formatSlugs)
    assert.equal(useCase.defaultPosterFormat, 'a4_2x3')
    assert.equal(
      useCase.allowedPosterFormats.includes(useCase.defaultPosterFormat),
      true,
    )
    assert.equal(useCase.trackingEnabled, true)
  }
})

test('registry labels are localized without carrying a prompt recipe', () => {
  assert.deepEqual(
    USE_CASES.map((useCase) => zhCN[useCase.label]),
    ['网站产品', '亚马逊商品', '活动'],
  )
  assert.doesNotMatch(registrySource, /\b(?:prompt|recipe)\b/i)
  assert.equal(
    registrySource
      .split('\n')
      .filter((line) => line.startsWith('import '))
      .every((line) => line.startsWith('import type ')),
    true,
  )
})

test('wizard persists explicit selected intent and source atomically', () => {
  assert.match(
    wizard,
    /const values = \{[\s\S]*scenario: 'product',[\s\S]*use_case: selectedUseCaseId,[\s\S]*product_url: productUrl\.trim\(\)/,
  )
  assert.match(
    wizard,
    /\.insert\(\[\{ \.\.\.values, user_id: user\.id \}]\)/,
  )
  assert.match(wizard, /\.update\(values\)/)
  assert.match(wizard, /CREATABLE_USE_CASES\.map/)
  assert.match(wizard, /inputFields\.productUrl\.requirement/)
  assert.match(wizard, /inputFields\.referenceImages\.requirement/)
  assert.doesNotMatch(wizard, /use_case:[\s\S]{0,120}(?:prompt|recipe)/i)
})

test('editor and preflight consume persisted intent while URL classification stays in the wizard', () => {
  assert.match(
    editorSource,
    /getUseCase\(campaign\.use_case\)/,
  )
  assert.match(editorSource, /campaignUseCase\.id === 'amazon_listing'/)
  assert.match(editorSource, /allowedFormats=\{campaignUseCase\.allowedPosterFormats\}/)
  assert.match(
    generationTracesSource,
    /campaign\.use_case !== 'amazon_listing'/,
  )
  assert.doesNotMatch(editorSource, /isAmazonSourceUrl/)
  assert.doesNotMatch(generationTracesSource, /isAmazonSourceUrl/)
  assert.match(wizard, /isAmazonSourceUrl\(productUrl\)/)
})

test('content stages resolve recipes from the frozen generation snapshot', () => {
  for (const source of [designerSource, heroSource]) {
    assert.match(
      source,
      /resolveProductUseCaseRecipe\(\s*\(generation as Record<string, unknown>\)\.use_case,\s*\)/,
    )
    assert.doesNotMatch(
      source,
      /resolveProductUseCaseRecipe\((?:c|generationSnapshot)\.use_case\)/,
    )
  }
})
