import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import process from 'node:process'
import { chromium } from 'playwright'

const HOST = '127.0.0.1'
const PORT = 4174
const BASE_URL = `http://${HOST}:${PORT}`
const OUTPUT_DIR = 'test-results/asset-review'
const EDITOR_MODE_DESCRIPTION = 'Review, include, exclude, and reorder images before generation.'
const YOLO_MODE_DESCRIPTION = 'Let AI select and order images automatically, with no manual review step.'

await mkdir(OUTPUT_DIR, { recursive: true })

const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    '--host',
    HOST,
    '--port',
    String(PORT),
    '--strictPort',
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VITE_INSFORGE_URL: BASE_URL,
      VITE_INSFORGE_ANON_KEY: 'asset-review-ui-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)

let serverOutput = ''
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString() })
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString() })

let browser
try {
  await waitForServer()
  browser = await chromium.launch({ headless: true })
  await testDesktopAutosaveResumeAndCancel(browser)
  await testAutosaveFailureRetry(browser)
  await testMobileZeroSelectionConfirmation(browser)
  await testActivityRouting(browser)
  await testGenerationDetailsSummary(browser)
  await testFailedGenerationDetails(browser)
  await testCampaignWizardUseCases(browser)
  await testCampaignWizardDraftSwitch(browser)
  await testCampaignWizardPreference(browser)
  await testEditorUseCaseInputs(browser)
  await testSocialCoverFrozenHint(browser)
  await testQrBandEdgeSamplingAndExport(browser)
  await testQrBandSamplingFallback(browser)
  await testRedNoteCoverFormat(browser)
  await testAssetModeTooltips(browser)
  await testBothEntryModes(browser)
  console.log(`asset review UI smoke passed; screenshots: ${OUTPUT_DIR}`)
} finally {
  await browser?.close()
  server.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ])
}

