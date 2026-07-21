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
const analyzeSource = readFileSync(
  new URL('../functions/analyze.ts', import.meta.url),
  'utf8',
)
const heroSource = readFileSync(
  new URL('../functions/hero.ts', import.meta.url),
  'utf8',
)
const appShellSource = readFileSync(
  new URL('../src/components/AppShell.tsx', import.meta.url),
  'utf8',
)
const placementsPageSource = readFileSync(
  new URL('../src/pages/PlacementsPage.tsx', import.meta.url),
  'utf8',
)
const analyticsPageSource = readFileSync(
  new URL('../src/pages/AnalyticsPage.tsx', import.meta.url),
  'utf8',
)
const placementsHookSource = readFileSync(
  new URL('../src/hooks/usePlacements.ts', import.meta.url),
  'utf8',
)

test('registry contains the three creatable use cases plus historical event', () => {
  assert.deepEqual(USE_CASE_IDS, [
    'website_product',
    'amazon_listing',
    'social_cover',
    'event',
  ])
  assert.deepEqual(USE_CASES.map((useCase) => useCase.id), USE_CASE_IDS)
  assert.equal(isUseCaseId('website_product'), true)
  assert.equal(isUseCaseId('amazon_listing'), true)
  assert.equal(isUseCaseId('social_cover'), true)
  assert.equal(isUseCaseId('event'), true)
  assert.equal(isUseCaseId('unknown'), false)
  assert.equal(getUseCase(undefined).id, 'website_product')
  assert.equal(getUseCase('unknown').id, 'website_product')
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
    assert.equal(useCase.inputFields.platformHint, 'hidden')
    assert.deepEqual(useCase.inputFields.referenceImages, {
      requirement: 'optional',
      minimumCount: 0,
    })
  }

  assert.equal(website.inputFields.productUrl.sourceKind, 'website')
  assert.equal(amazon.inputFields.productUrl.sourceKind, 'amazon')
})

test('social cover is creatable from references with no URL or tracking fields', () => {
  const social = getUseCase('social_cover')

  assert.equal(social.creationEnabled, true)
  assert.deepEqual(social.inputFields.productUrl, {
    requirement: 'hidden',
    sourceKind: 'none',
  })
  assert.equal(social.inputFields.productName, 'required')
  assert.equal(social.inputFields.tagline, 'optional')
  assert.equal(social.inputFields.ctaText, 'hidden')
  assert.equal(social.inputFields.destinationUrl, 'hidden')
  assert.equal(social.inputFields.referenceContext, 'optional')
  assert.equal(social.inputFields.platformHint, 'optional')
  assert.deepEqual(social.inputFields.referenceImages, {
    requirement: 'required',
    minimumCount: 1,
  })
  assert.deepEqual(social.allowedPosterFormats, ['rednote_cover_3x4'])
  assert.equal(social.defaultPosterFormat, 'rednote_cover_3x4')
  assert.equal(social.trackingEnabled, false)
})

