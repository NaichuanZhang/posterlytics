import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  captureCurrentPipelinePromptGoldens,
  captureSocialCoverQrPromptGoldens,
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

const legacyUrl = new URL('../fixtures/pipelinePromptGoldens.json', import.meta.url)
const socialUrl = new URL('../fixtures/socialCoverPromptGoldens.json', import.meta.url)
const socialQrUrl = new URL(
  '../fixtures/socialCoverQrPromptGoldens.json',
  import.meta.url,
)
const redNoteAnalyzeUrl = new URL(
  '../fixtures/redNoteAnalyzePromptGolden.json',
  import.meta.url,
)
const legacy = readJson<LegacyPromptGoldens>(legacyUrl)
const social = readJson<SocialPromptGoldens>(socialUrl)
const redNoteAnalyze = readJson<
  PipelinePromptGoldens['analyze']['rednote_post']
>(redNoteAnalyzeUrl)
const actual = await captureCurrentPipelinePromptGoldens()
const socialQr = await captureSocialCoverQrPromptGoldens()

for (const useCase of ['website_product', 'amazon_listing', 'event'] as const) {
  assertChatUnchanged(`analyze.${useCase}`, actual.analyze[useCase], legacy.analyze[useCase])
}
for (const useCase of ['website_product', 'amazon_listing'] as const) {
  assertChatUnchanged(
    `designer.${useCase}`,
    actual.designer[useCase],
    legacy.designer[useCase],
  )
}
assertChatUnchanged('analyze.social_cover', actual.analyze.social_cover, social.analyze)
assertChatUnchanged(
  'analyze.rednote_post',
  actual.analyze.rednote_post,
  redNoteAnalyze,
)
assertChatUnchanged('designer.social_cover', actual.designer.social_cover, social.designer)

const nextLegacy: LegacyPromptGoldens = {
  analyze: legacy.analyze,
  designer: legacy.designer,
  hero: {
    website_product: actual.hero.website_product,
    amazon_listing: actual.hero.amazon_listing,
    event: actual.hero.event,
  },
}
const nextSocial: SocialPromptGoldens = {
  analyze: social.analyze,
  designer: social.designer,
  hero: actual.hero.social_cover,
}

writeJson(legacyUrl, nextLegacy)
writeJson(socialUrl, nextSocial)
writeJson(socialQrUrl, socialQr)
console.log(
  'Updated hero and banded-social prompt goldens; existing analyze/designer bytes were unchanged.',
)

function assertChatUnchanged(
  label: string,
  actualPrompt: ChatPrompt,
  expectedPrompt: ChatPrompt,
): void {
  assert.equal(
    actualPrompt.system,
    expectedPrompt.system,
    `${label}.system changed; refusing to rewrite fixtures`,
  )
  assert.equal(
    actualPrompt.user,
    expectedPrompt.user,
    `${label}.user changed; refusing to rewrite fixtures`,
  )
}

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(url, 'utf8')) as T
}

function writeJson(url: URL, value: unknown): void {
  writeFileSync(url, `${JSON.stringify(value, null, 2)}\n`)
}
