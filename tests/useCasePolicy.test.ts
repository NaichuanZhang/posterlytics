import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  resolveProductUseCaseRecipe,
  resolveUseCaseRecipe,
  useCaseSourceMismatch,
} from '../functions/_useCasePolicy.ts'

test('resolver exposes product recipes and an isolated event-bespoke sentinel', () => {
  const website = resolveUseCaseRecipe('website_product')
  const amazon = resolveUseCaseRecipe('amazon_listing')
  const event = resolveUseCaseRecipe('event')

  assert.equal(website.kind, 'product')
  assert.equal(website.acquisitionMode, 'website')
  assert.equal(amazon.kind, 'product')
  assert.equal(amazon.acquisitionMode, 'amazon-reference')
  assert.deepEqual(event, {
    kind: 'event-bespoke',
    id: 'event',
    acquisitionMode: 'event-bespoke',
  })
  assert.equal('stages' in event, false)
})

test('NULL-ish and unknown legacy intent falls back to current website behavior', () => {
  for (const value of [null, undefined, '', 'future_use_case']) {
    assert.equal(resolveUseCaseRecipe(value).id, 'website_product')
    assert.equal(resolveProductUseCaseRecipe(value).id, 'website_product')
  }
  assert.equal(resolveProductUseCaseRecipe('event').id, 'website_product')
})

test('website and Amazon recipes preserve current downstream stage vocabulary', () => {
  const website = resolveProductUseCaseRecipe('website_product')
  const amazon = resolveProductUseCaseRecipe('amazon_listing')

  assert.deepEqual(amazon.stages, website.stages)
  assert.deepEqual(website.stages, {
    parentFirstRefresh:
      'Use the freshly captured website evidence as the visual source of truth.',
    parentRefresh:
      'WEBSITE REFRESH: Reconcile newly captured brand evidence only where it conflicts with stale brand facts; the requested delta and preservation rule still govern the edit.',
    parentSnapshot:
      'BRAND SNAPSHOT: Reuse the current version brand analysis; do not reinterpret the website or invent a new direction.',
    designerPosterKind: 'product poster',
    designerReferenceSubjects:
      'previous poster, source style board, and supporting images.',
    designerEvidenceRule:
      'Use observed evidence rather than category assumptions or a generic template.',
    designerSourceObservationsHeading: 'SOURCE VISUAL OBSERVATIONS:',
    heroPosterKind: 'product-promotion poster',
    heroStyleBoardAttached:
      'A labeled STYLE BOARD image captured from the real source page is attached. Treat it as the primary brand-style evidence while preserving the painter priority described by each reference label.',
    heroStyleBoardMissing:
      'No source style board is attached; rely on the source-derived direction and palette below.',
    heroTranslationRule:
      'Translate the observed visual language into a poster-specific composition. Do not copy navigation bars, menus, browser chrome, app screens, cards, buttons, tabs, form controls, or other website UI. Do not impose category stereotypes or substitute a trendy medium that is not evidenced by the source. Any REFERENCE PURPOSE labels attached after this prompt are instructions only and must never appear as poster text.',
  })
  assert.notEqual(website.analyze.sourceBrief, amazon.analyze.sourceBrief)
  assert.equal(
    website.analyze.evidenceSource({
      hasCapturedEvidence: true,
      captureSucceeded: true,
      themeColor: null,
    }),
    'browser-visible DOM plus weighted style-board pixels',
  )
  assert.equal(
    website.analyze.evidenceSource({
      hasCapturedEvidence: false,
      captureSucceeded: true,
      themeColor: null,
    }),
    'browser capture succeeded but yielded no usable visual palette',
  )
  assert.match(amazon.analyze.sourceBrief, /Amazon listing URL was intentionally not fetched/)
  assert.match(
    amazon.references.analysisUserReference(2),
    /Seller-supplied product or brand reference 2/,
  )
})

