import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { zhCN } from '../src/i18n/messages.ts'
import { POSTER_SIZES } from '../src/lib/posterSize.ts'
import {
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

test('wizard persists intent with the shared exact-host classifier payload', () => {
  assert.match(
    wizard,
    /const values = \{[\s\S]*scenario: 'product',[\s\S]*use_case: isAmazonSourceUrl\(productUrl\)[\s\S]*\? 'amazon_listing'[\s\S]*: 'website_product'/,
  )
  assert.match(
    wizard,
    /\.insert\(\[\{ \.\.\.values, user_id: user\.id \}]\)/,
  )
  assert.match(wizard, /\.update\(values\)/)
  assert.doesNotMatch(wizard, /use_case:[\s\S]{0,120}(?:prompt|recipe)/i)
})