test('all three creation cards have localized descriptions', () => {
  assert.deepEqual(
    CREATABLE_USE_CASES.map((useCase) => useCase.id),
    ['website_product', 'amazon_listing', 'social_cover'],
  )
  assert.deepEqual(
    CREATABLE_USE_CASES.map((useCase) => zhCN[useCase.creationDescription!]),
    [
      '基于产品官网的内容和视觉风格创建。',
      '基于亚马逊商品页及卖家提供的文案和图片创建。',
      '根据创意参考图和方向创建满版画面。',
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

test('website, Amazon, and event retain all formats, A4 defaults, and tracking', () => {
  const formatSlugs = POSTER_SIZES.map((size) => size.slug)

  for (const useCase of USE_CASES.filter(({ id }) => id !== 'social_cover')) {
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
    ['网站产品', '亚马逊商品', '社交媒体封面', '活动'],
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

test('wizard persists spec-driven nullable sources and the platform target atomically', () => {
  assert.match(
    wizard,
    /const resolvedProductUrl = fields\.productUrl\.requirement === 'hidden'\s+\? null\s+: productUrl\.trim\(\)/,
  )
  assert.match(
    wizard,
    /const resolvedDestinationUrl = fields\.destinationUrl === 'hidden'\s+\? null/,
  )
  assert.match(
    wizard,
    /const values = \{[\s\S]*scenario: 'product',[\s\S]*use_case: selectedUseCaseId,[\s\S]*product_url: resolvedProductUrl,[\s\S]*destination_url: resolvedDestinationUrl,[\s\S]*platform_hint: fields\.platformHint === 'hidden'[\s\S]*normalizePlatformHint\(platformHint\)/,
  )
  assert.match(
    wizard,
    /\.insert\(\[\{ \.\.\.values, user_id: user\.id \}]\)/,
  )
  assert.match(wizard, /\.update\(values\)/)
  assert.match(wizard, /CREATABLE_USE_CASES\.map/)
  assert.match(wizard, /inputFields\.productUrl\.requirement/)
  assert.match(wizard, /inputFields\.referenceImages\.requirement/)
  assert.match(
    wizard,
    /pendingReferences\.length < minimumReferenceImages/,
  )
  assert.match(
    wizard,
    /disabled=\{\s*!referenceMinimumMet\s+\|\| !pendingReferencesReady\(pendingReferences\)/,
  )
  assert.ok(
    wizard.indexOf('{socialCover && renderGenerationReferences(inputFields)}')
      < wizard.indexOf('aria-labelledby="source-heading"'),
  )
  assert.doesNotMatch(wizard, /use_case:[\s\S]{0,120}(?:prompt|recipe)/i)
})

test('editor and preflight consume persisted intent while social always re-analyzes', () => {
  assert.match(
    editorSource,
    /getUseCase\(campaign\.use_case\)/,
  )
  assert.match(editorSource, /campaignUseCase\.id === 'amazon_listing'/)
  assert.match(editorSource, /campaignUseCase\.id === 'social_cover'/)
  assert.match(
    editorSource,
    /const effectiveRefreshWebsite = socialReferenceMode \|\| firstVersion \|\| refreshWebsite/,
  )
  assert.match(
    editorSource,
    /await persistPlatformHintTarget\(\)[\s\S]*await reload\(\)[\s\S]*materializeReferenceImages/,
  )
  assert.match(
    editorSource,
    /pendingReferences\.length >= minimumReferenceImages/,
  )
  assert.match(editorSource, /allowedFormats=\{campaignUseCase\.allowedPosterFormats\}/)
  assert.match(
    generationTracesSource,
    /campaign\.use_case === 'website_product'/,
  )
  assert.match(
    generationTracesSource,
    /campaign\.use_case !== 'social_cover'/,
  )
  assert.doesNotMatch(editorSource, /isAmazonSourceUrl/)
  assert.doesNotMatch(generationTracesSource, /isAmazonSourceUrl/)
  assert.match(wizard, /isAmazonSourceUrl\(productUrl\)/)
})

test('tracking policy suppresses placement UI, default creation, and direct routes', () => {
  assert.match(
    appShellSource,
    /\.filter\(\s*\(tab\) => tab\.section === 'poster' \|\| useCase\.trackingEnabled/,
  )
  assert.match(
    editorSource,
    /usePlacements\(\s*id,\s*user\?\.id,\s*campaignTrackingEnabled/,
  )
  assert.match(
    editorSource,
    /user\?\.id && campaignTrackingEnabled\) void ensureDefault\(\)/,
  )
  assert.match(
    editorSource,
    /\{campaignTrackingEnabled && previewIncludesQrBand && selectedPlacement && \([\s\S]*?Copy tracked link/,
  )
  assert.match(
    editorSource,
    /\{campaignTrackingEnabled && \(\s*<>\s*<Link[\s\S]*?Manage placements[\s\S]*?View analytics/,
  )
  for (const source of [placementsPageSource, analyticsPageSource]) {
    assert.match(source, /getUseCase\(campaign\.use_case\)\.trackingEnabled/)
    assert.match(
      source,
      /if \(!trackingEnabled\) \{\s+return <Navigate to=\{`\/campaigns\/\$\{campaign\.id\}`\} replace \/>/,
    )
  }
  assert.match(
    placementsHookSource,
    /if \(!campaignId \|\| !enabled\)/,
  )
  assert.match(
    placementsHookSource,
    /if \(!enabled \|\| !campaignId \|\| !userId\)/,
  )
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

test('analyze caps the frozen platform hint before trimming boundary whitespace', () => {
  assert.match(
    analyzeSource,
    /\.platform_hint\)\.slice\(0, 80\)\.trim\(\) \|\| null/,
  )
  assert.doesNotMatch(
    analyzeSource,
    /\.platform_hint\)\.trim\(\)\.slice\(0, 80\)/,
  )
})