test('reference-purpose recipes match every pre-recipe byte string', () => {
  const website = materializeReferencePurposes(
    resolveProductUseCaseRecipe('website_product'),
  )
  const amazon = materializeReferencePurposes(
    resolveProductUseCaseRecipe('amazon_listing'),
  )
  const expected = {
    analysisStyleBoard:
      'Primary source evidence: three page viewports showing palette proportions, typography, imagery, lighting, motifs, hierarchy, and density.',
    analysisUserReference:
      'User-supplied creative reference 2; use only where it agrees with or intentionally supplements the source page.',
    assetPreviousRefresh:
      'Current poster version; preserve useful visual continuity while applying refreshed website evidence.',
    assetPreviousIteration:
      'Primary edit source; preserve every visual choice not explicitly changed by the user.',
    assetUserReference:
      'User-supplied creative reference 2; use it only where it supports the requested change.',
    assetLogo:
      'Authentic brand logo; reproduce it faithfully when included.',
    assetProduct:
      'Authentic product or brand image 2; preserve its real subject and visual details.',
    assetStyleBoard:
      'Website evidence for palette, typography, imagery treatment, lighting, texture, motifs, and density.',
    designerPrevious:
      'The current poster to edit. Preserve every visual choice not explicitly changed by the user request.',
    designerStyleBoard:
      'Primary source evidence: merged page viewports for observed palette proportions, typography, imagery, lighting, motifs, composition, and density.',
    designerUserReference:
      'User-supplied creative reference 2; secondary to the source style board.',
    heroPrevious:
      'Primary edit source: keep every visual choice that the user did not explicitly ask to change.',
    heroUserReference:
      'New supporting image 2; use it only for the requested change while preserving the parent poster.',
    heroLogo:
      'Authentic brand logo; reproduce faithfully only if this reference remains attached.',
    heroProduct:
      'Authentic product or brand image 2; preserve its real subject and visual details.',
    heroStyleBoard:
      'Supporting source evidence for palette, typography, imagery treatment, lighting, texture, motifs, and density.',
  }

  assert.deepEqual(website, expected)
  assert.deepEqual(amazon, {
    ...expected,
    analysisUserReference:
      'Seller-supplied product or brand reference 2; treat as primary visual evidence for this Amazon product.',
  })
})

test('source mismatch rejects both persisted-intent contradictions without echoing URLs', () => {
  const amazonUrl = 'https://www.amazon.com/dp/B0PRIVATE'
  const websiteUrl = 'https://merchant.example/private-product'
  const websiteMismatch = useCaseSourceMismatch('website_product', amazonUrl)
  const amazonMismatch = useCaseSourceMismatch('amazon_listing', websiteUrl)

  assert.deepEqual(websiteMismatch, {
    code: 'use_case_source_mismatch',
    message:
      'This generation is configured for a website product, but its source is an Amazon URL.',
    retryable: false,
  })
  assert.deepEqual(amazonMismatch, {
    code: 'use_case_source_mismatch',
    message:
      'This generation is configured for an Amazon listing, but its source is not a supported Amazon URL.',
    retryable: false,
  })
  assert.doesNotMatch(websiteMismatch?.message ?? '', /B0PRIVATE/)
  assert.doesNotMatch(amazonMismatch?.message ?? '', /merchant\.example/)
})

test('source mismatch accepts aligned rows and ignores event or NULL-ish legacy data', () => {
  assert.equal(
    useCaseSourceMismatch(
      'amazon_listing',
      'https://www.amazon.com/dp/B0EXAMPLE1',
    ),
    null,
  )
  assert.equal(
    useCaseSourceMismatch('website_product', 'https://example.com/product'),
    null,
  )
  assert.equal(
    useCaseSourceMismatch('event', 'https://www.amazon.com/dp/B0EXAMPLE1'),
    null,
  )
  assert.equal(useCaseSourceMismatch('amazon_listing', null), null)
  assert.equal(useCaseSourceMismatch('amazon_listing', ''), null)
  assert.equal(
    useCaseSourceMismatch('future_use_case', 'https://www.amazon.com/dp/B0EXAMPLE1'),
    null,
  )
})

test('unsupported Amazon-like hosts remain ordinary website sources', () => {
  assert.deepEqual(
    useCaseSourceMismatch(
      'amazon_listing',
      'https://amazon.com.evil.example/dp/B0EXAMPLE1',
    ),
    {
      code: 'use_case_source_mismatch',
      message:
        'This generation is configured for an Amazon listing, but its source is not a supported Amazon URL.',
      retryable: false,
    },
  )
})

function materializeReferencePurposes(
  recipe: ReturnType<typeof resolveProductUseCaseRecipe>,
) {
  return {
    analysisStyleBoard: recipe.references.analysisStyleBoard,
    analysisUserReference: recipe.references.analysisUserReference(2),
    assetPreviousRefresh: recipe.references.assetPreviousRefresh,
    assetPreviousIteration: recipe.references.assetPreviousIteration,
    assetUserReference: recipe.references.assetUserReference(2),
    assetLogo: recipe.references.assetLogo,
    assetProduct: recipe.references.assetProduct(2),
    assetStyleBoard: recipe.references.assetStyleBoard,
    designerPrevious: recipe.references.designerPrevious,
    designerStyleBoard: recipe.references.designerStyleBoard,
    designerUserReference: recipe.references.designerUserReference(2),
    heroPrevious: recipe.references.heroPrevious,
    heroUserReference: recipe.references.heroUserReference(2),
    heroLogo: recipe.references.heroLogo,
    heroProduct: recipe.references.heroProduct(2),
    heroStyleBoard: recipe.references.heroStyleBoard,
  }
}
