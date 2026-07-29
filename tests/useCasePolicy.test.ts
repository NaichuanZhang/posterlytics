import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isReferenceOnlyProductRecipe,
  resolveProductUseCaseRecipe,
  resolveUseCaseRecipe,
  useCaseSourceMismatch,
} from '../functions/_useCasePolicy.ts'
import { resolveCreationUseCase } from '../src/lib/useCases.ts'

test('resolver exposes product recipes and an isolated event-bespoke sentinel', () => {
  const website = resolveUseCaseRecipe('website_product')
  const amazon = resolveUseCaseRecipe('amazon_listing')
  const social = resolveUseCaseRecipe('social_cover')
  const redNote = resolveUseCaseRecipe('rednote_post')
  const event = resolveUseCaseRecipe('event')

  assert.equal(website.kind, 'product')
  assert.equal(website.acquisitionMode, 'website')
  assert.equal(amazon.kind, 'product')
  assert.equal(amazon.acquisitionMode, 'amazon-reference')
  assert.equal(social.kind, 'product')
  assert.equal(social.acquisitionMode, 'reference-only')
  assert.deepEqual(redNote, {
    ...social,
    id: 'rednote_post',
    artworkMode: 'rednote-background-v1',
    analyze: {
      ...social.analyze,
      outputMode: 'rednote-post-v1',
    },
  })
  assert.equal(
    isReferenceOnlyProductRecipe(resolveProductUseCaseRecipe('social_cover')),
    true,
  )
  assert.equal(
    isReferenceOnlyProductRecipe(resolveProductUseCaseRecipe('rednote_post')),
    true,
  )
  assert.equal(isReferenceOnlyProductRecipe(website), false)
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
  assert.equal(
    website.stages.parentFirstRefresh,
    'Use the freshly captured website evidence as the visual source of truth.',
  )
  assert.equal(website.stages.designerPosterKind, 'product poster')
  assert.equal(website.stages.heroPosterKind, 'product-promotion poster')
  assert.equal(website.stages.heroNoLogoSubject, 'product name')
  assert.match(website.stages.heroTranslationRule, /website UI/)
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

test('social recipe is reference-only and contains no website or URL evidence language', () => {
  const social = resolveProductUseCaseRecipe('social_cover')
  const materialized = [
    social.analyze.sourceBrief,
    social.analyze.paletteBrief,
    social.analyze.densityBrief,
    social.analyze.evidenceSource({
      hasCapturedEvidence: false,
      captureSucceeded: false,
      themeColor: null,
    }),
    social.analyze.sourceText('ignored'),
    social.analyze.referenceInstruction(2),
    social.analyze.platformInstruction('Instagram'),
    ...Object.values(social.stages).map((value) =>
      typeof value === 'function' ? value('fixture') : value
    ),
  ].join('\n')

  assert.equal(social.analyze.promptKind, 'social-reference')
  assert.match(materialized, /mood/)
  assert.match(materialized, /visual hook/i)
  assert.match(materialized, /TARGET PLATFORM HINT: Instagram/)
  assert.doesNotMatch(materialized, /\b(?:website|url)\b|browser capture/i)
  assert.doesNotMatch(materialized, /\bDOM\b/)
})

test('RedNote isolates its analyze output and background artwork modes', () => {
  const social = resolveProductUseCaseRecipe('social_cover')
  const redNote = resolveProductUseCaseRecipe('rednote_post')

  assert.notStrictEqual(redNote.analyze, social.analyze)
  assert.equal(social.analyze.outputMode, undefined)
  assert.equal(redNote.analyze.outputMode, 'rednote-post-v1')
  assert.equal(social.artworkMode, undefined)
  assert.equal(redNote.artworkMode, 'rednote-background-v1')
  assert.deepEqual(
    { ...redNote.analyze, outputMode: undefined },
    { ...social.analyze, outputMode: undefined },
  )
  assert.strictEqual(redNote.references, social.references)
  assert.strictEqual(redNote.stages, social.stages)
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

test('social reference purposes keep only artwork continuity and user evidence', () => {
  const social = materializeReferencePurposes(
    resolveProductUseCaseRecipe('social_cover'),
  )

  assert.match(social.analysisUserReference, /Primary creative reference 2/)
  assert.match(social.assetPreviousRefresh, /Previous artwork/)
  assert.match(social.assetUserReference, /Primary creative reference 2/)
  assert.match(social.designerUserReference, /Primary creative reference 2/)
  assert.match(social.heroUserReference, /Primary creative reference 2/)
  assert.doesNotMatch(
    Object.values(social).join('\n'),
    /\bwebsite\b|\bURL\b|source page/i,
  )
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
  assert.equal(useCaseSourceMismatch('social_cover', null), null)
  assert.equal(useCaseSourceMismatch('rednote_post', null), null)
  assert.equal(
    useCaseSourceMismatch(
      'social_cover',
      'https://www.amazon.com/dp/B0EXAMPLE1',
    ),
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

// Item 4's central invariant: the explicit creation mapping is the ONLY way a new
// campaign's use_case is chosen, and every literal it can produce must land on the
// same recipe the removed picker would have selected — a byte difference here means
// the mapping is wrong, not that a golden needs regenerating.
test('creation mapping reaches the same recipe identity the picker selected', () => {
  const expectations: Array<[
    { hasSourceUrl: boolean; primarySourceUrlIsAmazon: boolean; outputKind: 'poster' | 'post' },
    'website_product' | 'amazon_listing' | 'social_cover' | 'rednote_post',
  ]> = [
    [{ hasSourceUrl: true, primarySourceUrlIsAmazon: false, outputKind: 'poster' }, 'website_product'],
    [{ hasSourceUrl: true, primarySourceUrlIsAmazon: true, outputKind: 'poster' }, 'amazon_listing'],
    [{ hasSourceUrl: false, primarySourceUrlIsAmazon: false, outputKind: 'poster' }, 'social_cover'],
    [{ hasSourceUrl: true, primarySourceUrlIsAmazon: true, outputKind: 'post' }, 'rednote_post'],
  ]

  for (const [input, pickedId] of expectations) {
    const mapped = resolveCreationUseCase(input)
    assert.equal(mapped, pickedId)
    // Object identity, not deep equality: RedNote and social cover differ only by
    // a literal and an outputMode, so a structural compare would not catch a swap.
    assert.equal(resolveUseCaseRecipe(mapped), resolveUseCaseRecipe(pickedId))
    assert.equal(
      resolveProductUseCaseRecipe(mapped),
      resolveProductUseCaseRecipe(pickedId),
    )
    assert.equal(resolveProductUseCaseRecipe(mapped).id, pickedId)
  }

  // RedNote must keep its own recipe rather than collapsing into social cover.
  assert.notEqual(
    resolveUseCaseRecipe(resolveCreationUseCase({
      hasSourceUrl: false,
      primarySourceUrlIsAmazon: false,
      outputKind: 'post',
    })),
    resolveUseCaseRecipe(resolveCreationUseCase({
      hasSourceUrl: false,
      primarySourceUrlIsAmazon: false,
      outputKind: 'poster',
    })),
  )
})

test('the creation mapping can never produce a source-mismatching pair', () => {
  const websiteUrls = [
    'https://yourproduct.com',
    'https://example.com/product/1',
    'https://amazon.com.evil.example/dp/B0EXAMPLE1',
  ]
  const amazonUrls = [
    'https://www.amazon.com/dp/B0EXAMPLE1',
    'https://a.co/d/abc123',
    'https://amzn.to/xyz',
  ]

  for (const url of websiteUrls) {
    const useCase = resolveCreationUseCase({
      hasSourceUrl: true,
      primarySourceUrlIsAmazon: false,
      outputKind: 'poster',
    })
    assert.equal(useCase, 'website_product')
    assert.equal(useCaseSourceMismatch(useCase, url), null)
  }

  for (const url of amazonUrls) {
    const useCase = resolveCreationUseCase({
      hasSourceUrl: true,
      primarySourceUrlIsAmazon: true,
      outputKind: 'poster',
    })
    assert.equal(useCase, 'amazon_listing')
    assert.equal(useCaseSourceMismatch(useCase, url), null)
  }

  // Reference-only outputs carry no source URL, so the guard stays inert for them
  // while remaining the boundary for legacy or malformed snapshots.
  for (const outputKind of ['poster', 'post'] as const) {
    const useCase = resolveCreationUseCase({
      hasSourceUrl: false,
      primarySourceUrlIsAmazon: false,
      outputKind,
    })
    assert.equal(useCaseSourceMismatch(useCase, null), null)
    assert.equal(useCaseSourceMismatch(useCase, ''), null)
    for (const url of [...websiteUrls, ...amazonUrls]) {
      assert.equal(useCaseSourceMismatch(useCase, url), null)
    }
  }

  // The guard must still reject the pairs the mapping cannot create.
  assert.ok(useCaseSourceMismatch('amazon_listing', 'https://yourproduct.com'))
  assert.ok(
    useCaseSourceMismatch('website_product', 'https://www.amazon.com/dp/B0EXAMPLE1'),
  )
})
