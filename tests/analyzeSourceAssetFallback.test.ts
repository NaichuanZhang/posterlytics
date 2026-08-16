import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runAnalyzeSourceAssetFallbackHarness } from './helpers/pipelinePromptHarness.ts'
import { resolveProductUseCaseRecipe } from '../functions/_useCasePolicy.ts'

// "Source website agentic scraping": the board item asked for scraped images and
// text instead of screenshots. Both were already scraped unconditionally
// (functions/analyze.ts:433 for text, :315 for images) — what was missing is that
// ANALYZE itself was never shown those images. With no style board and no user
// uploads it described "observed visual treatment" from text alone, while hero went
// on to paint with the very images analyze never saw. These tests pin both halves.

test('analyze offers the scraped brand assets when no style board exists', async () => {
  const { candidateKinds, candidateUrls } = await runAnalyzeSourceAssetFallbackHarness(
    'empty-evidence',
  )

  assert.deepEqual(candidateKinds, ['logo', 'product'])
  // Re-hosted assets-bucket URLs, never the origin ones: nothing is hot-linked.
  for (const url of candidateUrls) {
    assert.ok(
      !url.startsWith('https://source.example/'),
      `analyze was offered an origin URL rather than a re-hosted one: ${url}`,
    )
  }
})

test('a real style board keeps analyze evidence unchanged', async () => {
  const { candidateKinds } = await runAnalyzeSourceAssetFallbackHarness('with-board')

  // The capture-success path must stay behavior-identical: the board alone, with
  // no scraped assets appended behind it.
  assert.deepEqual(candidateKinds, ['style-board'])
})

test('scraped assets rank below the primary evidence they stand in for', async () => {
  const { candidateKinds, candidatePurposes } =
    await runAnalyzeSourceAssetFallbackHarness('empty-evidence')

  // Logo before product, and both flagged secondary — a scraped product photo must
  // never present itself as the page-level evidence a style board provides.
  assert.ok(candidateKinds.indexOf('logo') < candidateKinds.indexOf('product'))
  for (const purpose of candidatePurposes) {
    assert.match(purpose, /Secondary source evidence/)
  }
})

test('a 200 carrying no evidence still mines the HTML colors', async () => {
  // The hole: an empty-evidence capture reports error === null, so gating the color
  // fallback on captureSucceeded suppressed mining for the one "success" that
  // carries nothing — leaving the palette to a model guess. Gating on
  // hasCapturedEvidence instead runs mining exactly when nothing was captured.
  const { prompt } = await runAnalyzeSourceAssetFallbackHarness('empty-evidence')

  assert.ok(
    prompt.includes('#235789'),
    'expected the scraped theme-color to reach the prompt as mined evidence',
  )
  assert.ok(
    !prompt.includes('(none found — infer restrained defaults)'),
    'empty-evidence capture fell through to no color evidence at all',
  )
})

test('the style-board path still reports captured colors, not mined ones', async () => {
  const { prompt } = await runAnalyzeSourceAssetFallbackHarness('with-board')

  assert.ok(
    !prompt.includes('raw HTML color fallback'),
    'a successful capture must not claim the raw-HTML fallback',
  )
})

test('source-asset purposes hold the model to what the images actually show', () => {
  // These images carry no layout or palette-proportion evidence, so the wording
  // must not invite the model to infer either — that would cross the recorded
  // "no LLM authors color/font extraction" seam.
  const recipe = resolveProductUseCaseRecipe('website_product')

  for (const purpose of [
    recipe.references.analysisSourceLogo,
    recipe.references.analysisSourceImage(1),
  ]) {
    assert.match(purpose, /Secondary source evidence/)
    assert.match(purpose, /no style board is available/)
    assert.match(purpose, /do not infer page layout or palette proportions/)
  }

  // The style board remains the primary evidence wherever it exists.
  assert.match(recipe.references.analysisStyleBoard, /^Primary source evidence/)
})
