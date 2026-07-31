// One-shot guarded updater for the banded QR-prohibition prompt change.
//
// The general updater (updatePipelinePromptGoldens.ts) refuses to rewrite
// designer bytes, and this change legitimately alters designer.*.user as well as
// hero — so it would abort. Rather than loosen that guard permanently, this
// script pins the change itself: it asserts that the ONLY difference in every
// golden is the banded QR sentence swap, and that stages which must not move
// (all analyze prompts, the event hero, the bandless social prompts) are
// byte-identical. Anything else differing means the source change was wrong, not
// the fixture — which is the whole reason the goldens are byte-pinned.

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

// The exact sentences being replaced. If a golden differs anywhere outside these,
// the run aborts.
const PAINTER_BEFORE =
  'This is a PRINTED POSTER IMAGE, not a web page or app screen: do NOT draw buttons, pills, tabs, or clickable controls. The scannable QR footer bar (printed separately below the artwork) IS the call-to-action, so do NOT render any "Get started" / "Sign up" / "Join now" CTA line or button anywhere — it would be redundant.'
const PAINTER_AFTER =
  'This is a PRINTED POSTER IMAGE, not a web page or app screen: do NOT draw buttons, pills, tabs, or clickable controls. Do NOT render, draw, imitate, or leave space for any QR code, barcode, data matrix, or scannable code anywhere in this artwork — a real scannable QR is added mechanically outside this image afterwards, so any code you paint is a fake that must be discarded. That QR footer bar (printed separately below the artwork) IS the call-to-action, so do NOT render any "Get started" / "Sign up" / "Join now" CTA line or button anywhere — it would be redundant.'
const DESIGNER_RULE_BEFORE =
  'CRITICAL: do NOT add a call-to-action / "Get started" / "Sign up" / "Join now" zone anywhere — the tracked QR footer bar (printed separately below the artwork) IS the call-to-action, so a CTA zone would be redundant. Use the "lower" zone for a closing value prop or proof point instead. '
const DESIGNER_RULE_AFTER =
  'CRITICAL: do NOT add a QR code, barcode, or scannable-code zone, and do NOT reserve space for one — the tracked QR footer bar is composited mechanically below the artwork, outside the layout you are designing. Do NOT add a call-to-action / "Get started" / "Sign up" / "Join now" zone anywhere either — that footer IS the call-to-action, so a CTA zone would be redundant. Use the "lower" zone for a closing value prop or proof point instead. '
const DESIGNER_REQUEST_BEFORE =
  'Design the poster layout JSON now (no CTA zone — the QR footer is the action).'
const DESIGNER_REQUEST_AFTER =
  'Design the poster layout JSON now (no QR/barcode zone and no CTA zone — the composited QR footer is the action).'

const SWAPS: ReadonlyArray<readonly [string, string]> = [
  [PAINTER_BEFORE, PAINTER_AFTER],
  [DESIGNER_RULE_BEFORE, DESIGNER_RULE_AFTER],
  [DESIGNER_REQUEST_BEFORE, DESIGNER_REQUEST_AFTER],
]

const legacyUrl = new URL('../fixtures/pipelinePromptGoldens.json', import.meta.url)
const socialUrl = new URL('../fixtures/socialCoverPromptGoldens.json', import.meta.url)
const socialQrUrl = new URL(
  '../fixtures/socialCoverQrPromptGoldens.json',
  import.meta.url,
)

const legacy = readJson<LegacyPromptGoldens>(legacyUrl)
const social = readJson<SocialPromptGoldens>(socialUrl)
const socialQrStored = readJson<Record<string, unknown>>(socialQrUrl)
const actual = await captureCurrentPipelinePromptGoldens()
const socialQr = await captureSocialCoverQrPromptGoldens()

// Stages that must not move at all: no analyze prompt and no event/bandless
// social prompt mentions the banded QR footer, so any drift is a real defect.
for (const useCase of ['website_product', 'amazon_listing', 'event'] as const) {
  assertChatUnchanged(`analyze.${useCase}`, actual.analyze[useCase], legacy.analyze[useCase])
}
assertChatUnchanged('analyze.social_cover', actual.analyze.social_cover, social.analyze)
assertChatUnchanged('designer.social_cover', actual.designer.social_cover, social.designer)
assertOnlyExpectedSwap('hero.event', actual.hero.event, legacy.hero.event)
assertOnlyExpectedSwap('hero.social_cover', actual.hero.social_cover, social.hero)

// Stages that legitimately change — but only by the sentences above.
for (const useCase of ['website_product', 'amazon_listing'] as const) {
  assertOnlyExpectedSwap(
    `designer.${useCase}.system`,
    actual.designer[useCase].system,
    legacy.designer[useCase].system,
  )
  assertOnlyExpectedSwap(
    `designer.${useCase}.user`,
    actual.designer[useCase].user,
    legacy.designer[useCase].user,
  )
  assertOnlyExpectedSwap(
    `hero.${useCase}`,
    actual.hero[useCase],
    legacy.hero[useCase],
  )
}
assertOnlyExpectedSwapDeep('socialCoverQr', socialQr, socialQrStored)

writeJson(legacyUrl, {
  analyze: legacy.analyze,
  designer: {
    website_product: actual.designer.website_product,
    amazon_listing: actual.designer.amazon_listing,
  },
  hero: {
    website_product: actual.hero.website_product,
    amazon_listing: actual.hero.amazon_listing,
    event: actual.hero.event,
  },
} satisfies LegacyPromptGoldens)
writeJson(socialUrl, {
  analyze: social.analyze,
  designer: social.designer,
  hero: actual.hero.social_cover,
} satisfies SocialPromptGoldens)
writeJson(socialQrUrl, socialQr)

console.log(
  'Updated only the banded QR-prohibition bytes; every other prompt stage was verified byte-identical.',
)

/** Applies the intended swaps to the OLD text and requires an exact match. */
function assertOnlyExpectedSwap(
  label: string,
  actualPrompt: string,
  expectedPrompt: string,
): void {
  let projected = expectedPrompt
  for (const [before, after] of SWAPS) projected = projected.split(before).join(after)
  assert.equal(
    actualPrompt,
    projected,
    `${label} changed beyond the banded QR-prohibition swap; refusing to rewrite fixtures`,
  )
}

function assertOnlyExpectedSwapDeep(
  label: string,
  actualValue: unknown,
  expectedValue: unknown,
): void {
  if (typeof actualValue === 'string' && typeof expectedValue === 'string') {
    assertOnlyExpectedSwap(label, actualValue, expectedValue)
    return
  }
  if (
    actualValue && expectedValue
    && typeof actualValue === 'object' && typeof expectedValue === 'object'
  ) {
    const actualRecord = actualValue as Record<string, unknown>
    const expectedRecord = expectedValue as Record<string, unknown>
    assert.deepEqual(
      Object.keys(actualRecord).sort(),
      Object.keys(expectedRecord).sort(),
      `${label} key set changed; refusing to rewrite fixtures`,
    )
    for (const key of Object.keys(actualRecord)) {
      assertOnlyExpectedSwapDeep(`${label}.${key}`, actualRecord[key], expectedRecord[key])
    }
    return
  }
  assert.deepEqual(actualValue, expectedValue, `${label} changed; refusing to rewrite fixtures`)
}

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
