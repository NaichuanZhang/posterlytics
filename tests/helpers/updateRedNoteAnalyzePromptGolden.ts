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
const redNoteAnalyzeUrl = new URL(
  '../fixtures/redNoteAnalyzePromptGolden.json',
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
    `hero.${useCase} changed; refusing to write the RedNote analyze fixture`,
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
  'hero.social_cover changed; refusing to write the RedNote analyze fixture',
)
assert.deepEqual(
  actual.designer.rednote_post,
  actual.designer.social_cover,
  'designer.rednote_post drifted from designer.social_cover; refusing to write the RedNote analyze fixture',
)
assert.equal(
  actual.hero.rednote_post,
  actual.hero.social_cover,
  'hero.rednote_post drifted from hero.social_cover; refusing to write the RedNote analyze fixture',
)
assert.notDeepEqual(
  actual.analyze.rednote_post,
  actual.analyze.social_cover,
  'analyze.rednote_post did not diverge from social_cover',
)

writeFileSync(
  redNoteAnalyzeUrl,
  `${JSON.stringify(actual.analyze.rednote_post, null, 2)}\n`,
)
console.log(
  'Updated only the RedNote analyze prompt golden; all unaffected prompts were unchanged.',
)

function assertChatUnchanged(
  label: string,
  actualPrompt: ChatPrompt,
  expectedPrompt: ChatPrompt,
): void {
  assert.equal(
    actualPrompt.system,
    expectedPrompt.system,
    `${label}.system changed; refusing to write the RedNote analyze fixture`,
  )
  assert.equal(
    actualPrompt.user,
    expectedPrompt.user,
    `${label}.user changed; refusing to write the RedNote analyze fixture`,
  )
}

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(url, 'utf8')) as T
}