async function testDesktopAutosaveResumeAndCancel(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  const state = createState()
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(reviewUrl())
  await page.getByRole('heading', { name: 'Generation assets' }).waitFor()
  await page.getByText('2/6', { exact: true }).waitFor()

  let included = page.locator('.asset-card.is-included')
  await included.nth(0).dragTo(included.nth(1))
  await waitFor(() => state.savedSelections.at(-1)?.join(',') === 'asset-b,asset-a')

  included = page.locator('.asset-card.is-included')
  await included.nth(0).getByRole('button', { name: /Reorder/ }).focus()
  await page.keyboard.press('ArrowDown')
  await waitFor(() => state.savedSelections.at(-1)?.join(',') === 'asset-a,asset-b')

  await page.reload()
  await page.getByText('2/6', { exact: true }).waitFor()
  assert.deepEqual(
    await page.locator('.asset-card.is-included .asset-card-title strong').allTextContents(),
    ['Previous poster', 'Style board'],
  )
  await assertNoOverflow(page)
  await page.screenshot({ path: `${OUTPUT_DIR}/review-desktop.png`, fullPage: true })

  for (const name of ['Previous poster', 'Style board']) {
    await page.locator('.asset-card').filter({ hasText: name })
      .getByRole('button', { name: 'Included' })
      .click()
  }
  await page.getByText('0/6', { exact: true }).waitFor()
  await page.getByText('No images selected. Generation will use text context only.').waitFor()
  await waitFor(() => state.savedSelections.at(-1)?.length === 0)

  await page.getByRole('button', { name: 'Cancel review' }).click()
  await page.getByRole('button', { name: 'Cancel generation' }).click()
  await page.waitForURL(`${BASE_URL}/campaigns/campaign-asset`)
  assert.equal(state.cancelCalls, 1)
  await assertNoOverflow(page)
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testAutosaveFailureRetry(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1180, height: 820 },
    reducedMotion: 'reduce',
  })
  const state = createState({ saveFailuresRemaining: 1 })
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(reviewUrl())
  await page.getByText('2/6', { exact: true }).waitFor()
  const reorder = page.locator('.asset-card.is-included').nth(0)
    .getByRole('button', { name: /Reorder/ })
  await reorder.focus()
  await page.keyboard.press('ArrowDown')
  await waitFor(() => state.saveAttempts.length === 1)

  await page.getByText("We couldn't save your image selection. Try again.").waitFor()
  const retry = page.getByRole('button', { name: 'Retry save' })
  await retry.waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Confirm and generate' }).isDisabled(),
    true,
  )
  assert.deepEqual(
    await page.locator('.asset-card.is-included .asset-card-title strong').allTextContents(),
    ['Style board', 'Previous poster'],
  )
  assert.equal(
    (await page.locator('body').innerText()).includes('idx_generation_assets_selected_rank'),
    false,
  )
  await assertNoOverflow(page)
  await page.screenshot({ path: `${OUTPUT_DIR}/save-retry-desktop.png`, fullPage: true })

  await retry.click()
  await waitFor(() => state.saveAttempts.length === 2 && state.savedSelections.length === 1)
  assert.deepEqual(state.saveAttempts, [
    ['asset-b', 'asset-a'],
    ['asset-b', 'asset-a'],
  ])
  await page.getByText('Saved', { exact: true }).waitFor()
  assert.equal(await retry.count(), 0)
  assert.equal(
    await page.getByRole('button', { name: 'Confirm and generate' }).isEnabled(),
    true,
  )
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testMobileZeroSelectionConfirmation(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  const state = createState({ selectedIds: [] })
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(reviewUrl())
  await page.getByText('0/6', { exact: true }).waitFor()
  await page.getByText('No images selected. Generation will use text context only.').waitFor()
  await assertNoOverflow(page)
  await page.screenshot({ path: `${OUTPUT_DIR}/zero-selection-mobile.png`, fullPage: true })
  await page.getByRole('button', { name: 'Confirm and generate' }).click()
  await page.waitForURL(`${BASE_URL}/campaigns/campaign-asset`)
  assert.deepEqual(state.confirmedSelections, [[]])
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testActivityRouting(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 840 },
    reducedMotion: 'reduce',
  })
  const state = createState({ awaitingReviewActivity: true })
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await page.getByRole('link', { name: 'Review assets' }).waitFor()
  await page.getByRole('button', { name: /Generation activity/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Generation activity' })
  await dialog.getByText('Assets ready for review', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Review assets' }).click()
  await page.waitForURL(reviewUrl())
  await page.getByText('2/6', { exact: true }).waitFor()
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testGenerationDetailsSummary(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  await context.addInitScript(() => {
    window.__generationDetailsClipboardWrites = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(value) {
          window.__generationDetailsClipboardWrites.push(String(value))
          return Promise.resolve()
        },
      },
    })
  })
  const state = createState({ editorReady: true })
  state.currentGeneration = {
    ...state.currentGeneration,
    trace_schema_version: 2,
    reference_images: [{
      key: 'references/support.svg',
      url: `${BASE_URL}/fixture/support.svg`,
      name: 'support.svg',
      mime_type: 'image/svg+xml',
      size_bytes: 120,
    }],
    asset_selection_mode: 'yolo',
    asset_selection_status: 'completed',
    asset_selection_method: 'rules_fallback',
    asset_selection_completed_at: state.now,
  }
  state.assets = state.assets.map((candidate, index) => ({
    ...candidate,
    generation_id: state.currentGeneration.id,
    included: index < 2,
    selection_rank: index < 2 ? index + 1 : null,
    selection_reason: index < 2
      ? 'Keeps the strongest product and visual-system evidence.'
      : 'Lower relevance after the selected visual anchors.',
    provider_skips: index === 1
      ? [{
          stage: 'hero',
          reason: 'fetch_failed',
          detail: 'Hero could not fetch the frozen style board.',
          recorded_at: state.now,
        }]
      : [],
  }))
  state.traces = createTraceFixtures(state)
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await page.getByRole('heading', { name: 'Create next version' }).waitFor()
  await page.getByRole('button', { name: 'Generation details' }).click()

  const dialog = page.getByRole('dialog', { name: 'Generation details' })
  await dialog.waitFor()
  const prompt = dialog.getByRole('region', { name: 'User prompt' })
  const provided = dialog.getByRole('region', { name: 'Images provided' })
  const used = dialog.getByRole('region', { name: 'Images used for the poster' })
  await used.getByRole('img', { name: 'Previous poster' }).waitFor()

  assert.equal(await prompt.locator('p').innerText(), 'Increase visual contrast.')
  assert.deepEqual(
    await provided.locator('figcaption strong').allTextContents(),
    ['Supporting image 1'],
  )
  assert.deepEqual(
    await used.locator('figcaption strong').allTextContents(),
    ['Previous poster', 'Style board'],
  )
  assert.equal(await dialog.getByRole('tab').count(), 0)
  assert.deepEqual(
    await dialog.getByRole('button').evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label'))
    ),
    ['Close generation details'],
  )
  const dialogText = await dialog.innerText()
  for (const secret of [
    'PRIVATE_SYSTEM_PROMPT',
    'PRIVATE_COMPILED_USER_PROMPT',
    'PRIVATE_IMAGE_PROMPT',
    'PRIVATE_PROVIDER',
    'PRIVATE_MODEL_ID',
    'PRIVATE_PROVIDER_SETTING',
    'PRIVATE_MANIFEST_VALUE',
    'PRIVATE_ARTIFACT_VALUE',
    'PRIVATE_SKIP_DETAIL',
    'PRIVATE_STAGE_FAILURE_CODE',
    'PRIVATE_STAGE_FAILURE_MESSAGE',
    'PRIVATE_FAILURE_METADATA',
  ]) {
    assert.equal(dialogText.includes(secret), false, secret)
  }
  assert.equal(dialogText.includes('Selection audit'), false)
  assert.equal(dialogText.includes('Request manifest'), false)
  assert.equal(dialogText.includes('Copy manifest'), false)
  assert.equal(dialogText.includes('Stage artifacts'), false)
  assert.equal(await dialog.getByRole('button', { name: /copy/i }).count(), 0)
  assert.equal(await dialog.locator('details, summary').count(), 0)
  assert.ok(state.traceRequests.length >= 1)
  for (const requestUrl of state.traceRequests) {
    const traceRequest = new URL(requestUrl)
    assert.equal(traceRequest.searchParams.get('select'), 'attached_images')
    assert.equal(traceRequest.searchParams.get('generation_id'), `eq.${state.currentGeneration.id}`)
    assert.equal(traceRequest.searchParams.get('stage'), 'eq.hero')
  }
  await assertNoOverflow(page)
  await page.screenshot({ path: `${OUTPUT_DIR}/generation-details-summary-desktop.png`, fullPage: true })
  await dialog.getByRole('button', { name: 'Close generation details' }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.deepEqual(
    await page.evaluate(() => window.__generationDetailsClipboardWrites),
    [],
  )
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testFailedGenerationDetails(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1180, height: 820 },
    reducedMotion: 'reduce',
  })
  const state = createState({ editorReady: true })
  state.failedGenerations = [{
    ...state.currentGeneration,
    id: 'generation-failed',
    parent_generation_id: state.currentGeneration.id,
    version_number: null,
    status: 'failed',
    instruction: 'Use a bolder headline.',
    hero_image_url: null,
    hero_image_key: null,
    completed_at: null,
    failed_at: state.now,
    failure_stage: 'hero',
    failure_code: 'PRIVATE_FAILURE_CODE',
    failure_message: 'PRIVATE_FAILURE_MESSAGE',
    trace_schema_version: 2,
  }]
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await page.getByRole('heading', { name: 'Create next version' }).waitFor()
  await page.getByRole('button', { name: 'Toggle versions panel' }).click()
  const versions = page.getByRole('region', { name: 'Versions' })
  await versions.getByText('Incomplete attempts', { exact: true }).click()
  await versions.locator('.failed-generation-row').click()

  const dialog = page.getByRole('dialog', { name: 'Generation details' })
  await dialog.getByText('The generation did not complete.', { exact: true }).waitFor()
  const dialogText = await dialog.innerText()
  assert.equal(dialogText.includes('PRIVATE_FAILURE_CODE'), false)
  assert.equal(dialogText.includes('PRIVATE_FAILURE_MESSAGE'), false)
  await dialog.getByText('Images used are unavailable for this version.', {
    exact: true,
  }).waitFor()
  await assertNoOverflow(page)
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testCampaignWizardUseCases(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 980 },
    reducedMotion: 'reduce',
  })
  const state = createState()
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(`${BASE_URL}/campaigns/new`)
  await page.getByRole('heading', { name: 'Create campaign' }).waitFor()
  const picker = page.locator('.use-case-picker')
  await picker.getByRole('heading', { name: 'Choose a campaign type' }).waitFor()
  assert.equal(await picker.getByRole('button').count(), 3)
  await picker.getByText(
    'Create from a product website and its visual identity.',
    { exact: true },
  ).waitFor()
  await picker.getByText(
    'Create from an Amazon listing plus seller-provided copy and images.',
    { exact: true },
  ).waitFor()
  await picker.getByText(
    'Create full-bleed artwork from creative references and direction.',
    { exact: true },
  ).waitFor()
  assert.equal(await picker.getByText('Event', { exact: true }).count(), 0)
  await assertNoOverflow(page)
  await page.screenshot({
    path: `${OUTPUT_DIR}/campaign-use-case-picker-desktop.png`,
    fullPage: true,
  })

  await selectWizardUseCase(page, 'Social cover')
  assert.deepEqual(
    await page.locator('.campaign-form .form-section-heading h2').allTextContents(),
    ['Creative references and direction', 'Artwork details'],
  )
  assert.equal(await page.locator('#product-url').count(), 0)
  assert.equal(await page.locator('#destination-url').count(), 0)
  assert.equal(await page.locator('#cta-text').count(), 0)
  assert.equal(await page.locator('#platform-hint').count(), 1)
  assert.equal(await page.locator('#poster-format option').count(), 1)
  assert.equal(await page.locator('#poster-format').inputValue(), 'rednote_cover_3x4')
  const socialReferences = page.locator('section[aria-labelledby="references-heading"]')
  assert.equal(
    await socialReferences.locator('.generation-references label').first().innerText(),
    'Creative direction (optional)',
  )
  assert.match(
    await socialReferences.locator('.generation-references .field-label').innerText(),
    /^Creative references Required/,
  )
  assert.equal(
    await page.getByRole('button', { name: 'Generate poster', exact: true }).isDisabled(),
    true,
  )
  await assertNoOverflow(page)

  await page.getByRole('button', { name: 'Change campaign type', exact: true }).click()
  await picker.getByRole('heading', { name: 'Choose a campaign type' }).waitFor()
  await selectWizardUseCase(page, 'Website product')
  assert.deepEqual(
    await page.locator('.campaign-form .form-section-heading h2').allTextContents(),
    ['Product source', 'Campaign action', 'Generation references'],
  )
  assert.equal(await page.locator('#product-url').getAttribute('placeholder'), 'https://yourproduct.com')
  assert.equal(
    await page.locator('#destination-url').getAttribute('placeholder'),
    'https://yourproduct.com/signup',
  )
  assert.equal(
    await page.locator('.generation-references label').first().innerText(),
    'Creative context (optional)',
  )
  assert.equal(
    await page.locator('.generation-references .field-label').innerText(),
    'Supporting images (optional)',
  )
  assert.equal(
    await page.getByText('The website supplies the visual and product context.', {
      exact: true,
    }).count(),
    1,
  )
  assert.equal(await page.getByText('Amazon seller reference mode', { exact: true }).count(), 0)
  assert.equal(await page.locator('#poster-format option').count(), 5)

  const amazonUrl =
    'https://www.amazon.com/dp/B0EXAMPLE?ref_=abc%2Fdef&tag=seller%20bytes#details'
  await page.locator('#product-url').fill(amazonUrl)
  await page.getByRole('button', { name: 'Switch to Amazon listing', exact: true }).click()
  await page.getByLabel('Amazon listing URL Required', { exact: true }).waitFor()
  assert.equal(await page.locator('#destination-url').inputValue(), amazonUrl)
  assert.deepEqual(
    await page.locator('.campaign-form .form-section-heading h2').allTextContents(),
    ['Product source', 'Listing copy and product images', 'Campaign action'],
  )
  const listingReferences = page.locator('section[aria-labelledby="references-heading"]')
  assert.equal(
    await listingReferences.locator('.generation-references label').first().innerText(),
    'Listing copy (optional)',
  )
  assert.equal(
    await listingReferences.locator('.generation-references .field-label').innerText(),
    'Product and brand images (optional)',
  )
  await listingReferences.getByRole('group', { name: 'Asset selection mode' }).waitFor()
  assert.equal(
    await page.getByText('Generation references', { exact: true }).count(),
    0,
  )
  await assertNoOverflow(page)
  await page.screenshot({
    path: `${OUTPUT_DIR}/campaign-amazon-form-desktop.png`,
    fullPage: true,
  })

  await page.locator('#product-url').fill('https://example.com/product')
  await page.getByRole('button', { name: 'Switch to Website product', exact: true }).click()
  await page.getByLabel('Website URL Required', { exact: true }).waitFor()
  assert.equal(await page.locator('#product-url').inputValue(), 'https://example.com/product')
  assert.equal(await page.locator('#destination-url').inputValue(), amazonUrl)

  await page.locator('#product-url').fill(amazonUrl)
  await page.getByRole('button', { name: 'Switch to Amazon listing', exact: true }).click()
  await page.locator('#product-url').fill('https://amazon.co.uk/dp/B0UNSUPPORTED')
  await page.locator('#product-name').fill('Unsupported marketplace')
  await page.getByRole('button', { name: 'Generate poster', exact: true }).click()
  await page.locator('.source-mismatch .inline-notice-error').waitFor()
  assert.equal(
    await page.locator('#product-url').evaluate((element) => element === document.activeElement),
    true,
  )
  assert.deepEqual(state.campaignWrites, [])
  assert.deepEqual(state.enqueueRequests, [])
  await assertNoOverflow(page)
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testCampaignWizardDraftSwitch(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 980 },
    reducedMotion: 'reduce',
  })
  const state = createState({ enqueueFailuresRemaining: 1 })
  state.campaign.current_generation_id = null
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await openWizardForm(page, 'Website product')
  await fillWizardRequiredFields(page, {
    sourceUrl: 'https://example.com/product',
    productName: 'Signal Studio',
    destinationUrl: 'https://example.com/start',
  })
  await submitWizardAndWaitForEnqueue(page, state, 1)
  await page.getByText('Mock enqueue failed.', { exact: false }).waitFor()
  assert.deepEqual(
    state.campaignWrites.map((write) => write.method),
    ['POST', 'PATCH'],
  )
  assert.equal(state.campaignWrites[0].body[0].use_case, 'website_product')

  const amazonUrl =
    'https://www.amazon.com/dp/B0SWITCH?maas=maas_adg_api_123%2F456&ref_=aa_maas'
  await page.locator('#destination-url').fill('')
  await page.locator('#product-url').fill(amazonUrl)
  await page.getByRole('button', { name: 'Switch to Amazon listing', exact: true }).click()
  assert.equal(await page.locator('#destination-url').inputValue(), amazonUrl)
  await submitWizardAndWaitForEnqueue(page, state, 2)

  assert.deepEqual(
    state.campaignWrites.map((write) => write.method),
    ['POST', 'PATCH', 'PATCH'],
  )
  const correction = state.campaignWrites.at(-1)
  assert.equal(correction.method, 'PATCH')
  assert.equal(correction.body.product_url, amazonUrl)
  assert.equal(correction.body.use_case, 'amazon_listing')
  assert.equal(correction.body.destination_url, amazonUrl)
  assert.equal(state.enqueueModes.length, 1)
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testCampaignWizardPreference(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  const state = createState()
  await installBackendMock(context, state)
  const page = await context.newPage()

  await openWizardForm(page, 'Website product')
  let mode = page.getByRole('group', { name: 'Asset selection mode' })
  assert.equal(await mode.getByRole('button', { name: 'Editor' }).getAttribute('aria-pressed'), 'true')

  await mode.getByRole('button', { name: 'Yolo' }).click()
  await page.reload()
  await page.getByRole('heading', { name: 'Create campaign' }).waitFor()
  await selectWizardUseCase(page, 'Website product')
  mode = page.getByRole('group', { name: 'Asset selection mode' })
  assert.equal(await mode.getByRole('button', { name: 'Yolo' }).getAttribute('aria-pressed'), 'true')
  await context.close()
}

