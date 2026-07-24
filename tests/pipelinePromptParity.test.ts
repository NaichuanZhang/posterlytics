import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  HERO_FIXTURE_POSTER_KEY,
  HERO_FIXTURE_RETRY_POSTER_KEY,
  captureEmojiStrippedHeroPrompt,
  captureRedNoteAnalyzeFallbackDiagnostics,
  captureAnalyzeSourceMode,
  captureCurrentPipelinePromptGoldens,
  captureHeroArtifactValidationDiagnostics,
  captureRedNotePipelineDiagnostics,
  type HeroArtifactValidationDiagnostics,
  type PipelinePromptGoldens,
} from './helpers/pipelinePromptHarness.ts'
import {
  projectRedNotePostPlanToPosterContent,
  splitRedNoteSourceCopy,
} from '../src/lib/redNotePost.ts'

type LegacyPromptGoldens = {
  analyze: Pick<
    PipelinePromptGoldens['analyze'],
    'website_product' | 'amazon_listing' | 'event'
  >
  designer: Pick<
    PipelinePromptGoldens['designer'],
    'website_product' | 'amazon_listing'
  >
  hero: Pick<
    PipelinePromptGoldens['hero'],
    'website_product' | 'amazon_listing' | 'event'
  >
}

const expected = JSON.parse(readFileSync(
  new URL('./fixtures/pipelinePromptGoldens.json', import.meta.url),
  'utf8',
)) as LegacyPromptGoldens
const socialExpected = JSON.parse(readFileSync(
  new URL('./fixtures/socialCoverPromptGoldens.json', import.meta.url),
  'utf8',
)) as {
  analyze: PipelinePromptGoldens['analyze']['social_cover']
  designer: PipelinePromptGoldens['designer']['social_cover']
  hero: PipelinePromptGoldens['hero']['social_cover']
}
const redNoteAnalyzeExpected = JSON.parse(readFileSync(
  new URL('./fixtures/redNoteAnalyzePromptGolden.json', import.meta.url),
  'utf8',
)) as PipelinePromptGoldens['analyze']['rednote_post']
const redNoteBackgroundExpected = JSON.parse(readFileSync(
  new URL('./fixtures/redNoteBackgroundGenerationGolden.json', import.meta.url),
  'utf8',
)) as {
  designer: PipelinePromptGoldens['designer']['rednote_post']
  hero: PipelinePromptGoldens['hero']['rednote_post']
}
const actualPromise = captureCurrentPipelinePromptGoldens()
const redNoteDiagnosticsPromise = actualPromise.then(
  () => captureRedNotePipelineDiagnostics(),
)
const redNoteFallbackPromise = redNoteDiagnosticsPromise.then(
  () => captureRedNoteAnalyzeFallbackDiagnostics(),
)
const emojiHeroPromptPromise = redNoteFallbackPromise.then(
  () => captureEmojiStrippedHeroPrompt(),
)

test('website and Amazon analyze prompts match the pre-recipe byte goldens', async () => {
  const actual = await actualPromise

  assert.equal(
    actual.analyze.website_product.system,
    expected.analyze.website_product.system,
  )
  assert.equal(
    actual.analyze.website_product.user,
    expected.analyze.website_product.user,
  )
  assert.equal(
    actual.analyze.amazon_listing.system,
    expected.analyze.amazon_listing.system,
  )
  assert.equal(
    actual.analyze.amazon_listing.user,
    expected.analyze.amazon_listing.user,
  )
})

test('website and Amazon designer and hero prompts match the pre-recipe byte goldens', async () => {
  const actual = await actualPromise

  for (const useCase of ['website_product', 'amazon_listing'] as const) {
    assert.equal(
      actual.designer[useCase].system,
      expected.designer[useCase].system,
    )
    assert.equal(
      actual.designer[useCase].user,
      expected.designer[useCase].user,
    )
    assert.equal(actual.hero[useCase], expected.hero[useCase])
  }
})

test('event analyze and hero prompts match the pre-recipe byte goldens', async () => {
  const actual = await actualPromise

  assert.equal(actual.analyze.event.system, expected.analyze.event.system)
  assert.equal(actual.analyze.event.user, expected.analyze.event.user)
  assert.equal(actual.hero.event, expected.hero.event)
})

