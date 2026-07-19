import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  captureAnalyzeSourceMode,
  captureCurrentPipelinePromptGoldens,
  type PipelinePromptGoldens,
} from './helpers/pipelinePromptHarness.ts'

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
const actualPromise = captureCurrentPipelinePromptGoldens()

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

test('analyze trace metadata exposes all three product source modes', async () => {
  const website = await captureAnalyzeSourceMode(
    'website_product',
    'https://example.com/products/northstar',
  )
  const amazon = await captureAnalyzeSourceMode(
    'amazon_listing',
    'https://www.amazon.com/dp/B0FIXTURE1',
  )
  const social = await captureAnalyzeSourceMode('social_cover', null)

  assert.deepEqual(
    [website, amazon, social],
    ['website', 'amazon-reference', 'reference-only'],
  )
})