async function testEditorUseCaseInputs(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  const state = createState({ editorReady: true })
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await page.getByRole('heading', { name: 'Create next version' }).waitFor()
  assert.equal(
    await page.locator('.editor-inspector .generation-references label').first().innerText(),
    'What should change? (optional)',
  )
  assert.equal(
    await page.locator('.editor-inspector .generation-references .field-label').innerText(),
    'Supporting images (optional)',
  )
  assert.equal(
    await page.getByText('Amazon seller reference mode', { exact: true }).count(),
    0,
  )
  assert.equal(await page.locator('#next-poster-format option').count(), 5)

  state.campaign.use_case = 'amazon_listing'
  state.currentGeneration.use_case = 'amazon_listing'
  await page.reload()
  await page.getByRole('heading', { name: 'Create next version' }).waitFor()
  assert.equal(
    await page.locator('.editor-inspector .generation-references label').first().innerText(),
    'Listing copy and creative direction (optional)',
  )
  assert.equal(
    await page.locator('.editor-inspector .generation-references .field-label').innerText(),
    'Product and brand images (optional)',
  )
  await page.getByText('Amazon seller reference mode', { exact: true }).waitFor()
  assert.equal(await page.locator('#next-poster-format option').count(), 5)
  await assertNoOverflow(page)
  await page.screenshot({
    path: `${OUTPUT_DIR}/amazon-editor-inputs-desktop.png`,
    fullPage: true,
  })
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testSocialCoverFrozenHint(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  const state = createState({ editorReady: true })
  Object.assign(state.campaign, {
    product_url: null,
    destination_url: null,
    use_case: 'social_cover',
    platform_hint: 'Instagram',
    poster_format: 'rednote_cover_3x4',
  })
  Object.assign(state.currentGeneration, {
    instruction: null,
    use_case: 'social_cover',
    platform_hint: 'Instagram',
    poster_format: 'rednote_cover_3x4',
  })
  state.placements = []
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await page.getByRole('heading', { name: 'Create next version' }).waitFor()

  const platformSelect = page.locator('#next-platform-hint')
  assert.equal(await platformSelect.inputValue(), 'Instagram')
  await platformSelect.selectOption('__other__')
  const customPlatform = page.locator('#next-platform-hint-other')
  await customPlatform.focus()
  await customPlatform.fill('YouTube')
  assert.equal(
    await customPlatform.evaluate((element) => element === document.activeElement),
    true,
  )
  assert.equal(await platformSelect.inputValue(), '__other__')
  await page.keyboard.press('Tab')
  await customPlatform.waitFor({ state: 'detached' })
  assert.equal(await platformSelect.inputValue(), 'YouTube')

  const versions = page.getByRole('region', { name: 'Versions' })
  if (await versions.count() === 0) {
    await page.getByRole('button', { name: 'Toggle versions panel' }).click()
  }
  await versions.locator('.version-row').first().click()
  const selected = versions.locator('.selected-version')
  await selected.getByText('Initial reference-based artwork', { exact: true }).waitFor()
  await selected.getByText('Target platform: Instagram', { exact: true }).waitFor()
  await assertNoOverflow(page)
  await page.screenshot({
    path: `${OUTPUT_DIR}/social-cover-version-details-desktop.png`,
    fullPage: true,
  })

  await selected.getByRole('button', { name: 'Generation details' }).click()
  const dialog = page.locator('.generation-details-sheet')
  await dialog.getByText('Initial reference-based artwork', { exact: true }).waitFor()
  await dialog.getByText('Target platform: Instagram', { exact: true }).waitFor()
  await page.screenshot({
    path: `${OUTPUT_DIR}/social-cover-generation-details-desktop.png`,
    fullPage: true,
  })

  await page.locator('select[aria-label="Language"]').selectOption('zh-CN')
  await dialog.getByText('目标平台：Instagram', { exact: true }).waitFor()
  await assertNoOverflow(page)
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testQrBandEdgeSamplingAndExport(browserInstance) {
  const context = await browserInstance.newContext({
    acceptDownloads: true,
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  await installPosterSamplingCounter(context)
  const state = createState({ editorReady: true })
  const edgePosterUrl = `${BASE_URL}/fixture/edge-poster.svg`
  state.campaign.hero_image_url = edgePosterUrl
  state.currentGeneration.hero_image_url = edgePosterUrl
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await page.getByRole('heading', { name: 'Create next version' }).waitFor()
  const sheet = page.locator(
    '.canvas-stage [data-poster-size="a4_2x3"][data-qr-band="scaled"]',
  ).first()
  const footer = sheet.locator(
    '[data-poster-footer][data-footer-color-source="sampled"]',
  )
  await footer.waitFor()
  // Reduced-motion CSS shortens transitions to 0.01ms. The sampled marker and
  // inline colors commit together, but computed colors can expose the old
  // fallback for that first style frame.
  await waitForComputedStyle(
    footer,
    'backgroundColor',
    'rgb(237, 243, 238)',
  )

  const footerStyles = await footer.evaluate((element) => {
    const style = getComputedStyle(element)
    const primary = element.querySelector('[data-poster-footer-primary]')
    const secondary = element.querySelector('[data-poster-footer-secondary]')
    const qrChip = element.querySelector('[data-poster-qr-chip]')
    return {
      accent: style.borderTopColor,
      background: style.backgroundColor,
      color: element.getAttribute('data-footer-color'),
      primary: primary ? getComputedStyle(primary).color : null,
      qrChip: qrChip ? getComputedStyle(qrChip).backgroundColor : null,
      secondary: secondary ? getComputedStyle(secondary).color : null,
      source: element.getAttribute('data-footer-color-source'),
    }
  })
  assert.equal(footerStyles.source, 'sampled')
  assert.equal(footerStyles.color, '#edf3ee')
  assert.equal(footerStyles.background, 'rgb(237, 243, 238)')
  assert.equal(footerStyles.primary, 'rgb(11, 12, 11)')
  assert.equal(footerStyles.accent, 'rgb(11, 12, 11)')
  assert.equal(footerStyles.qrChip, 'rgb(255, 255, 255)')
  assert.notEqual(footerStyles.secondary, 'rgba(255, 255, 255, 0.72)')
  assert.equal(
    await posterSamplingCount(page),
    1,
    'the preview must sample its hero once after the initial load',
  )

  const hero = sheet.locator('[data-poster-hero]')
  for (let index = 0; index < 8; index += 1) {
    await hero.dispatchEvent('load')
  }
  await hero.dispatchEvent('error')
  await page.setViewportSize({ width: 1359, height: 900 })
  await page.setViewportSize({ width: 1360, height: 900 })
  await waitForAnimationFrames(page, 2)

  assert.equal(
    await posterSamplingCount(page),
    1,
    'duplicate load events and a parent resize must not re-sample a settled preview source',
  )
  assert.equal(
    await footer.getAttribute('data-footer-color-source'),
    'sampled',
    'a late duplicate error must not replace an already sampled result',
  )
  await page.screenshot({
    path: `${OUTPUT_DIR}/qr-band-edge-sampling-desktop.png`,
    fullPage: true,
  })

  const exportButton = page.getByRole('button', {
    name: 'Export A4 poster (2:3 artwork) PNG',
  })
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
  await exportButton.click()
  const download = await downloadPromise
  const downloadPath = await download.path()
  assert.ok(downloadPath)
  assert.match(download.suggestedFilename(), /-A4\.png$/)

  const png = await readFile(downloadPath)
  const exportPixel = await probePngPixel(
    page,
    png,
    { sheetWidth: 1240, sheetHeight: 1754, x: 132, y: 1728 },
  )
  assert.deepEqual(
    exportPixel,
    [...cssRgbChannels(footerStyles.background), 255],
    'export footer pixel must exactly match the sampled preview color',
  )
  assert.equal(
    await posterSamplingCount(page),
    2,
    'the export clone must add exactly one sample for its own hero source',
  )
  await page.locator('[data-poster-export-render]').waitFor({ state: 'detached' })
  await assertNoOverflow(page)
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testQrBandSamplingFallback(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 840 },
    reducedMotion: 'reduce',
  })
  const state = createState({ editorReady: true })
  const missingPosterUrl = `${BASE_URL}/fixture/missing-poster.svg`
  state.campaign.hero_image_url = missingPosterUrl
  state.currentGeneration.hero_image_url = missingPosterUrl
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
  const sheet = page.locator(
    '.canvas-stage [data-poster-size="a4_2x3"][data-poster-render-status="fallback"]',
  ).first()
  await sheet.waitFor()
  const footer = sheet.locator(
    '[data-poster-footer][data-footer-color-source="fallback"]',
  )
  await footer.waitFor()
  assert.deepEqual(
    await footer.evaluate((element) => {
      const style = getComputedStyle(element)
      const primary = element.querySelector('[data-poster-footer-primary]')
      const secondary = element.querySelector('[data-poster-footer-secondary]')
      return {
        accent: style.borderTopColor,
        background: style.backgroundColor,
        primary: primary ? getComputedStyle(primary).color : null,
        secondary: secondary ? getComputedStyle(secondary).color : null,
      }
    }),
    {
      accent: 'rgb(16, 185, 129)',
      background: 'rgb(11, 12, 11)',
      primary: 'rgb(255, 255, 255)',
      secondary: 'rgba(255, 255, 255, 0.72)',
    },
  )
  await page.screenshot({
    path: `${OUTPUT_DIR}/qr-band-edge-fallback-desktop.png`,
    fullPage: true,
  })
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testRedNoteCoverFormat(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  await installPosterSamplingCounter(context)
  const state = createState({ editorReady: true })
  const edgePosterUrl = `${BASE_URL}/fixture/edge-poster.svg`
  state.campaign.hero_image_url = edgePosterUrl
  state.currentGeneration.hero_image_url = edgePosterUrl
  state.campaign.poster_format = 'rednote_cover_3x4'
  state.currentGeneration.poster_format = 'rednote_cover_3x4'
  state.placements = []
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await openWizardForm(page, 'Website product')
  assert.ok(
    (await page.locator('#poster-format option').allTextContents())
      .includes('Portrait 3:4 full bleed'),
  )

  await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await page.getByRole('heading', { name: 'Create next version' }).waitFor()
  assert.ok(
    (await page.locator('#next-poster-format option').allTextContents())
      .includes('Portrait 3:4 full bleed'),
  )
  const exportInspector = page.locator('section[aria-labelledby="export-heading"]')
  await exportInspector
    .getByText('Artwork-only export. No QR code or placement tracking is included.', {
      exact: true,
    })
    .waitFor()
  await exportInspector
    .getByRole('button', { name: 'Export Portrait 3:4 full bleed PNG' })
    .waitFor()
  assert.equal(await exportInspector.locator('#placement-select').count(), 0)

  const sheet = page.locator(
    '.canvas-stage [data-poster-size="rednote_cover_3x4"][data-qr-band="none"]',
  ).first()
  await sheet.waitFor()
  await page.locator(
    '.canvas-stage [data-poster-size="rednote_cover_3x4"][data-poster-render-status="not-applicable"]',
  ).first().waitFor()
  assert.deepEqual(
    await sheet.evaluate((element) => {
      const artwork = element.firstElementChild
      const style = getComputedStyle(element)
      return {
        artworkHeight: artwork?.clientHeight,
        artworkWidth: artwork?.clientWidth,
        paddingBottom: style.paddingBottom,
        paddingTop: style.paddingTop,
        sheetHeight: element.clientHeight,
        sheetWidth: element.clientWidth,
      }
    }),
    {
      artworkHeight: 1656,
      artworkWidth: 1242,
      paddingBottom: '0px',
      paddingTop: '0px',
      sheetHeight: 1656,
      sheetWidth: 1242,
    },
  )
  assert.equal(await sheet.getByRole('img', { name: 'QR code' }).count(), 0)
  assert.equal(await sheet.locator('[data-poster-footer]').count(), 0)
  await sheet.locator('[data-poster-hero]').evaluate((image) => image.decode())
  assert.equal(
    await posterSamplingCount(page),
    0,
    'a bandless poster must not sample its hero',
  )
  await assertNoOverflow(page)
  await page.screenshot({
    path: `${OUTPUT_DIR}/rednote-cover-editor-desktop.png`,
    fullPage: true,
  })

  state.placements = [state.placement]
  await page.goto(`${BASE_URL}/campaigns/campaign-asset/placements`)
  await page.getByRole('heading', { name: 'Placements', exact: true }).waitFor()
  await page.getByText('Each placement has a distinct tracked link.', {
    exact: true,
  }).waitFor()
  await page.getByText(
    'Artwork-only export. No QR code or placement tracking is included.',
    { exact: true },
  ).waitFor()
  assert.equal(
    await page.getByRole('button', {
      name: 'Export Portrait 3:4 full bleed PNG',
    }).count(),
    1,
  )
  await page.getByRole('img', { name: 'QR code' }).waitFor()
  await assertNoOverflow(page)
  await page.screenshot({
    path: `${OUTPUT_DIR}/rednote-cover-placements-desktop.png`,
    fullPage: true,
  })
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testAssetModeTooltips(browserInstance) {
  const desktopContext = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  const desktopState = createState({ editorReady: true })
  await installBackendMock(desktopContext, desktopState)
  const desktopPage = await desktopContext.newPage()
  const desktopErrors = []
  desktopPage.on('pageerror', (error) => desktopErrors.push(error))

  await openWizardForm(desktopPage, 'Website product')
  let mode = desktopPage.getByRole('group', { name: 'Asset selection mode' })
  await assertModeTooltipBehavior(
    desktopPage,
    mode,
    desktopPage.locator('.campaign-form'),
    desktopPage.getByRole('button', { name: 'Generate poster' }),
  )
  await desktopPage.screenshot({
    path: `${OUTPUT_DIR}/mode-tooltip-wizard-desktop.png`,
    fullPage: true,
  })

  await desktopPage.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await desktopPage.getByRole('heading', { name: 'Create next version' }).waitFor()
  mode = desktopPage.getByRole('group', { name: 'Asset selection mode' })
  await assertModeTooltipBehavior(
    desktopPage,
    mode,
    desktopPage.locator('.editor-inspector'),
    desktopPage.getByRole('button', { name: 'Generate version' }),
  )
  await desktopPage.screenshot({
    path: `${OUTPUT_DIR}/mode-tooltip-editor-desktop.png`,
    fullPage: true,
  })
  await assertNoOverflow(desktopPage)
  assert.deepEqual(desktopErrors, [])
  await desktopContext.close()

  const mobileContext = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  const mobileState = createState({ editorReady: true })
  await installBackendMock(mobileContext, mobileState)
  const mobilePage = await mobileContext.newPage()
  const mobileErrors = []
  mobilePage.on('pageerror', (error) => mobileErrors.push(error))

  await openWizardForm(mobilePage, 'Website product')
  mode = mobilePage.getByRole('group', { name: 'Asset selection mode' })
  await assertModeTooltipBehavior(
    mobilePage,
    mode,
    mobilePage.locator('.campaign-form'),
    mobilePage.getByRole('button', { name: 'Generate poster' }),
  )
  await mobilePage.screenshot({
    path: `${OUTPUT_DIR}/mode-tooltip-wizard-mobile.png`,
    fullPage: true,
  })

  await mobilePage.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await mobilePage.getByRole('heading', { name: 'Create next version' }).waitFor()
  mode = mobilePage.getByRole('group', { name: 'Asset selection mode' })
  await assertModeTooltipBehavior(
    mobilePage,
    mode,
    mobilePage.locator('.mobile-panel-content'),
    mobilePage.getByRole('button', { name: 'Generate version' }),
  )
  await mobilePage.screenshot({
    path: `${OUTPUT_DIR}/mode-tooltip-editor-mobile.png`,
    fullPage: true,
  })
  await assertNoOverflow(mobilePage)
  assert.deepEqual(mobileErrors, [])
  await mobileContext.close()
}

async function testBothEntryModes(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  const state = createState({ editorReady: true })
  await installBackendMock(context, state)
  const page = await context.newPage()

  await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await page.getByRole('heading', { name: 'Create next version' }).waitFor()
  const mode = page.getByRole('group', { name: 'Asset selection mode' })
  assert.equal(await mode.getByRole('button', { name: 'Editor' }).getAttribute('aria-pressed'), 'true')

  await mode.getByRole('button', { name: 'Yolo' }).click()
  await page.getByRole('button', { name: 'Generate version' }).click()
  await waitFor(() => state.enqueueModes.length === 1)
  assert.deepEqual(state.enqueueModes, ['yolo'])

  await mode.getByRole('button', { name: 'Editor' }).click()
  await page.getByRole('button', { name: 'Generate version' }).click()
  await waitFor(() => state.enqueueModes.length === 2)
  assert.deepEqual(state.enqueueModes, ['yolo', 'editor'])
  await page.waitForURL(new RegExp('/campaigns/campaign-asset/generations/generated-2/assets$'))
  await context.close()
}

async function openWizardForm(page, useCaseName) {
  await page.goto(`${BASE_URL}/campaigns/new`)
  await page.getByRole('heading', { name: 'Create campaign' }).waitFor()
  await selectWizardUseCase(page, useCaseName)
}

async function selectWizardUseCase(page, useCaseName) {
  const picker = page.locator('.use-case-picker')
  await picker.getByRole('button', { name: new RegExp(useCaseName) }).click()
  await page.locator('.campaign-form').waitFor()
}

async function fillWizardRequiredFields(
  page,
  {
    sourceUrl,
    productName,
    destinationUrl,
  },
) {
  await page.locator('#product-url').fill(sourceUrl)
  await page.locator('#product-name').fill(productName)
  await page.locator('#destination-url').fill(destinationUrl)
}

async function submitWizardAndWaitForEnqueue(page, state, expectedRequestCount) {
  await page.getByRole('button', {
    name: /^(?:Generate poster|Retry generation)$/,
  }).click()
  await waitFor(() => state.enqueueRequests.length === expectedRequestCount)
}

async function assertModeTooltipBehavior(page, mode, container, action) {
  const editor = mode.getByRole('button', { name: 'Editor' })
  const yolo = mode.getByRole('button', { name: 'Yolo' })
  const editorDescriptionId = await assertModeDescription(editor, EDITOR_MODE_DESCRIPTION)
  const yoloDescriptionId = await assertModeDescription(yolo, YOLO_MODE_DESCRIPTION)
  assert.notEqual(editorDescriptionId, yoloDescriptionId)

  await editor.hover()
  await assertTooltipVisible(editor, EDITOR_MODE_DESCRIPTION)
  await assertTooltipContained(editor, container, action)

  await page.mouse.move(0, 0)
  await editor.focus()
  await page.keyboard.press('Tab')
  assert.equal(await yolo.evaluate((element) => element === document.activeElement), true)
  await assertTooltipVisible(yolo, YOLO_MODE_DESCRIPTION)
  await assertTooltipContained(yolo, container, action)
}

async function assertModeDescription(button, expectedDescription) {
  assert.equal(await button.getAttribute('data-tooltip'), expectedDescription)
  const describedBy = await button.evaluate((element) => {
    const id = element.getAttribute('aria-describedby')
    return {
      id,
      text: id ? document.getElementById(id)?.textContent : null,
    }
  })
  assert.ok(describedBy.id)
  assert.equal(describedBy.text, expectedDescription)
  return describedBy.id
}

async function assertTooltipVisible(button, expectedDescription) {
  await button.page().waitForTimeout(30)
  const tooltip = await button.evaluate((element) => {
    const style = getComputedStyle(element, '::after')
    return {
      bottom: style.bottom,
      content: style.content,
      opacity: style.opacity,
      whiteSpace: style.whiteSpace,
      width: Number.parseFloat(style.width),
    }
  })
  assert.equal(tooltip.content.replace(/^["']|["']$/g, ''), expectedDescription)
  assert.equal(tooltip.opacity, '1')
  assert.ok(Number.parseFloat(tooltip.bottom) > 0)
  assert.equal(tooltip.whiteSpace, 'normal')
  assert.ok(tooltip.width <= 240)
}

async function assertTooltipContained(button, container, action) {
  const [tooltip, boundary, actionBox] = await Promise.all([
    button.evaluate((element) => {
      const buttonRect = element.getBoundingClientRect()
      const style = getComputedStyle(element, '::after')
      const width = Number.parseFloat(style.width)
      const height = Number.parseFloat(style.height)
      const left = style.left === 'auto'
        ? buttonRect.right - Number.parseFloat(style.right) - width
        : buttonRect.left + Number.parseFloat(style.left)
      const top = buttonRect.bottom - Number.parseFloat(style.bottom) - height
      const transform = style.transform === 'none'
        ? new DOMMatrixReadOnly()
        : new DOMMatrixReadOnly(style.transform)
      return {
        anchorTop: buttonRect.top,
        top: top + transform.m42,
        right: left + transform.m41 + width,
        bottom: top + transform.m42 + height,
        left: left + transform.m41,
      }
    }),
    container.boundingBox(),
    action.boundingBox(),
  ])
  assert.ok(boundary)
  assert.ok(actionBox)
  const geometry = JSON.stringify({ tooltip, boundary })
  assert.ok(tooltip.left >= boundary.x - 1, geometry)
  assert.ok(tooltip.right <= boundary.x + boundary.width + 1, geometry)
  assert.ok(tooltip.top >= boundary.y - 1, geometry)
  assert.ok(tooltip.bottom <= boundary.y + boundary.height + 1, geometry)
  assert.ok(tooltip.bottom <= tooltip.anchorTop - 5, geometry)
  assert.equal(rectanglesIntersect(tooltip, actionBox), false, geometry)
}

function rectanglesIntersect(a, b) {
  return a.left < b.x + b.width
    && a.right > b.x
    && a.top < b.y + b.height
    && a.bottom > b.y
}

async function installBackendMock(context, state) {
  await context.addCookies([{
    name: 'insforge_csrf_token',
    value: 'asset-review-csrf',
    url: BASE_URL,
  }])

  await context.route('**/fixture/*.svg', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname.endsWith('/missing-poster.svg')) {
      await route.fulfill({ status: 404, body: 'missing' })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: pathname.endsWith('/edge-poster.svg')
        ? edgePosterSvg()
        : posterSvg(),
    })
  })

  await context.route('**/api/**', async (route) => {
    const request = route.request()
    const requestUrl = new URL(request.url())
    const path = requestUrl.pathname
    const body = request.postData()
      ? JSON.parse(request.postData())
      : {}

    if (path === '/api/auth/refresh') {
      return json(route, {
        accessToken: 'asset-review-token',
        user: state.user,
      })
    }
    if (path === '/api/database/rpc/generation_activity') {
      return json(route, {
        items: state.awaitingReviewActivity ? [activityFixture(state)] : [],
        unread_count: 0,
        refreshed_at: state.now,
      })
    }
    if (path === '/api/database/rpc/mark_generation_notifications_read') {
      return json(route, null)
    }
    if (path === '/api/database/rpc/save_generation_asset_selection') {
      const ids = body.p_asset_ids ?? []
      state.saveAttempts.push([...ids])
      if (state.saveFailuresRemaining > 0) {
        state.saveFailuresRemaining -= 1
        return json(route, {
          error: '23505',
          message: 'duplicate key value violates unique constraint "idx_generation_assets_selected_rank"',
          statusCode: 409,
        }, 409)
      }
      state.savedSelections.push([...ids])
      applySelection(state, ids)
      return json(route, state.assets)
    }
    if (path === '/api/database/rpc/confirm_generation_asset_selection') {
      const ids = body.p_asset_ids ?? []
      state.confirmedSelections.push([...ids])
      applySelection(state, ids)
      return json(route, {
        generation: { ...state.reviewGeneration, asset_selection_status: 'completed' },
        job: { id: 'job-review', campaign_id: state.campaign.id },
        assets: state.assets,
      })
    }
    if (path === '/api/database/rpc/cancel_generation_asset_review') {
      state.cancelCalls += 1
      return json(route, {
        generation: { ...state.reviewGeneration, status: 'canceled' },
        job: { id: 'job-review', campaign_id: state.campaign.id, status: 'canceled' },
      })
    }
    if (path === '/api/database/rpc/enqueue_poster_generation') {
      state.enqueueRequests.push(body)
      if (state.enqueueFailuresRemaining > 0) {
        state.enqueueFailuresRemaining -= 1
        return json(route, {
          code: 'P0001',
          message: 'Mock enqueue failed.',
          details: null,
          hint: null,
        }, 400)
      }
      const mode = body.p_asset_selection_mode
      state.enqueueModes.push(mode)
      const generation = {
        ...state.reviewGeneration,
        id: `generated-${state.enqueueModes.length}`,
        status: 'created',
        asset_selection_mode: mode,
        asset_selection_status: 'pending',
      }
      state.reviewGeneration = generation
      return json(route, {
        generation,
        job: {
          id: `generated-job-${state.enqueueModes.length}`,
          campaign_id: state.campaign.id,
          generation_id: generation.id,
        },
      })
    }
    if (path === '/api/database/records/campaigns') {
      const method = request.method()
      if (method === 'POST') {
        state.campaignWrites.push({ method, body })
        Object.assign(state.campaign, body[0])
        return json(route, { id: state.campaign.id })
      }
      if (method === 'PATCH') {
        state.campaignWrites.push({ method, body })
        Object.assign(state.campaign, body)
        return json(route, [])
      }
      return json(route, [state.campaign])
    }
    if (path === '/api/database/records/poster_generations') {
      return json(route, state.editorReady
        ? [state.currentGeneration, ...state.failedGenerations]
        : [state.reviewGeneration])
    }
    if (path === '/api/database/records/generation_assets') {
      return json(route, state.assets)
    }
    if (path === '/api/database/records/generation_stage_traces') {
      state.traceRequests.push(request.url())
      const generationId = requestUrl.searchParams.get('generation_id')?.replace(/^eq\./, '')
      const hero = state.traces.find((trace) =>
        trace.generation_id === generationId && trace.stage === 'hero'
      ) ?? null
      if (!hero) return json(route, null)
      return json(
        route,
        requestUrl.searchParams.get('select') === 'attached_images'
          ? { attached_images: hero.attached_images }
          : hero,
      )
    }
    if (path === '/api/database/records/placements') {
      return json(route, state.placements)
    }
    return json(route, [])
  })
}

function createState({
  selectedIds = ['asset-a', 'asset-b'],
  awaitingReviewActivity = false,
  editorReady = false,
  enqueueFailuresRemaining = 0,
  saveFailuresRemaining = 0,
} = {}) {
  const now = new Date().toISOString()
  const user = { id: 'user-asset', email: 'editor@example.com' }
  const campaign = {
    id: 'campaign-asset',
    user_id: user.id,
    product_url: 'https://example.com',
    product_name: 'Signal Studio',
    tagline: 'Make the signal visible',
    cta_text: 'Open signal',
    destination_url: 'https://example.com/start',
    style_profile: null,
    poster_copy: null,
    poster_content: null,
    brand_assets: null,
    brand_essence: null,
    poster_spec: null,
    hero_image_url: `${BASE_URL}/fixture/poster.svg`,
    hero_image_key: 'poster/current.png',
    design_tokens: null,
    screenshot_url: null,
    screenshot_key: null,
    poster_layout: null,
    design_status: 'ready',
    reference_context: null,
    reference_images: [],
    scenario: 'product',
    use_case: 'website_product',
    platform_hint: null,
    event_details: null,
    current_generation_id: 'generation-current',
    poster_format: 'a4_2x3',
    status: 'draft',
    created_at: now,
  }
  const generationBase = {
    campaign_id: campaign.id,
    user_id: user.id,
    parent_generation_id: 'generation-current',
    version_number: null,
    generation_mode: 'iteration',
    instruction: 'Increase visual contrast.',
    reference_images: [],
    poster_format: 'a4_2x3',
    scenario: 'product',
    use_case: 'website_product',
    platform_hint: null,
    event_details: null,
    style_profile: null,
    poster_copy: null,
    poster_content: null,
    brand_assets: null,
    brand_essence: null,
    poster_spec: null,
    design_tokens: null,
    screenshot_url: null,
    screenshot_key: null,
    poster_layout: null,
    design_status: 'ready',
    hero_image_url: null,
    hero_image_key: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
    failed_at: null,
    failure_stage: null,
    failure_code: null,
    failure_message: null,
    trace_schema_version: 2,
    trace_incomplete: false,
    asset_selection_mode: 'editor',
    asset_selection_status: 'pending',
    asset_selection_method: null,
    asset_selection_completed_at: null,
  }
  const reviewGeneration = {
    ...generationBase,
    id: 'generation-review',
    status: 'reviewing',
  }
  const currentGeneration = {
    ...generationBase,
    id: 'generation-current',
    parent_generation_id: null,
    version_number: 1,
    status: 'ready',
    hero_image_url: campaign.hero_image_url,
    hero_image_key: campaign.hero_image_key,
    completed_at: now,
    trace_schema_version: 1,
    asset_selection_mode: null,
    asset_selection_status: null,
  }
  const assets = [
    asset('asset-a', 'previous-poster', 'Previous poster', 1),
    asset('asset-b', 'style-board', 'Style board', 2),
    asset('asset-c', 'logo', 'Brand logo', 3),
    asset('asset-d', 'product', 'Product image', 4),
  ]
  const placement = {
    id: 'placement-1',
    campaign_id: campaign.id,
    user_id: user.id,
    label: 'Primary',
    code: 'asset001',
    created_at: now,
  }
  const state = {
    now,
    user,
    campaign,
    reviewGeneration,
    currentGeneration,
    placement,
    placements: [placement],
    assets,
    awaitingReviewActivity,
    editorReady,
    saveAttempts: [],
    saveFailuresRemaining,
    savedSelections: [],
    confirmedSelections: [],
    cancelCalls: 0,
    campaignWrites: [],
    enqueueFailuresRemaining,
    enqueueModes: [],
    enqueueRequests: [],
    failedGenerations: [],
    traceRequests: [],
    traces: [],
  }
  applySelection(state, selectedIds)
  return state
}

function createTraceFixtures(state) {
  const base = {
    generation_id: state.currentGeneration.id,
    campaign_id: state.campaign.id,
    user_id: state.user.id,
    status: 'succeeded',
    started_at: state.now,
    completed_at: state.now,
    model_calls: [],
    candidate_images: [],
    attached_images: [],
    skipped_images: [],
    artifacts: [],
    failure_code: null,
    failure_message: null,
    failure_metadata: {},
    created_at: state.now,
    updated_at: state.now,
  }
  const candidateImages = state.assets.map((candidate) => ({
    asset_id: candidate.id,
    source: candidate.source,
    purpose: candidate.purpose,
    url: candidate.url,
    key: candidate.object_key,
    filename: candidate.filename,
    mime_type: candidate.mime_type,
    size_bytes: candidate.size_bytes,
    storage_source: candidate.storage_source,
    candidate_position: candidate.candidate_position,
    model_position: candidate.selection_rank,
  }))

  return ['analyze', 'assets', 'designer', 'hero'].map((stage) => ({
    ...base,
    id: `trace-${stage}`,
    stage,
    candidate_images: stage === 'assets' ? candidateImages : [],
    attached_images: stage === 'hero'
      ? candidateImages.filter((image) => image.model_position !== null)
      : [],
    model_calls: stage === 'hero'
      ? [{
          attempt: 1,
          operation: 'image',
          provider: 'PRIVATE_PROVIDER',
          model_id: 'PRIVATE_MODEL_ID',
          status: 'succeeded',
          started_at: state.now,
          completed_at: state.now,
          prompt: {
            system: 'PRIVATE_SYSTEM_PROMPT',
            user: 'PRIVATE_COMPILED_USER_PROMPT',
            image: 'PRIVATE_IMAGE_PROMPT',
          },
          provider_settings: { marker: 'PRIVATE_PROVIDER_SETTING' },
          content_manifest: [{
            position: 1,
            role: 'user',
            type: 'text',
            text: 'PRIVATE_MANIFEST_VALUE',
          }],
          failure: null,
        }]
      : [],
    skipped_images: stage === 'hero'
      ? [{
          asset: candidateImages[2],
          reason: 'fetch_failed',
          detail: 'PRIVATE_SKIP_DETAIL',
        }]
      : [],
    artifacts: stage === 'hero'
      ? [{
          kind: 'poster',
          snapshot: { marker: 'PRIVATE_ARTIFACT_VALUE' },
        }]
      : [],
    failure_code: stage === 'hero' ? 'PRIVATE_STAGE_FAILURE_CODE' : null,
    failure_message: stage === 'hero' ? 'PRIVATE_STAGE_FAILURE_MESSAGE' : null,
    failure_metadata: stage === 'hero'
      ? { marker: 'PRIVATE_FAILURE_METADATA' }
      : stage === 'assets'
        ? { ai_attempts: 2, fallback: true }
        : {},
  }))
}

function asset(id, source, filename, candidatePosition) {
  return {
    id,
    generation_id: 'generation-review',
    campaign_id: 'campaign-asset',
    user_id: 'user-asset',
    candidate_key: id,
    source,
    url: `${BASE_URL}/fixture/${id}.svg`,
    object_key: `${id}.svg`,
    filename,
    mime_type: 'image/png',
    size_bytes: 120,
    storage_source: 'fixture',
    purpose: `${filename} generation evidence.`,
    metadata: {},
    availability: 'available',
    availability_reason: null,
    included: false,
    selection_rank: null,
    selection_reason: null,
    candidate_position: candidatePosition,
    provider_skips: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function applySelection(state, ids) {
  state.assets = state.assets.map((candidate) => {
    const index = ids.indexOf(candidate.id)
    return {
      ...candidate,
      included: index >= 0,
      selection_rank: index >= 0 ? index + 1 : null,
    }
  })
}

function activityFixture(state) {
  return {
    job_id: 'job-review',
    generation_id: state.reviewGeneration.id,
    campaign_id: state.campaign.id,
    campaign_name: state.campaign.product_name,
    status: 'awaiting_review',
    stage: 'assets',
    color_scheme: 'light',
    attempt_count: 1,
    retry_count: 0,
    max_attempts: 3,
    available_at: state.now,
    started_at: state.now,
    completed_at: null,
    created_at: state.now,
    updated_at: state.now,
    last_error_code: null,
    last_error_message: null,
    generation_status: 'reviewing',
    version_number: null,
    generation_mode: 'iteration',
    scenario: 'product',
    instruction: state.reviewGeneration.instruction,
    hero_image_url: null,
    poster_format: 'a4_2x3',
    asset_selection_mode: 'editor',
    asset_selection_status: 'pending',
    asset_selection_method: null,
    asset_selection_completed_at: null,
    generation_created_at: state.now,
    notification_id: null,
    notification_outcome: null,
    read_at: null,
    notification_created_at: null,
  }
}

function reviewUrl() {
  return `${BASE_URL}/campaigns/campaign-asset/generations/generation-review/assets`
}

async function installPosterSamplingCounter(context) {
  await context.addInitScript(() => {
    window.__posterEdgeSampleCount = 0
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      const [x, y, width, height] = args
      if (x === 0 && y === 0 && width === 600 && height === 27) {
        window.__posterEdgeSampleCount += 1
      }
      return originalGetImageData.apply(this, args)
    }
  })
}

async function posterSamplingCount(page) {
  return page.evaluate(() => window.__posterEdgeSampleCount)
}

async function waitForAnimationFrames(page, count) {
  await page.evaluate(async (frameCount) => {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
  }, count)
}

async function probePngPixel(page, png, point) {
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  return page.evaluate(async ({ dataUrl: src, point: sample }) => {
    const image = new Image()
    image.src = src
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('PNG probe canvas is unavailable.')
    context.drawImage(image, 0, 0)
    const x = Math.floor(sample.x * image.naturalWidth / sample.sheetWidth)
    const y = Math.floor(sample.y * image.naturalHeight / sample.sheetHeight)
    return Array.from(context.getImageData(x, y, 1, 1).data)
  }, { dataUrl, point })
}

function cssRgbChannels(color) {
  const channels = color.match(/\d+/g)?.slice(0, 3).map(Number)
  assert.equal(channels?.length, 3, `Expected an RGB color, received ${color}`)
  return channels
}

function edgePosterSvg() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="900">
      <rect width="600" height="900" fill="#174a58"/>
      <circle cx="420" cy="240" r="150" fill="#e05b3f"/>
      <path d="M0 620 C180 500 340 760 600 560 L600 873 L0 873 Z" fill="#b9dfce"/>
      <rect y="873" width="600" height="27" fill="#edf3ee"/>
    </svg>
  `.trim()
}

function posterSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300"><rect width="480" height="300" fill="#edf3ee"/><circle cx="240" cy="150" r="75" fill="#174a58"/></svg>'
}

async function json(route, body, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function waitForServer() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE_URL)
      if (response.ok) return
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Vite server did not start.\n${serverOutput}`)
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Timed out waiting for mocked backend state.')
}

async function waitForComputedStyle(locator, property, expected, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  let actual = null
  while (Date.now() < deadline) {
    actual = await locator.evaluate(
      (element, styleProperty) => getComputedStyle(element)[styleProperty],
      property,
    )
    if (actual === expected) return
    await new Promise((resolve) => setTimeout(resolve, 16))
  }
  assert.equal(
    actual,
    expected,
    `Timed out waiting for computed ${property}`,
  )
}

async function assertNoOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  assert.ok(dimensions.scrollWidth <= dimensions.clientWidth + 1)
}