test('social analyze, designer, and hero prompts match their own goldens', async () => {
  const actual = await actualPromise

  assert.deepEqual(actual.analyze.social_cover, socialExpected.analyze)
  assert.deepEqual(actual.designer.social_cover, socialExpected.designer)
  assert.equal(actual.hero.social_cover, socialExpected.hero)
})

test('RedNote pins its own analyze, deterministic designer, and background hero contracts', async () => {
  const actual = await actualPromise

  assert.deepEqual(actual.analyze.rednote_post, redNoteAnalyzeExpected)
  assert.deepEqual(
    actual.designer.rednote_post,
    redNoteBackgroundExpected.designer,
  )
  assert.equal(actual.designer.rednote_post.prompt, null)
  assert.equal(
    actual.designer.rednote_post.layout.render_mode,
    'rednote-background-v1',
  )
  assert.equal(actual.hero.rednote_post, redNoteBackgroundExpected.hero)
  assert.notDeepEqual(actual.designer.rednote_post, actual.designer.social_cover)
  assert.notEqual(actual.hero.rednote_post, actual.hero.social_cover)
})

test('RedNote keeps the exact model-call budget and persists its page plan and marker', async () => {
  assert.deepEqual(await redNoteDiagnosticsPromise, {
    analyzeChatCalls: 1,
    analyzeImageCalls: 0,
    assetChatCalls: 0,
    assetImageCalls: 0,
    designerChatCalls: 0,
    designerImageCalls: 0,
    heroChatCalls: 1,
    heroImageCalls: 1,
    wroteRedNotePost: true,
    persistedPosterContent: {
      headline: 'Make the light the hook',
      what_it_does: 'Keep the mood kinetic',
      how_it_works: [],
      why_use_it: [],
      features: ['Lead with motion', 'Hold the focus'],
      cta: '',
      rednote_post: {
        schema_version: 1,
        pages: [
          {
            kind: 'cover',
            title: 'Make the light the hook',
            subtitle: 'Keep the mood kinetic',
          },
          {
            kind: 'content',
            heading: 'Lead with motion',
            blocks: ['Build the composition around a diagonal sweep.'],
          },
          {
            kind: 'content',
            heading: 'Hold the focus',
            blocks: ['Let the light band carry the visual hook.'],
          },
        ],
      },
    },
    redNoteSchemaVersion: 1,
    redNotePageCount: 3,
    persistedRenderMode: 'rednote-background-v1',
    designerArtifactRenderMode: 'rednote-background-v1',
    campaignRenderMode: 'rednote-background-v1',
  })
})

test('RedNote analyze treats draft copy as the sole factual copy source', async () => {
  const actual = await actualPromise
  const system = actual.analyze.rednote_post.system
  const user = actual.analyze.rednote_post.user

  assert.match(user, /SOURCE DRAFT COPY:/)
  assert.doesNotMatch(user, /CREATIVE CONTEXT FROM THE USER:/)
  assert.match(system, /without inventing facts, claims, experiences, or offers/)
  assert.match(system, /Do not translate unless the user explicitly requests/)
  assert.match(system, /exactly one leading cover followed by 1-8 ordered content pages/)
  assert.match(system, /meaningful CJK punctuation/)
  assert.match(system, /visual evidence only/)
})

test('RedNote projects deterministic draft copy after both analyze attempts fail', async () => {
  const fallbackPlan = splitRedNoteSourceCopy({
    title: 'Summer Signals',
    subtitle: 'A new season in motion',
    sourceCopy:
      'Keep the mood kinetic and make the diagonal light band the visual hook.',
  })

  assert.deepEqual(await redNoteFallbackPromise, {
    analyzeChatCalls: 1,
    analyzeImageCalls: 0,
    usedFallback: true,
    posterContent: projectRedNotePostPlanToPosterContent(fallbackPlan),
  })
})

