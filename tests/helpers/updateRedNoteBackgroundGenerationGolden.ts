import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  captureCurrentPipelinePromptGoldens,
  type PipelinePromptGoldens,
} from './pipelinePromptHarness.ts'

type ChatPrompt = { system: string; user: string }

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

type SocialPromptGoldens = {
  analyze: PipelinePromptGoldens['analyze']['social_cover']
  designer: PipelinePromptGoldens['designer']['social_cover']
  hero: PipelinePromptGoldens['hero']['social_cover']
}

const legacy = readJson<LegacyPromptGoldens>(
  new URL('../fixtures/pipelinePromptGoldens.json', import.meta.url),
)
const social = readJson<SocialPromptGoldens>(
  new URL('../fixtures/socialCoverPromptGoldens.json', import.meta.url),
)
const redNoteAnalyze = readJson<
  PipelinePromptGoldens['analyze']['rednote_post']
>(
  new URL('../fixtures/redNoteAnalyzePromptGolden.json', import.meta.url),
)
const redNoteBackgroundUrl = new URL(
  '../fixtures/redNoteBackgroundGenerationGolden.json',
  import.meta.url,
)
const actual = await captureCurrentPipelinePromptGoldens()

for (const useCase of ['website_product', 'amazon_listing', 'event'] as const) {
  assertChatUnchanged(
    `analyze.${useCase}`,
    actual.analyze[useCase],
    legacy.analyze[useCase],
  )
  assert.equal(
    actual.hero[useCase],
    legacy.hero[useCase],
    `hero.${useCase} changed; refusing to write the RedNote background fixture`,
  )
}
for (const useCase of ['website_product', 'amazon_listing'] as const) {
  assertChatUnchanged(
    `designer.${useCase}`,
    actual.designer[useCase],
    legacy.designer[useCase],
  )
}
assertChatUnchanged(
  'analyze.social_cover',
  actual.analyze.social_cover,
  social.analyze,
)
assertChatUnchanged(
  'designer.social_cover',
  actual.designer.social_cover,
  social.designer,
)
assert.equal(
  actual.hero.social_cover,
  social.hero,
  'hero.social_cover changed; refusing to write the RedNote background fixture',
)
assertChatUnchanged(
  'analyze.rednote_post',
  actual.analyze.rednote_post,
  redNoteAnalyze,
)
assert.equal(
  actual.designer.rednote_post.prompt,
  null,
  'RedNote designer unexpectedly exposed a chat prompt',
)
assert.equal(
  actual.designer.rednote_post.layout.render_mode,
  'rednote-background-v1',
  'RedNote designer layout is missing its render marker',
)

writeFileSync(
  redNoteBackgroundUrl,
  `${JSON.stringify({
    designer: actual.designer.rednote_post,
    hero: actual.hero.rednote_post,
  }, null, 2)}\n`,
)
console.log(
  'Updated only the RedNote background-generation golden; all unaffected prompts were unchanged.',
)

function assertChatUnchanged(
  label: string,
  actualPrompt: ChatPrompt,
  expectedPrompt: ChatPrompt,
): void {
  assert.equal(
    actualPrompt.system,
    expectedPrompt.system,
    `${label}.system changed; refusing to write the RedNote background fixture`,
  )
  assert.equal(
    actualPrompt.user,
    expectedPrompt.user,
    `${label}.user changed; refusing to write the RedNote background fixture`,
  )
}

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(url, 'utf8')) as T
}
