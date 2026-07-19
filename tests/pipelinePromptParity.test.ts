import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  captureAnalyzeSourceMode,
  captureCurrentPipelinePromptGoldens,
  type PipelinePromptGoldens,
} from './helpers/pipelinePromptHarness.ts'

const expected = JSON.parse(readFileSync(
  new URL('./fixtures/pipelinePromptGoldens.json', import.meta.url),
  'utf8',
)) as PipelinePromptGoldens
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

test('analyze trace metadata preserves current website and Amazon source modes', async () => {
  const website = await captureAnalyzeSourceMode(
    'website_product',
    'https://example.com/products/northstar',
  )
  const amazon = await captureAnalyzeSourceMode(
    'amazon_listing',
    'https://www.amazon.com/dp/B0FIXTURE1',
  )

  assert.deepEqual([website, amazon], ['website', 'amazon-reference'])
})