test('hero stage strips source-approved emoji from the returned painter prompt', async () => {
  const prompt = await emojiHeroPromptPromise

  for (const emoji of ['💬', '🟠', '⚙️', '🔍', '☕']) {
    assert.equal(prompt.includes(emoji), false)
  }
  assert.match(prompt, /Render the exact text: "Taskpilot"/)
  assert.match(prompt, /Render the exact text: "Plan tasks together"/)
  assert.match(prompt, /Render the exact text: "See progress"/)
  assert.match(
    prompt,
    /USER REQUEST: Keep the hierarchy focused and show the workflow\./,
  )
})

test('hero validation keeps a clean initial poster at the canonical key', async () => {
  const result = await captureHeroArtifactValidationDiagnostics()

  assert.equal(result.responseStatus, 200)
  assert.equal(result.generationStatus, 'ready')
  assert.equal(result.imageRequests, 1)
  assert.equal(result.chatRequests, 1)
  assert.equal(result.responsePrompt, expected.hero.website_product)
  assertSelectedPoster(result, HERO_FIXTURE_POSTER_KEY, [1])
  assert.deepEqual(result.storageUploads, [HERO_FIXTURE_POSTER_KEY])
  assert.deepEqual(result.storageRemovals, [])
  assert.deepEqual(result.storedPosterKeys, [HERO_FIXTURE_POSTER_KEY])
  assert.equal(result.traceMetadata.outcome, 'clean')
  assert.equal(result.traceMetadata.selected_attempt, 'initial')
  assert.equal(result.traceMetadata.validation_calls, 1)
})

