import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { zhCN } from '../src/i18n/messages.ts'
import { POSTER_SIZES } from '../src/lib/posterSize.ts'
import {
  allowsPersistedReferenceReuse,
  CREATABLE_USE_CASES,
  getUseCase,
  isReferenceOnlyUseCaseId,
  isUseCaseId,
  resolvePosterFormatOnUseCaseSwitch,
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
const versionHistorySource = readFileSync(
  new URL('../src/components/PosterVersionHistory.tsx', import.meta.url),
  'utf8',
)
const generationDetailsSource = readFileSync(
  new URL('../src/components/GenerationDetailsSheet.tsx', import.meta.url),
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
const trackingPolicySource = readFileSync(
  new URL('../src/lib/trackingPolicy.ts', import.meta.url),
  'utf8',
)
const campaignListSource = readFileSync(
  new URL('../src/pages/CampaignsListPage.tsx', import.meta.url),
  'utf8',
)

test('registry contains the four creatable use cases plus historical event', () => {
  assert.deepEqual(USE_CASE_IDS, [
    'website_product',
    'amazon_listing',
    'social_cover',
    'rednote_post',
    'event',
  ])
  assert.deepEqual(USE_CASES.map((useCase) => useCase.id), USE_CASE_IDS)
  assert.equal(isUseCaseId('website_product'), true)
  assert.equal(isUseCaseId('amazon_listing'), true)
  assert.equal(isUseCaseId('social_cover'), true)
  assert.equal(isUseCaseId('rednote_post'), true)
  assert.equal(isUseCaseId('event'), true)
  assert.equal(isUseCaseId('unknown'), false)
  assert.equal(getUseCase(undefined).id, 'website_product')
  assert.equal(getUseCase('unknown').id, 'website_product')
})

test('website and Amazon preserve shared input requirements', () => {
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
  }

  assert.deepEqual(website.inputFields.referenceImages, {
    requirement: 'optional',
    minimumCount: 0,
  })
  assert.deepEqual(amazon.inputFields.referenceImages, {
    requirement: 'required',
    minimumCount: 1,
  })
  assert.equal(website.inputFields.productUrl.sourceKind, 'website')
  assert.equal(amazon.inputFields.productUrl.sourceKind, 'amazon')
})

test('social cover is creatable from references with an opt-in tracked QR format', () => {
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
  assert.deepEqual(social.allowedPosterFormats, [
    'rednote_cover_3x4',
    'rednote_3x4',
  ])
  assert.equal(social.defaultPosterFormat, 'rednote_cover_3x4')
  assert.equal(social.trackingEnabled, true)
})

test('RedNote independently stays full-bleed, reference-only, and untracked', () => {
  const redNote = getUseCase('rednote_post')

  assert.equal(redNote.creationEnabled, true)
  assert.deepEqual(redNote.inputFields.productUrl, {
    requirement: 'hidden',
    sourceKind: 'none',
  })
  assert.equal(redNote.inputFields.productName, 'required')
  assert.equal(redNote.inputFields.tagline, 'optional')
  assert.equal(redNote.inputFields.ctaText, 'hidden')
  assert.equal(redNote.inputFields.destinationUrl, 'hidden')
  assert.equal(redNote.inputFields.referenceContext, 'required')
  assert.equal(redNote.inputFields.platformHint, 'optional')
  assert.deepEqual(redNote.inputFields.referenceImages, {
    requirement: 'required',
    minimumCount: 1,
  })
  assert.deepEqual(redNote.allowedPosterFormats, ['rednote_cover_3x4'])
  assert.equal(redNote.defaultPosterFormat, 'rednote_cover_3x4')
  assert.equal(redNote.trackingEnabled, false)
  assert.equal(isReferenceOnlyUseCaseId('social_cover'), true)
  assert.equal(isReferenceOnlyUseCaseId('rednote_post'), true)
  assert.equal(isReferenceOnlyUseCaseId('website_product'), false)
})

test('persisted reference reuse includes Amazon and reference-only use cases', () => {
  assert.equal(allowsPersistedReferenceReuse('amazon_listing'), true)
  assert.equal(allowsPersistedReferenceReuse('social_cover'), true)
  assert.equal(allowsPersistedReferenceReuse('rednote_post'), true)
  assert.equal(allowsPersistedReferenceReuse('website_product'), false)
  assert.equal(allowsPersistedReferenceReuse('event'), false)
})

test('all four creation cards have localized descriptions', () => {
  assert.deepEqual(
    CREATABLE_USE_CASES.map((useCase) => useCase.id),
    ['website_product', 'amazon_listing', 'social_cover', 'rednote_post'],
  )
  assert.deepEqual(
    CREATABLE_USE_CASES.map((useCase) => zhCN[useCase.creationDescription!]),
    [
      '基于产品官网的内容和视觉风格创建。',
      '基于亚马逊商品页及卖家提供的文案和图片创建。',
      '根据创意参考图和方向创建满版画面。',
      '根据笔记草稿和创意参考图创建 3:4 小红书封面。',
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

  for (const id of [
    'website_product',
    'amazon_listing',
    'event',
  ] as const) {
    const useCase = getUseCase(id)
    assert.deepEqual(useCase.allowedPosterFormats, formatSlugs)
    assert.equal(useCase.defaultPosterFormat, 'a4_2x3')
    assert.equal(
      useCase.allowedPosterFormats.includes(useCase.defaultPosterFormat),
      true,
    )
    assert.equal(useCase.trackingEnabled, true)
  }
})

test('use-case round trip resolves each destination default', () => {
  const redNoteFormat = resolvePosterFormatOnUseCaseSwitch(
    'a4_2x3',
    'website_product',
    'rednote_post',
  )
  assert.equal(redNoteFormat, 'rednote_cover_3x4')
  assert.equal(
    resolvePosterFormatOnUseCaseSwitch(
      redNoteFormat,
      'rednote_post',
      'website_product',
    ),
    'a4_2x3',
  )
})

test('cross-type format changes use the destination default', () => {
  assert.equal(
    resolvePosterFormatOnUseCaseSwitch(
      'rednote_cover_3x4',
      'rednote_post',
      'website_product',
    ),
    'a4_2x3',
  )
  assert.equal(
    resolvePosterFormatOnUseCaseSwitch(
      'luma_1x1',
      'website_product',
      'amazon_listing',
    ),
    'a4_2x3',
  )
  assert.equal(
    resolvePosterFormatOnUseCaseSwitch(
      'a4_2x3',
      'website_product',
      'social_cover',
    ),
    'rednote_cover_3x4',
  )
  assert.equal(
    resolvePosterFormatOnUseCaseSwitch(
      'luma_1x1',
      'website_product',
      'rednote_post',
    ),
    'rednote_cover_3x4',
  )
})

test('same-type format selection preserves valid defaults and explicit choices', () => {
  assert.equal(
    resolvePosterFormatOnUseCaseSwitch(
      'a4_2x3',
      'website_product',
      'website_product',
    ),
    'a4_2x3',
  )
  assert.equal(
    resolvePosterFormatOnUseCaseSwitch(
      'luma_1x1',
      'website_product',
      'website_product',
    ),
    'luma_1x1',
  )
})

test('initial use-case selection resolves the destination default', () => {
  assert.equal(
    resolvePosterFormatOnUseCaseSwitch(
      'a4_2x3',
      null,
      'website_product',
    ),
    'a4_2x3',
  )
})

test('registry labels are localized without carrying a prompt recipe', () => {
  assert.deepEqual(
    USE_CASES.map((useCase) => zhCN[useCase.label]),
    ['网站产品', '亚马逊商品', '社交媒体封面', '小红书笔记', '活动'],
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
    /const resolvedDestinationUrl = qrEnabled\s+\? destinationUrl\.trim\(\)\s+: fields\.destinationUrl === 'hidden'\s+\? null/,
  )
  assert.match(
    wizard,
    /const values = \{[\s\S]*scenario: 'product',[\s\S]*use_case: selectedUseCaseId,[\s\S]*product_url: resolvedProductUrl,[\s\S]*destination_url: resolvedDestinationUrl,[\s\S]*platform_hint: fields\.platformHint === 'hidden'[\s\S]*normalizePlatformHint\(platformHint\)[\s\S]*poster_format: selectedUseCaseId === 'social_cover'[\s\S]*'rednote_3x4'[\s\S]*'rednote_cover_3x4'/,
  )
  assert.match(
    wizard,
    /\.insert\(\[\{ \.\.\.values, user_id: user\.id \}]\)/,
  )
  assert.match(wizard, /\.update\(values\)/)
  assert.match(wizard, /CREATABLE_USE_CASES\.map/)
  assert.match(
    wizard,
    /useCase\.id === 'rednote_post'[\s\S]{0,100}<FileText size=\{22\}/,
  )
  assert.match(wizard, /inputFields\.productUrl\.requirement/)
  assert.match(wizard, /inputFields\.referenceImages\.requirement/)
  assert.match(
    wizard,
    /pendingReferences\.length < minimumReferenceImages/,
  )
  assert.match(
    wizard,
    /inputFields\?\.referenceContext !== 'required'\s+\|\| normalizeReferenceContext\(referenceContext\) !== null/,
  )
  assert.match(
    wizard,
    /disabled=\{[\s\S]*!referenceMinimumMet[\s\S]*!referenceContextRequirementMet[\s\S]*!pendingReferencesReady\(pendingReferences\)/,
  )
  const artworkDetailsPosition = wizard.indexOf('aria-labelledby="source-heading"')
  const generationReferencesPosition = wizard.indexOf(
    '{referenceOnlyMode && renderGenerationReferences(inputFields)}',
    artworkDetailsPosition,
  )
  const artworkOutputPosition = wizard.indexOf(
    '{referenceOnlyMode && renderArtworkOutputFields(inputFields)}',
    generationReferencesPosition,
  )
  assert.ok(
    artworkDetailsPosition >= 0
      && artworkDetailsPosition < generationReferencesPosition
      && generationReferencesPosition < artworkOutputPosition,
  )
  assert.doesNotMatch(wizard, /use_case:[\s\S]{0,120}(?:prompt|recipe)/i)
})

test('editor and preflight consume persisted intent while reference-only modes always re-analyze', () => {
  assert.match(
    editorSource,
    /getUseCase\(campaign\.use_case\)/,
  )
  assert.match(editorSource, /campaignUseCase\.id === 'amazon_listing'/)
  assert.match(
    editorSource,
    /isReferenceOnlyUseCaseId\(campaignUseCase\.id\)/,
  )
  assert.match(
    editorSource,
    /const effectiveRefreshWebsite = referenceOnlyMode \|\| firstVersion \|\| refreshWebsite/,
  )
  assert.match(
    editorSource,
    /await persistPlatformHintTarget\(\)[\s\S]*await reload\(\)[\s\S]*materializeReferenceImages/,
  )
  assert.match(
    editorSource,
    /resolveGenerationReferenceInput\(\{[\s\S]*allowPersistedReuse: allowsPersistedReferenceReuse\(campaignUseCase\.id\),[\s\S]*persistedCount: usablePersistedReferences\.length,[\s\S]*pendingCount: pendingReferences\.length/,
  )
  assert.match(editorSource, /allowedFormats=\{campaignUseCase\.allowedPosterFormats\}/)
  assert.match(
    generationTracesSource,
    /campaign\.use_case === 'website_product'/,
  )
  assert.match(
    generationTracesSource,
    /!isReferenceOnlyUseCaseId\(campaign\.use_case\)/,
  )
  for (const source of [versionHistorySource, generationDetailsSource]) {
    assert.match(
      source,
      /isReferenceOnlyUseCaseId\((?:selectedGeneration|generation)\.use_case\)/,
    )
  }
  assert.doesNotMatch(editorSource, /isAmazonSourceUrl/)
  assert.doesNotMatch(generationTracesSource, /isAmazonSourceUrl/)
  assert.match(wizard, /isAmazonSourceUrl\(productUrl\)/)
})

test('tracking policy suppresses placement UI, default creation, and direct routes', () => {
  assert.match(
    appShellSource,
    /const trackingActive = isCampaignTrackingActive\(campaign\)/,
  )
  assert.match(
    appShellSource,
    /\.filter\(\s*\(tab\) => tab\.section === 'poster' \|\| trackingActive/,
  )
  assert.match(
    editorSource,
    /usePlacements\(\s*id,\s*user\?\.id,\s*campaignTrackingActive/,
  )
  assert.match(
    editorSource,
    /if \(!user\?\.id \|\| !campaignTrackingActive\) return/,
  )
  assert.match(
    editorSource,
    /\{campaignTrackingActive && previewIncludesQrBand && selectedPlacement && \([\s\S]*?Copy tracked link/,
  )
  assert.match(
    editorSource,
    /\{campaignTrackingActive && \(\s*<>\s*<Link[\s\S]*?Manage placements[\s\S]*?View analytics/,
  )
  for (const source of [placementsPageSource, analyticsPageSource]) {
    assert.match(source, /isCampaignTrackingActive\(campaign\)/)
    assert.match(
      source,
      /if \(!trackingActive\) \{\s+return <Navigate to=\{`\/campaigns\/\$\{campaign\.id\}`\} replace \/>/,
    )
  }
  assert.match(campaignListSource, /isCampaignTrackingActive\(campaign\)/)
  assert.match(
    trackingPolicySource,
    /getUseCase\(campaign\.use_case\)\.trackingEnabled[\s\S]*typeof campaign\.destination_url === 'string'[\s\S]*campaign\.destination_url\.trim\(\)\.length > 0/,
  )
  assert.match(
    placementsHookSource,
    /if \(!campaignId \|\| \(!enabled && !force\)\)/,
  )
  assert.match(
    placementsHookSource,
    /if \(\(!enabled && !force\) \|\| !campaignId \|\| !userId\)/,
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