test('hero validation retries once on detected pixels and accepts only a clean uploaded replacement', async () => {
  const result = await captureHeroArtifactValidationDiagnostics({
    chatResponses: [
      {
        has_decorative_glyphs: true,
        has_slot_label_words: false,
        has_adjacent_duplicate_words: false,
        notes: 'Brain icon beside the first bullet.',
      },
      {
        has_decorative_glyphs: false,
        has_slot_label_words: false,
        has_adjacent_duplicate_words: false,
        notes: '',
      },
    ],
  })

  assert.equal(result.responseStatus, 200)
  assert.equal(result.generationStatus, 'ready')
  assert.equal(result.imageRequests, 2)
  assert.equal(result.chatRequests, 2)
  assert.equal(result.imagePrompts[0], expected.hero.website_product)
  assert.ok(result.imagePrompts[1].startsWith(result.imagePrompts[0]))
  assert.match(result.imagePrompts[1], /RETRY-ONLY RASTER CORRECTION/)
  assert.match(result.imagePrompts[1], /decorative icon glyphs/)
  assert.doesNotMatch(result.imagePrompts[1], /Brain icon beside/)
  assert.equal(result.responsePrompt, result.imagePrompts[1])
  assertSelectedPoster(result, HERO_FIXTURE_RETRY_POSTER_KEY, [2])
  assert.deepEqual(result.storageUploads, [
    HERO_FIXTURE_POSTER_KEY,
    HERO_FIXTURE_RETRY_POSTER_KEY,
  ])
  assert.deepEqual(result.storageRemovals, [HERO_FIXTURE_POSTER_KEY])
  assert.deepEqual(result.storedPosterKeys, [HERO_FIXTURE_RETRY_POSTER_KEY])
  assert.deepEqual(result.operationLog, [
    `storage.upload:${HERO_FIXTURE_POSTER_KEY}`,
    `storage.upload:${HERO_FIXTURE_RETRY_POSTER_KEY}`,
    'rpc:complete_poster_generation_for_worker',
    `storage.remove:${HERO_FIXTURE_POSTER_KEY}`,
  ])
  assertCompletionPrecedesRemoval(result, HERO_FIXTURE_POSTER_KEY)
  assert.deepEqual(result.rpcCalls, ['complete_poster_generation_for_worker'])
  assert.deepEqual(
    (result.modelCalls as Array<{ operation: string }>).map((call) => call.operation),
    ['image', 'chat', 'image', 'chat'],
  )
  assert.equal(result.traceMetadata.outcome, 'corrected')
  assert.equal(result.traceMetadata.selected_attempt, 'retry')
  assert.equal(result.traceMetadata.validation_calls, 2)
  assert.equal(
    JSON.stringify(result.modelCalls).includes('data:image'),
    false,
  )
  assert.match(chatImageUrl(result.chatBodies[0]), /\/poster\.png\?/)
  assert.match(chatImageUrl(result.chatBodies[1]), /\/poster\.retry\.png\?/)
  for (const body of result.chatBodies) {
    assert.match(chatImageUrl(body), /^https:\/\/assets\.example\//)
    assert.doesNotMatch(chatImageUrl(body), /^data:/)
  }
})

test('hero validation failure is fail-open in worker and standalone modes', async () => {
  for (const mode of [
    { serverOwned: true, finalizeFailure: false, rpc: 'complete_poster_generation_for_worker' },
    { serverOwned: false, finalizeFailure: true, rpc: 'complete_poster_generation' },
  ]) {
    const result = await captureHeroArtifactValidationDiagnostics({
      failChatAt: 0,
      serverOwned: mode.serverOwned,
      finalizeFailure: mode.finalizeFailure,
    })

    assert.equal(result.responseStatus, 200)
    assert.equal(result.generationStatus, 'ready')
    assert.equal(result.imageRequests, 1)
    assert.equal(result.chatRequests, 1)
    assertSelectedPoster(result, HERO_FIXTURE_POSTER_KEY, [1])
    assert.deepEqual(result.storageUploads, [HERO_FIXTURE_POSTER_KEY])
    assert.deepEqual(result.storageRemovals, [])
    assert.deepEqual(result.storedPosterKeys, [HERO_FIXTURE_POSTER_KEY])
    assert.deepEqual(result.rpcCalls, [mode.rpc])
    assert.equal(result.traceMetadata.outcome, 'unavailable')
    assert.equal(result.traceMetadata.selected_attempt, 'initial')
    assert.match(result.warningLogs.join('\n'), /painter_artifact_validation_failed/)
  }
})

test('residual retry keeps the initial poster and deletes the candidate', async () => {
  const artifactVerdict = {
    has_decorative_glyphs: false,
    has_slot_label_words: false,
    has_adjacent_duplicate_words: true,
    notes: 'The lower line reads management management.',
  }
  const result = await captureHeroArtifactValidationDiagnostics({
    chatResponses: [artifactVerdict, artifactVerdict],
  })

  assert.equal(result.generationStatus, 'ready')
  assert.equal(result.imageRequests, 2)
  assert.equal(result.chatRequests, 2)
  assertSelectedPoster(result, HERO_FIXTURE_POSTER_KEY, [1])
  assert.deepEqual(result.storageUploads, [
    HERO_FIXTURE_POSTER_KEY,
    HERO_FIXTURE_RETRY_POSTER_KEY,
  ])
  assert.deepEqual(result.storageRemovals, [HERO_FIXTURE_RETRY_POSTER_KEY])
  assert.deepEqual(result.storedPosterKeys, [HERO_FIXTURE_POSTER_KEY])
  assertCompletionPrecedesRemoval(result, HERO_FIXTURE_RETRY_POSTER_KEY)
  assert.equal(result.responsePrompt, result.imagePrompts[0])
  assert.equal(result.traceMetadata.outcome, 'residual')
  assert.equal(result.traceMetadata.selected_attempt, 'initial')
  assert.match(result.warningLogs.join('\n'), /painter_artifact_residual/)
  assert.deepEqual(
    (result.modelCalls as Array<{ operation: string }>).map((call) => call.operation),
    ['image', 'chat', 'image', 'chat'],
  )
})

test('retry upload failure keeps the initial poster and cleans the candidate key', async () => {
  const result = await captureHeroArtifactValidationDiagnostics({
    chatResponses: [{
      has_decorative_glyphs: true,
      has_slot_label_words: false,
      has_adjacent_duplicate_words: false,
      notes: 'Brain icon beside the first bullet.',
    }],
    failStorageUploadKeys: [HERO_FIXTURE_RETRY_POSTER_KEY],
  })

  assert.equal(result.responseStatus, 200)
  assert.equal(result.generationStatus, 'ready')
  assert.equal(result.imageRequests, 2)
  assert.equal(result.chatRequests, 1)
  assertSelectedPoster(result, HERO_FIXTURE_POSTER_KEY, [1])
  assert.deepEqual(result.storageUploads, [
    HERO_FIXTURE_POSTER_KEY,
    HERO_FIXTURE_RETRY_POSTER_KEY,
  ])
  assert.deepEqual(result.storageRemovals, [HERO_FIXTURE_RETRY_POSTER_KEY])
  assert.deepEqual(result.storedPosterKeys, [HERO_FIXTURE_POSTER_KEY])
  assertCompletionPrecedesRemoval(result, HERO_FIXTURE_RETRY_POSTER_KEY)
  assert.equal(result.traceMetadata.outcome, 'retry_failed')
  assert.equal(result.traceMetadata.selected_attempt, 'initial')
  assert.match(result.warningLogs.join('\n'), /painter_artifact_retry_failed/)
})

test('retry decode failure keeps the initial uploaded poster', async () => {
  const result = await captureHeroArtifactValidationDiagnostics({
    chatResponses: [{
      has_decorative_glyphs: false,
      has_slot_label_words: true,
      has_adjacent_duplicate_words: false,
      notes: 'CTA appears in the lower corner.',
    }],
    imageSources: [
      'data:image/png;base64,AQ==',
      'data:image/png;base64,%%%',
    ],
  })

  assert.equal(result.generationStatus, 'ready')
  assert.equal(result.imageRequests, 2)
  assert.equal(result.chatRequests, 1)
  assertSelectedPoster(result, HERO_FIXTURE_POSTER_KEY, [1])
  assert.deepEqual(result.storageUploads, [HERO_FIXTURE_POSTER_KEY])
  assert.deepEqual(result.storageRemovals, [])
  assert.deepEqual(result.storedPosterKeys, [HERO_FIXTURE_POSTER_KEY])
  assert.equal(result.traceMetadata.outcome, 'retry_failed')
  assert.equal(result.traceMetadata.selected_attempt, 'initial')
  assert.match(result.warningLogs.join('\n'), /painter_artifact_retry_failed/)
})

test('retry judge failure keeps the initial poster and deletes the uploaded candidate', async () => {
  const result = await captureHeroArtifactValidationDiagnostics({
    chatResponses: [
      {
        has_decorative_glyphs: false,
        has_slot_label_words: true,
        has_adjacent_duplicate_words: false,
        notes: 'CTA appears in the lower corner.',
      },
      {
        has_decorative_glyphs: false,
        has_slot_label_words: false,
        has_adjacent_duplicate_words: false,
        notes: '',
      },
    ],
    failChatAt: 1,
  })

  assert.equal(result.responseStatus, 200)
  assert.equal(result.generationStatus, 'ready')
  assert.equal(result.imageRequests, 2)
  assert.equal(result.chatRequests, 2)
  assertSelectedPoster(result, HERO_FIXTURE_POSTER_KEY, [1])
  assert.deepEqual(result.storageUploads, [
    HERO_FIXTURE_POSTER_KEY,
    HERO_FIXTURE_RETRY_POSTER_KEY,
  ])
  assert.deepEqual(result.storageRemovals, [HERO_FIXTURE_RETRY_POSTER_KEY])
  assert.deepEqual(result.storedPosterKeys, [HERO_FIXTURE_POSTER_KEY])
  assertCompletionPrecedesRemoval(result, HERO_FIXTURE_RETRY_POSTER_KEY)
  assert.equal(result.traceMetadata.outcome, 'retry_failed')
  assert.equal(result.traceMetadata.selected_attempt, 'initial')
  assert.equal(result.traceMetadata.validation_calls, 2)
  assert.match(result.warningLogs.join('\n'), /painter_artifact_retry_failed/)
})

test('loser cleanup failure is logged without changing the ready selection', async () => {
  const artifactVerdict = {
    has_decorative_glyphs: false,
    has_slot_label_words: false,
    has_adjacent_duplicate_words: true,
    notes: 'The lower line reads management management.',
  }
  const result = await captureHeroArtifactValidationDiagnostics({
    chatResponses: [artifactVerdict, artifactVerdict],
    failStorageRemoveKeys: [HERO_FIXTURE_RETRY_POSTER_KEY],
  })

  assert.equal(result.responseStatus, 200)
  assert.equal(result.generationStatus, 'ready')
  assertSelectedPoster(result, HERO_FIXTURE_POSTER_KEY, [1])
  assert.deepEqual(result.storageRemovals, [HERO_FIXTURE_RETRY_POSTER_KEY])
  assert.deepEqual(result.storedPosterKeys, [
    HERO_FIXTURE_POSTER_KEY,
    HERO_FIXTURE_RETRY_POSTER_KEY,
  ])
  assertCompletionPrecedesRemoval(result, HERO_FIXTURE_RETRY_POSTER_KEY)
  assert.equal(result.traceMetadata.outcome, 'residual')
  assert.equal(result.traceMetadata.selected_attempt, 'initial')
  assert.match(
    result.warningLogs.join('\n'),
    /painter_artifact_loser_cleanup_failed/,
  )
})

test('painter validation kill switch preserves the pre-validation hero path', async () => {
  const result = await captureHeroArtifactValidationDiagnostics({
    painterValidationEnabled: 'off',
  })

  assert.equal(result.generationStatus, 'ready')
  assert.equal(result.imageRequests, 1)
  assert.equal(result.chatRequests, 0)
  assert.equal(result.responsePrompt, expected.hero.website_product)
  assertSelectedPoster(result, HERO_FIXTURE_POSTER_KEY, [1])
  assert.deepEqual(result.storageUploads, [HERO_FIXTURE_POSTER_KEY])
  assert.deepEqual(result.storageRemovals, [])
  assert.deepEqual(result.traceMetadata, {})
})

test('social prompts contain reference and platform semantics without URL evidence language', async () => {
  const actual = await actualPromise
  const prompts = [
    actual.analyze.social_cover.system,
    actual.analyze.social_cover.user,
    actual.designer.social_cover.system,
    actual.designer.social_cover.user,
    actual.hero.social_cover,
  ].join('\n')

  assert.match(prompts, /creative reference/i)
  assert.match(prompts, /visual hook/i)
  assert.match(prompts, /TARGET PLATFORM HINT: Instagram/)
  assert.doesNotMatch(
    prompts,
    /\b(?:website|browser|DOM|URL)\b|source page|web page/i,
  )
})

function chatImageUrl(body: Record<string, unknown>): string {
  const messages = body.messages as Array<{ content?: unknown }>
  const content = messages?.find((message) => Array.isArray(message.content))
    ?.content as Array<Record<string, unknown>> | undefined
  const image = content?.find((part) => part.type === 'image_url') as {
    image_url?: { url?: unknown }
  } | undefined
  return typeof image?.image_url?.url === 'string'
    ? image.image_url.url
    : ''
}

function assertSelectedPoster(
  result: HeroArtifactValidationDiagnostics,
  expectedKey: string,
  expectedBytes: number[],
): void {
  assert.equal(result.heroImageKey, expectedKey)
  assert.deepEqual(result.finalPosterBytes, expectedBytes)
  assert.equal(result.storedPosterKeys.includes(expectedKey), true)
}

function assertCompletionPrecedesRemoval(
  result: HeroArtifactValidationDiagnostics,
  removedKey: string,
): void {
  const completionIndex = result.operationLog.indexOf(
    'rpc:complete_poster_generation_for_worker',
  )
  const removalIndex = result.operationLog.indexOf(
    `storage.remove:${removedKey}`,
  )
  assert.notEqual(completionIndex, -1)
  assert.notEqual(removalIndex, -1)
  assert.ok(completionIndex < removalIndex)
}

test('analyze trace metadata exposes every product source mode', async () => {
  const website = await captureAnalyzeSourceMode(
    'website_product',
    'https://example.com/products/northstar',
  )
  const amazon = await captureAnalyzeSourceMode(
    'amazon_listing',
    'https://www.amazon.com/dp/B0FIXTURE1',
  )
  const social = await captureAnalyzeSourceMode('social_cover', null)
  const redNote = await captureAnalyzeSourceMode('rednote_post', null)

  assert.deepEqual(
    [website, amazon, social, redNote],
    ['website', 'amazon-reference', 'reference-only', 'reference-only'],
  )
})
