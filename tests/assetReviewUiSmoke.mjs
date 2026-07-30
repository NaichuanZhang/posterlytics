import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import process from 'node:process'
import { chromium } from 'playwright'

const HOST = '127.0.0.1'
const PORT = 4174
const BASE_URL = `http://${HOST}:${PORT}`
const OUTPUT_DIR = 'test-results/asset-review'
const REDNOTE_FONT_EMBED_CSS_MAX_CHARS = 1_639_424
const EDITOR_MODE_DESCRIPTION = 'Review, include, exclude, and reorder images before generation.'
const YOLO_MODE_DESCRIPTION = 'Let AI select and order images automatically, with no manual review step.'
const EAGER_STYLE_BOARD_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAAIAAgDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAGB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ACUVpu//2Q=='

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
  await testCampaignWizardAccessibility(browser)
  await testSocialCoverQrLifecycle(browser)
  await testCampaignWizardTextResize(browser)
  await testAmazonProductTitleAssist(browser)
  await testWebsiteCapturePreview(browser)
  await testSinglePaidEagerCapture(browser)
  await testCampaignWizardDraftSwitch(browser)
  await testCampaignWizardDiscardDeletesOrphanedCampaign(browser)
  await testCampaignWizardPreference(browser)
  await testEditorUseCaseInputs(browser)
  await testReferenceOnlyEditorReusesPersistedImages(browser)
  await testAmazonEditorReusesPersistedImages(browser)
  await testPosterTranscriptVersionSwitch(browser)
  await testSocialCoverFrozenHint(browser)
  await testSocialCoverLateQrSampling(browser)
  await testPosterBackgroundReloadPreservesHero(browser)
  await testQrBandEdgeSamplingAndExport(browser)
  await testQrFooterRasterFontParity(browser)
  await testQrBandSamplingFallback(browser)
  await testRedNoteCoverFormat(browser)
  await testRedNoteBundledCjkFontAndExports(browser)
  await testRedNotePostPagerAndCurrentPageExport(browser)
  await testAssetModeTooltips(browser)
  await testBothEntryModes(browser)
  await testNativeOnlyFieldInvalidState(browser)
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
  await dialog.getByText(
    'The generation did not complete. Retry this attempt from Incomplete attempts, or start a new version.',
    { exact: true },
  ).waitFor()
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
  await page.locator('.campaign-form').waitFor()

  // The unified screen: one form, no picker, no CTA or platform-hint inputs.
  assert.equal(await page.locator('.use-case-picker').count(), 0)
  assert.equal(await page.getByText('Choose a campaign type').count(), 0)
  assert.equal(await page.locator('#cta-text').count(), 0)
  assert.equal(await page.locator('#platform-hint').count(), 0)
  assert.equal(await page.locator('#destination-url').count(), 0)
  assert.deepEqual(
    await page.locator('.campaign-form .form-section-heading h2').allTextContents(),
    ['Campaign details', 'Generation references'],
  )
  // Title is optional; the primary source URL and output control are present.
  assert.equal(
    await page.locator('#product-name').evaluate((el) => el.required),
    false,
  )
  assert.equal(await page.locator('#source-url').count(), 1)
  const outputPoster = page.getByRole('radio', { name: 'Single poster' })
  const outputPost = page.getByRole('radio', { name: 'Multi-page post' })
  assert.equal(await outputPoster.getAttribute('aria-checked'), 'true')
  assert.equal(await outputPost.getAttribute('aria-checked'), 'false')

  await assertNoOverflow(page)
  await page.screenshot({
    path: `${OUTPUT_DIR}/campaign-unified-form-desktop.png`,
    fullPage: true,
  })

  // Default (no URL, single poster) is a tracked poster: QR on, banded 2:3, with a
  // revealed required destination. This matches campaigns.poster_format's a4_2x3
  // default and the product's tracked-QR-poster premise.
  const posterFormat = page.locator('#poster-format')
  const qrSwitch = page.getByRole('switch', { name: /Add a tracked QR footer/ })
  assert.equal(await qrSwitch.isChecked(), true)
  assert.equal(await posterFormat.inputValue(), 'a4_2x3')
  // One option per aspect for the current (banded) band.
  assert.equal(await posterFormat.locator('option').count(), 4)
  const qrDestination = page.locator('#poster-qr-destination')
  await qrDestination.waitFor()
  assert.equal(await qrDestination.getAttribute('required'), '')
  assert.equal(await qrDestination.getAttribute('aria-required'), 'true')
  assert.equal(await qrDestination.getAttribute('pattern'), 'https?://.+')
  const references = page.locator('section[aria-labelledby="references-heading"]')
  assert.match(
    await references.locator('.generation-references .field-label').innerText(),
    /^Creative references Required|^Supporting images Required/,
  )
  const generatePoster = page.getByRole('button', {
    name: 'Generate poster',
    exact: true,
  })
  assert.equal(await generatePoster.isDisabled(), true)
  // No mid-pipeline asset-selection control on creation.
  assert.equal(
    await page.getByRole('group', { name: 'Asset selection mode' }).count(),
    0,
  )

  // Turning QR off hides the destination and swaps to the bandless twin.
  await qrSwitch.click()
  assert.equal(await page.locator('#poster-qr-destination').count(), 0)
  assert.equal(await posterFormat.inputValue(), 'a4_2x3_cover')
  assert.equal(await posterFormat.locator('option').count(), 4)
  assert.equal(
    await page.getByText(
      'Artwork-only export. No QR code or placement tracking is included.',
      { exact: true },
    ).count(),
    1,
  )
  // Back on for the rest of the flow.
  await qrSwitch.click()
  await page.locator('#poster-qr-destination').waitFor()

  // A source URL => website_product: capture preview appears, references optional.
  await page.locator('#source-url').fill('https://yourproduct.com')
  await page.getByText('The website supplies the visual and product context.', {
    exact: true,
  }).waitFor().catch(() => {})
  assert.equal(await page.getByText('Amazon seller reference mode', { exact: true }).count(), 0)

  // A supported Amazon URL => amazon_listing: seller-reference notice, references required.
  await page.locator('#source-url').fill('https://www.amazon.com/dp/B0EXAMPLE')
  await page.getByText('Amazon seller reference mode', { exact: true }).waitFor()
  assert.deepEqual(
    await page.locator('.campaign-form .form-section-heading h2').allTextContents(),
    ['Campaign details', 'Listing copy and product images'],
  )
  const listingFileInput = references.getByTestId('reference-file-input')
  assert.equal(await listingFileInput.getAttribute('aria-required'), 'true')
  assert.equal(await generatePoster.isDisabled(), true)
  await listingFileInput.setInputFiles(
    referenceImageFile('amazon-seller-reference.png'),
  )
  await references.locator('.reference-tile').waitFor()
  assert.equal(await generatePoster.isEnabled(), true)
  await assertNoOverflow(page)
  await page.screenshot({
    path: `${OUTPUT_DIR}/campaign-amazon-form-desktop.png`,
    fullPage: true,
  })

  // Multi-page post => rednote_post: creative direction required, no QR toggle.
  // Let the Amazon title-lookup hint settle first so its layout shift cannot land
  // between the click's pointer-down and pointer-up.
  await page.locator('#amazon-title-lookup-status').waitFor({ state: 'hidden' }).catch(() => {})
  const outputPostRadio = page.getByRole('radio', { name: 'Multi-page post' })
  await outputPostRadio.click()
  await page.waitForFunction(
    () => document.querySelector('[role="radio"][aria-checked="true"]')?.textContent?.includes('Multi-page post') ?? false,
  )
  await page.waitForFunction(
    () => document.querySelectorAll('[role="switch"]').length === 0,
  )
  assert.equal(await page.getByRole('switch', { name: /Add a tracked QR footer/ }).count(), 0)
  assert.equal(await page.locator('#poster-format').count(), 0)
  assert.deepEqual(
    await page.locator('.campaign-form .form-section-heading h2').allTextContents(),
    ['Campaign details', 'Draft copy and creative references'],
  )
  await assertNoOverflow(page)
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testCampaignWizardAccessibility(browserInstance) {
  const redNoteContext = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  const redNoteState = createState()
  await installBackendMock(redNoteContext, redNoteState)
  const redNotePage = await redNoteContext.newPage()
  const redNoteErrors = []
  redNotePage.on('pageerror', (error) => redNoteErrors.push(error))

  // Multi-page post: draft copy and >=1 reference are required; the title stays
  // optional. Creation always runs the full pipeline (yolo), never the editor
  // asset-review redirect.
  await redNotePage.goto(`${BASE_URL}/campaigns/new`)
  await redNotePage.getByRole('heading', { name: 'Create campaign' }).waitFor()
  await redNotePage.locator('.campaign-form').waitFor()
  await redNotePage.getByRole('radio', { name: 'Multi-page post' }).click()
  await redNotePage.waitForFunction(
    () => document.querySelector('[role="radio"][aria-checked="true"]')?.textContent?.includes('Multi-page post') ?? false,
  )
  assert.deepEqual(
    await redNotePage.locator('.campaign-form .form-section-heading h2').allTextContents(),
    ['Campaign details', 'Draft copy and creative references'],
  )

  const productName = redNotePage.locator('#product-name')
  const draftCopy = redNotePage.locator('.generation-references textarea')
  const fileInput = redNotePage.getByTestId('reference-file-input')
  const generate = redNotePage.getByRole('button', {
    name: 'Generate poster',
    exact: true,
  })

  // Title is optional now; draft copy and references are required for a post.
  assert.equal(await productName.evaluate((el) => el.required), false)
  assert.equal(await draftCopy.getAttribute('aria-required'), 'true')
  assert.equal(await fileInput.getAttribute('aria-required'), 'true')
  assert.equal(await generate.isDisabled(), true)

  // No mid-pipeline asset-selection control on creation.
  assert.equal(
    await redNotePage.getByRole('group', { name: 'Asset selection mode' }).count(),
    0,
  )

  await draftCopy.fill('A complete launch draft for the RedNote post.')
  await fileInput.setInputFiles(referenceImageFile('rednote-reference.png'))
  await redNotePage.locator('.reference-tile').waitFor()
  assert.equal(await generate.isEnabled(), true)

  // Generate WITHOUT a title: an untitled post is allowed and runs in yolo mode
  // without redirecting to the asset-review page.
  await generate.click()
  await redNotePage.getByRole('heading', { name: 'Building your poster' }).waitFor()
  await waitForFocused(redNotePage, '.page-heading h1')
  await waitFor(() => redNoteState.enqueueRequests.length === 1)
  assert.deepEqual(redNoteState.enqueueModes, ['yolo'])
  const rednoteCreate = redNoteState.campaignWrites.find(
    (write) => write.method === 'POST',
  )
  assert.ok(rednoteCreate)
  assert.equal(rednoteCreate.body[0].use_case, 'rednote_post')
  assert.equal(rednoteCreate.body[0].poster_format, 'rednote_cover_3x4')
  assert.equal(rednoteCreate.body[0].product_name, null)
  assert.deepEqual(redNoteState.placementWrites, [])
  assert.deepEqual(redNoteErrors, [])
  await redNoteContext.close()

  // A reference-only single poster (no source URL) resolves to social_cover and
  // stays on the creation page in yolo mode.
  const socialContext = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  const socialState = createState()
  await installBackendMock(socialContext, socialState)
  const socialPage = await socialContext.newPage()
  const socialErrors = []
  socialPage.on('pageerror', (error) => socialErrors.push(error))

  await socialPage.goto(`${BASE_URL}/campaigns/new`)
  await socialPage.getByRole('heading', { name: 'Create campaign' }).waitFor()
  await socialPage.locator('.campaign-form').waitFor()
  // Turn QR off so no destination or placement is required.
  await socialPage.getByRole('switch', { name: /Add a tracked QR footer/ }).click()

  const socialName = socialPage.locator('#product-name')
  const socialFileInput = socialPage.getByTestId('reference-file-input')
  await socialName.fill('Accessible social cover')
  await socialFileInput.setInputFiles(referenceImageFile('social-reference.png'))
  await socialPage.locator('.reference-tile').waitFor()

  await socialPage.getByRole('button', { name: 'Generate poster', exact: true }).click()
  await socialPage.getByRole('heading', { name: 'Building your poster' }).waitFor()
  await waitFor(() => socialState.enqueueRequests.length === 1)
  assert.deepEqual(socialState.enqueueModes, ['yolo'])
  const socialCreate = socialState.campaignWrites.find(
    (write) => write.method === 'POST',
  )
  assert.ok(socialCreate)
  assert.equal(socialCreate.body[0].use_case, 'social_cover')
  // QR off from the default a4_2x3 => the bandless 2:3 twin.
  assert.equal(socialCreate.body[0].poster_format, 'a4_2x3_cover')
  assert.equal(socialCreate.body[0].destination_url, null)
  assert.deepEqual(socialState.placementWrites, [])
  assert.deepEqual(socialErrors, [])
  await socialContext.close()
}

async function testSocialCoverQrLifecycle(browserInstance) {
  const wizardContext = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 980 },
    reducedMotion: 'reduce',
  })
  const wizardState = createState()
  wizardState.placements = []
  await installBackendMock(wizardContext, wizardState)
  const wizardPage = await wizardContext.newPage()
  const wizardErrors = []
  wizardPage.on('pageerror', (error) => wizardErrors.push(error))

  // A reference-only single poster with QR ON: the tracked destination is
  // required, a placement is provisioned, and the banded default format persists.
  await openWizardForm(wizardPage, 'Social cover')
  const wizardSwitch = wizardPage.getByRole('switch', {
    name: /Add a tracked QR footer/,
  })
  // The tracked-poster default: QR on for the banded a4_2x3 default.
  assert.equal(await wizardSwitch.isChecked(), true)
  await wizardPage.locator('#product-name').fill('Tracked social launch')
  await wizardPage.getByTestId('reference-file-input')
    .setInputFiles(referenceImageFile('tracked-social.png'))
  await wizardPage.locator('.reference-tile').waitFor()

  const wizardDestination = wizardPage.locator('#poster-qr-destination')
  await wizardDestination.fill('ftp://example.com/not-trackable')
  assert.equal(
    await wizardDestination.evaluate((element) => element.checkValidity()),
    false,
  )
  await wizardPage.getByRole('button', {
    name: 'Generate poster',
    exact: true,
  }).click()
  await waitForFocused(wizardPage, wizardDestination)
  assert.deepEqual(wizardState.campaignWrites, [])

  await wizardDestination.fill('https://example.com/social-launch')
  await wizardPage.getByRole('button', {
    name: 'Generate poster',
    exact: true,
  }).click()
  await waitFor(() => wizardState.enqueueRequests.length === 1)

  const wizardCreate = wizardState.campaignWrites.find(
    (write) => write.method === 'POST',
  )
  assert.ok(wizardCreate)
  assert.equal(wizardCreate.body.length, 1)
  // No source URL => social_cover; QR on => the banded default format persists.
  assert.equal(wizardCreate.body[0].use_case, 'social_cover')
  assert.equal(wizardCreate.body[0].poster_format, 'a4_2x3')
  assert.equal(
    wizardCreate.body[0].destination_url,
    'https://example.com/social-launch',
  )
  assert.equal(wizardState.placementWrites.length, 1)
  assertOperationOrder(wizardState, [
    'campaign-create',
    'campaign-qr-update',
    'placement-lookup',
    'placement-create',
    'enqueue',
  ])
  assert.deepEqual(wizardErrors, [])
  await wizardContext.close()

  const editorContext = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  const editorState = createState({
    editorReady: true,
    placementCreateFailuresRemaining: 20,
  })
  configureSocialCoverState(editorState, { qrEnabled: false })
  await installBackendMock(editorContext, editorState)
  const editorPage = await editorContext.newPage()
  const editorErrors = []
  editorPage.on('pageerror', (error) => editorErrors.push(error))

  await editorPage.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await editorPage.getByRole('heading', { name: 'Create next version' }).waitFor()
  assert.deepEqual(
    await editorPage.locator('.campaign-tabs a').allTextContents(),
    ['Poster'],
  )
  assert.equal(
    await editorPage.getByRole('button', { name: 'Publish', exact: true }).count(),
    0,
  )
  // The editor now offers the aspect select alongside the QR toggle for every
  // tracking-enabled use case (item 7). QR is off here, so bandless formats show.
  assert.equal(await editorPage.locator('#next-poster-format').count(), 1)
  assert.equal(await editorPage.locator('#next-poster-format option').count(), 4)
  await editorPage.locator('[data-poster-hero]').waitFor()

  const editorSwitch = editorPage.getByRole('switch', {
    name: /Add a tracked QR footer/,
  })
  const generateVersionButton = editorPage.getByRole('button', {
    name: 'Generate version',
  })
  assert.equal(await editorSwitch.isChecked(), false)
  assert.equal(await generateVersionButton.isEnabled(), true)
  await waitForComputedStyle(
    generateVersionButton,
    'backgroundColor',
    'rgb(59, 78, 224)',
  )
  const enabledGenerateBackground = await generateVersionButton.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  )
  assert.equal(enabledGenerateBackground, 'rgb(59, 78, 224)')
  await editorSwitch.click()
  await editorPage.getByText(
    'Save QR settings before generating a version.',
    { exact: true },
  ).waitFor()
  assert.equal(await generateVersionButton.isDisabled(), true)
  await waitForComputedStyle(
    generateVersionButton,
    'backgroundColor',
    'rgb(241, 241, 243)',
  )
  const disabledGenerateAppearance = await generateVersionButton.evaluate(
    (element) => {
      const style = getComputedStyle(element)
      return {
        backgroundColor: style.backgroundColor,
        color: style.color,
        opacity: style.opacity,
      }
    },
  )
  assert.equal(
    disabledGenerateAppearance.backgroundColor,
    'rgb(241, 241, 243)',
  )
  assert.equal(disabledGenerateAppearance.color, 'rgb(79, 81, 90)')
  assert.equal(disabledGenerateAppearance.opacity, '1')
  assert.notEqual(
    disabledGenerateAppearance.backgroundColor,
    enabledGenerateBackground,
  )

  const editorDestination = editorPage.locator(
    '#editor-social-cover-qr-destination',
  )
  const saveSettings = editorPage.getByRole('button', {
    name: 'Save QR settings',
  })
  assert.equal(await saveSettings.isDisabled(), true)
  await editorDestination.fill('ftp://example.com/not-trackable')
  assert.equal(await saveSettings.isDisabled(), true)
  await editorDestination.fill(' https://example.com/editor-social ')
  assert.equal(await saveSettings.isEnabled(), true)

  editorState.operationLog.length = 0
  await saveSettings.click()
  await editorPage.getByText(
    'QR settings were saved, but the primary placement could not be prepared.',
    { exact: true },
  ).first().waitFor()
  assert.deepEqual(editorState.campaignWrites.at(-1), {
    method: 'PATCH',
    body: {
      poster_format: 'rednote_3x4',
      destination_url: 'https://example.com/editor-social',
    },
  })
  assert.equal(editorState.campaign.poster_format, 'rednote_3x4')
  assert.equal(
    editorState.campaign.destination_url,
    'https://example.com/editor-social',
  )
  assertOperationOrder(editorState, [
    'campaign-qr-update',
    'placement-lookup',
    'placement-create',
    'placement-refresh',
    'campaign-read',
  ])
  await editorPage.getByRole('link', { name: 'Placements', exact: true })
    .waitFor()
  await editorPage.getByRole('link', { name: 'Analytics', exact: true })
    .waitFor()
  await editorPage.getByRole('button', { name: 'Publish', exact: true })
    .waitFor()

  await editorPage.waitForTimeout(80)
  editorState.placementCreateFailuresRemaining = 0
  editorState.operationLog.length = 0
  await editorPage.locator('.editor-social-cover-qr')
    .getByRole('button', { name: 'Retry primary placement' })
    .click()
  await editorPage.getByText('Primary placement ready.', { exact: true })
    .waitFor()
  await waitFor(() => editorState.placements.length === 1)
  assertOperationOrder(editorState, [
    'placement-lookup',
    'placement-create',
    'placement-refresh',
    'campaign-read',
  ])
  assert.equal(await generateVersionButton.isEnabled(), true)

  // Order-147: the campaign name is editable after creation. The name is baked
  // into posters, export filenames and utm_campaign, so the only prior escape
  // from a typo was deleting the campaign.
  editorState.campaignWrites.length = 0
  assert.equal(
    await editorPage.locator('.campaign-identity strong').textContent(),
    'Signal Studio',
  )
  await editorPage.getByRole('button', { name: 'Rename campaign' }).click()
  const renameField = editorPage.locator('#campaign-rename')
  await renameField.waitFor()
  // The field is seeded with the stored title and takes focus, so a keyboard
  // user is not parked on the trigger of a panel that exists only for typing.
  assert.equal(await renameField.inputValue(), 'Signal Studio')
  assert.equal(
    await renameField.evaluate((node) => node === document.activeElement),
    true,
  )
  const saveRename = editorPage.getByRole('button', { name: 'Save', exact: true })
  // Re-saving an unchanged title is not a write.
  assert.equal(await saveRename.isDisabled(), true)
  // Whitespace-only differences normalize away, so they are not a change either.
  await renameField.fill('  Signal Studio  ')
  assert.equal(await saveRename.isDisabled(), true)

  await renameField.fill('Signal Studio EU')
  assert.equal(await saveRename.isDisabled(), false)
  await saveRename.click()
  await editorPage.getByText('Campaign name updated.', { exact: true }).waitFor()
  assert.deepEqual(
    editorState.campaignWrites.map((write) => write.body.product_name),
    ['Signal Studio EU'],
  )
  // Every surface reads the name from the shared campaign bar, so one write
  // renames the editor, placements and analytics together.
  await editorPage.getByText('Signal Studio EU', { exact: true }).first().waitFor()
  assert.equal(await editorPage.locator('#campaign-rename').count(), 0)

  // Clearing the title persists NULL, never '' — '' passes a ?? guard and would
  // squat a blank utm_campaign and an export filename beginning with '-'.
  editorState.campaignWrites.length = 0
  await editorPage.getByRole('button', { name: 'Rename campaign' }).click()
  await editorPage.locator('#campaign-rename').fill('   ')
  await editorPage.getByRole('button', { name: 'Save', exact: true }).click()
  await editorPage.getByText('Campaign name updated.', { exact: true }).waitFor()
  assert.deepEqual(
    editorState.campaignWrites.map((write) => write.body.product_name),
    [null],
  )
  await editorPage.getByText('Untitled campaign', { exact: true }).first().waitFor()

  assert.deepEqual(editorErrors, [])
  await editorContext.close()

  const recoveryContext = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  const recoveryState = createState({
    editorReady: true,
    placementCreateFailuresRemaining: 20,
  })
  configureSocialCoverState(recoveryState, { qrEnabled: true })
  await installBackendMock(recoveryContext, recoveryState)
  const recoveryPage = await recoveryContext.newPage()
  const recoveryErrors = []
  recoveryPage.on('pageerror', (error) => recoveryErrors.push(error))

  await recoveryPage.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await recoveryPage.getByText(
    'The primary placement could not be prepared.',
    { exact: true },
  ).first().waitFor()
  const canvasRecovery = recoveryPage.locator('.canvas-placement-state')
  await canvasRecovery.waitFor()
  assert.equal(await recoveryPage.locator('[data-poster-hero]').count(), 0)
  assert.equal(await recoveryPage.locator('[data-poster-footer]').count(), 0)
  assert.equal(
    await recoveryPage.locator('[data-poster-size="rednote_3x4"]').count(),
    0,
  )

  await recoveryPage.waitForTimeout(80)
  recoveryState.placementCreateFailuresRemaining = 0
  recoveryState.operationLog.length = 0
  await canvasRecovery.getByRole('button', {
    name: 'Retry primary placement',
  }).click()
  await waitFor(() => recoveryState.placements.length === 1)
  await recoveryPage.locator('[data-poster-size="rednote_3x4"]')
    .first().waitFor()
  await recoveryPage.locator('[data-poster-footer]').first().waitFor()
  assertOperationOrder(recoveryState, [
    'placement-lookup',
    'placement-create',
    'placement-refresh',
    'campaign-read',
  ])
  assert.deepEqual(recoveryErrors, [])
  await recoveryContext.close()
}

async function testCampaignWizardTextResize(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  })
  const state = createState()
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await openWizardForm(page, 'Website product')
  // A tracked destination so the summary has a Destination row and a long URL.
  const sourceHost =
    'source-catalog-for-low-vision-wizard-reflow.posterlytics-example.com'
  const destinationHost =
    'destination-checkout-for-low-vision-wizard-reflow.posterlytics-example.com'
  await page.locator('#source-url').fill(`https://${sourceHost}/products/poster`)
  await page.locator('#poster-qr-destination').fill(`https://${destinationHost}/signup`)
  // Stay one pixel above the 899px stack breakpoint so this exercises the narrow two-column wizard.
  await page.setViewportSize({ width: 900, height: 900 })
  await waitForAnimationFrames(page, 2)
  await page.locator('.campaign-summary dd').filter({ hasText: sourceHost }).waitFor()
  await page.locator('.campaign-summary dd').filter({ hasText: destinationHost }).waitFor()

  const normalReport = await readCampaignWizardReflowGeometry(page)
  const normalDetails = JSON.stringify(normalReport)
  assert.ok(normalReport.summaryRows.length > 0, 'Expected campaign summary rows.')
  assert.equal(
    normalReport.outputButtons.length,
    2,
    `Expected both output-kind buttons: ${normalDetails}`,
  )

  await page.addStyleTag({
    content: `
      .wizard-layout,
      .wizard-layout * {
        line-height: 1.5 !important;
        letter-spacing: 0.12em !important;
        word-spacing: 0.16em !important;
      }
    `,
  })
  await doubleComputedTextMetrics(
    page,
    [
      '.campaign-form .input',
      '.campaign-summary dt',
      '.campaign-summary dd',
      '.output-kind-control .segmented-control button',
    ].join(', '),
  )

  const report = await readCampaignWizardReflowGeometry(page)
  const details = JSON.stringify(report)

  assert.ok(report.inputReports.length > 0, 'Expected visible campaign inputs.')
  assert.equal(
    report.inputReports.every((input) => input.height + 1 >= input.requiredHeight),
    true,
    `resized campaign input clipped its line box: ${details}`,
  )
  assert.equal(
    report.summaryRows.every((row) => row.doesNotIntersectNext),
    true,
    `resized campaign summary rows intersected: ${details}`,
  )
  assert.equal(
    report.summaryRows.every((row) =>
      row.termTextWithinElementAndRow
      && row.valueTextWithinElementAndRow),
    true,
    `resized campaign summary text escaped its row: ${details}`,
  )
  assert.equal(
    report.summaryRows.every((row) => !row.termValueTextIntersects),
    true,
    `resized campaign summary term and value text intersected: ${details}`,
  )
  assert.equal(
    report.summaryRows.every((row) =>
      row.rowScrollWidth <= row.rowClientWidth + 1
      && row.termScrollWidth <= row.termClientWidth + 1
      && row.valueScrollWidth <= row.valueClientWidth + 1),
    true,
    `resized campaign summary overflowed horizontally: ${details}`,
  )

  const longUrlRows = report.summaryRows.filter(
    (row) => row.term === 'Source' || row.term === 'Destination',
  )
  assert.equal(
    longUrlRows.length,
    2,
    `Expected Source and Destination summary rows: ${details}`,
  )
  assert.equal(
    longUrlRows.every((row) => row.valueBelowTerm && row.valueTextRects.length > 1),
    true,
    `long summary URLs did not wrap below their terms: ${details}`,
  )

  assert.equal(
    report.outputButtons.length,
    2,
    `Expected both resized output-kind buttons: ${details}`,
  )
  assert.equal(
    report.outputButtons.every((button) =>
      button.textWithinButton
      && button.scrollWidth <= button.clientWidth + 1),
    true,
    `resized output-kind button escaped or clipped: ${details}`,
  )
  assert.equal(
    report.outputButtonsIntersect,
    false,
    `resized output-kind buttons intersected: ${details}`,
  )
  await assertNoOverflow(page)
  assert.deepEqual(pageErrors, [])
  await page.screenshot({
    path: `${OUTPUT_DIR}/campaign-wizard-wcag-spacing-200-percent-text.png`,
    fullPage: true,
  })
  await context.close()
}

async function testAmazonProductTitleAssist(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1180, height: 860 },
    reducedMotion: 'reduce',
  })
  const state = createState()
  state.amazonProductLookupResponses.push({
    delayMs: 120,
    body: {
      status: 'found',
      title: 'Northstar Portable Signal Lamp',
    },
  })
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await openWizardForm(page, 'Amazon listing')
  const source = page.locator('#source-url')
  const productName = page.locator('#product-name')
  // Title is optional in the unified screen.
  assert.equal(await productName.evaluate((el) => el.required), false)

  const firstUrl = 'https://www.amazon.com/dp/B0TITLE001?tag=seller-20'
  await source.fill(firstUrl)
  await source.blur()
  await waitFor(() => state.amazonProductLookupRequests.length === 1)
  assert.deepEqual(state.amazonProductLookupRequests[0].body, { url: firstUrl })
  assert.equal(
    state.amazonProductLookupRequests[0].authorization,
    'Bearer asset-review-token',
  )
  await source.focus()
  await source.blur()
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(state.amazonProductLookupRequests.length, 1)
  await page.waitForFunction(
    (title) =>
      document.querySelector('#product-name')?.value === title,
    'Northstar Portable Signal Lamp',
  )

  await productName.fill('')
  await source.fill('https://www.amazon.com/dp/B0TITLE001?ref_=same-product')
  await source.blur()
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(state.amazonProductLookupRequests.length, 1)

  await productName.fill('Seller-approved product name')
  await source.fill('https://www.amazon.com/dp/B0TITLE002')
  await source.blur()
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(state.amazonProductLookupRequests.length, 1)
  assert.equal(await productName.inputValue(), 'Seller-approved product name')

  state.amazonProductLookupResponses.push(
    {
      delayMs: 180,
      body: { status: 'found', title: 'Stale product title' },
    },
    {
      body: { status: 'found', title: 'Current product title' },
    },
  )
  await productName.fill('')
  await source.fill('https://www.amazon.com/dp/B0TITLE003')
  await source.blur()
  await waitFor(() => state.amazonProductLookupRequests.length === 2)
  await source.fill('https://www.amazon.com/dp/B0TITLE004')
  await source.blur()
  await waitFor(() => state.amazonProductLookupRequests.length === 3)
  await page.waitForFunction(
    () =>
      document.querySelector('#product-name')?.value === 'Current product title',
  )
  await new Promise((resolve) => setTimeout(resolve, 220))
  assert.equal(await productName.inputValue(), 'Current product title')

  state.amazonProductLookupResponses.push({
    body: { status: 'unavailable' },
  })
  await productName.fill('')
  await source.fill('https://www.amazon.com/dp/B0TITLE005')
  await source.blur()
  await waitFor(() => state.amazonProductLookupRequests.length === 4)
  await page.getByText(
    'Product title unavailable. Enter the product name.',
    { exact: true },
  ).waitFor()
  assert.equal(await productName.evaluate((el) => el.required), false)
  assert.equal(await page.locator('.campaign-form > .inline-notice-error').count(), 0)
  await assertNoOverflow(page)
  await page.screenshot({
    path: `${OUTPUT_DIR}/amazon-title-assist-desktop.png`,
    fullPage: true,
  })
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testWebsiteCapturePreview(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 980 },
    reducedMotion: 'reduce',
  })
  const state = createState()
  const initialInputUrl = 'Example.COM#details'
  const initialRequestUrl = 'https://example.com/'
  state.capturePreviewResponses.push({
    delayMs: 140,
    body: capturePreviewFixture(initialRequestUrl, 'initial', {
      includeMissingImage: true,
    }),
  })
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await openWizardForm(page, 'Website product')
  const productUrl = page.locator('#source-url')

  // An Amazon URL routes to amazon_listing: no website capture.
  await productUrl.fill('https://www.amazon.com/dp/B0EXAMPLE')
  assert.equal(
    await page.getByRole('button', { name: 'Capture website' }).count(),
    0,
  )
  // No URL routes to social_cover: still no capture.
  await productUrl.fill('')
  assert.equal(
    await page.getByRole('button', { name: 'Capture website' }).count(),
    0,
  )
  // A non-Amazon URL routes to website_product and offers capture.
  await productUrl.fill(initialInputUrl)
  const captureButton = page.getByRole('button', { name: 'Capture website' })
  await captureButton.evaluate((element) => {
    element.click()
    element.click()
    element.click()
  })
  await page.getByRole('button', { name: 'Capturing your site…' }).waitFor()
  await waitFor(() => state.capturePreviewRequests.length === 1)
  assert.deepEqual(state.capturePreviewRequests[0].body, {
    url: initialRequestUrl,
    use_case: 'website_product',
    color_scheme: 'light',
  })
  assert.equal(
    state.capturePreviewRequests[0].authorization,
    'Bearer asset-review-token',
  )

  const evidence = page.locator('.website-evidence-panel')
  await evidence.waitFor()
  await evidence.getByText('Website style board', { exact: true }).waitFor()
  await evidence.getByText('Website logo', { exact: true }).waitFor()
  await evidence.getByText('Product image 1', { exact: true }).waitFor()
  await evidence.getByText('Website colors', { exact: true }).waitFor()
  await evidence.getByText('Website typefaces', { exact: true }).waitFor()
  await evidence.getByText('Preview unavailable', { exact: true }).waitFor()
  assert.equal(await evidence.locator('.website-color-list span').count(), 3)
  assert.equal(await productUrl.inputValue(), initialInputUrl)
  assert.equal(
    await page.getByRole('button', { name: 'Generate poster' }).isEnabled(),
    true,
  )
  await assertNoOverflow(page)
  await page.screenshot({
    path: `${OUTPUT_DIR}/capture-preview-desktop.png`,
    fullPage: true,
  })

  assert.equal(
    await page.getByRole('button', { name: 'Capture again' }).isDisabled(),
    true,
  )
  const retryUrl = 'https://example.com/product?retry=1'
  state.capturePreviewResponses.push({
    body: {
      preview: emptyCapturePreview(retryUrl),
      error: {
        code: 'capture_timeout',
        message: 'Capture request timed out.',
        retryable: true,
      },
    },
  })
  await page.locator('#source-url').fill(retryUrl)
  const resetCaptureButton = page.getByRole('button', { name: 'Capture website' })
  await resetCaptureButton.waitFor()
  assert.equal(await resetCaptureButton.isEnabled(), true)
  await resetCaptureButton.click()
  await waitFor(() => state.capturePreviewRequests.length === 2)
  assert.equal(state.capturePreviewRequests[1].body.url, retryUrl)
  await page.getByText('Website preview unavailable.', { exact: true }).waitFor()
  await page.getByText('You can still generate the poster.', { exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Generate poster' }).isEnabled(),
    true,
  )

  const rateLimitedUrl = 'https://example.com/product?limited=1'
  state.capturePreviewResponses.push({
    status: 429,
    body: { error: { code: 'rate_limited' } },
  })
  await page.locator('#source-url').fill(rateLimitedUrl)
  const rateLimitedButton = page.getByRole('button', { name: 'Capture website' })
  await rateLimitedButton.waitFor()
  await rateLimitedButton.click()
  await waitFor(() => state.capturePreviewRequests.length === 3)
  assert.equal(state.capturePreviewRequests[2].body.url, rateLimitedUrl)
  await page.getByText(
    'Website capture limit reached. Try again shortly.',
    { exact: true },
  ).waitFor()
  await page.getByText('You can still generate the poster.', { exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Generate poster' }).isEnabled(),
    true,
  )
  await new Promise((resolve) => setTimeout(resolve, 350))
  assert.equal(state.capturePreviewRequests.length, 3)

  await productUrl.fill('ftp://example.com')
  const invalidCaptureButton = page.getByRole('button', {
    name: 'Capture website',
  })
  await invalidCaptureButton.waitFor()
  assert.equal(await invalidCaptureButton.isEnabled(), true)
  await invalidCaptureButton.click()
  await page.getByText(
    'Enter a complete HTTP or HTTPS website URL.',
    { exact: true },
  ).waitFor()
  assert.equal(state.capturePreviewRequests.length, 3)
  assert.equal(
    await page.getByRole('button', { name: 'Generate poster' }).isEnabled(),
    true,
  )

  state.capturePreviewResponses.push(
    {
      delayMs: 260,
      body: capturePreviewFixture('https://old.example/product', 'stale'),
    },
    {
      delayMs: 20,
      body: capturePreviewFixture('https://new.example/product', 'fresh'),
    },
  )
  await page.locator('#source-url').fill('https://old.example/product')
  await page.getByRole('button', { name: 'Capture website' }).click()
  await waitFor(() => state.capturePreviewRequests.length === 4)
  await page.locator('#source-url').fill('https://new.example/product')
  await page.getByRole('button', { name: 'Capture website' }).click()
  await waitFor(() => state.capturePreviewRequests.length === 5)
  await page.locator('img[src*="logo-fresh.svg"]').waitFor()
  await new Promise((resolve) => setTimeout(resolve, 320))
  assert.equal(await page.locator('img[src*="stale"]').count(), 0)
  assert.equal(
    await page.getByRole('button', { name: 'Generate poster' }).isEnabled(),
    true,
  )
  await assertNoOverflow(page)
  assert.deepEqual(pageErrors, [])
  await context.close()

  const mobileContext = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  const mobileState = createState()
  await installBackendMock(mobileContext, mobileState)
  const mobilePage = await mobileContext.newPage()
  const mobileErrors = []
  mobilePage.on('pageerror', (error) => mobileErrors.push(error))

  await openWizardForm(mobilePage, 'Website product')
  await mobilePage.locator('#source-url').fill('https://mobile.example/product')
  await mobilePage.getByRole('button', { name: 'Capture website' }).click()
  const mobileEvidence = mobilePage.locator('.website-evidence-panel')
  await mobileEvidence.waitFor()
  const mobileCandidate = mobileEvidence.locator('figure.is-candidate.is-included')
    .filter({ hasText: 'Product image 1' })
  const mobileControls = mobileCandidate.locator('.website-evidence-candidate-controls')
  const mobileToggle = mobileControls.getByRole('button', {
    name: 'Exclude Product image 1 as a candidate',
  })
  await mobileToggle.waitFor()
  await mobilePage.evaluate(async () => {
    await document.fonts.ready
  })
  const mobileControlLayout = await mobileControls.evaluate((controls) => {
    if (!(controls instanceof HTMLElement)) {
      throw new Error('Candidate controls are unavailable.')
    }
    const toggle = controls.querySelector('.website-evidence-candidate-toggle')
    const arrows = [...controls.querySelectorAll('.icon-button')]
    if (
      !(toggle instanceof HTMLButtonElement)
      || arrows.some((arrow) => !(arrow instanceof HTMLButtonElement))
    ) {
      throw new Error('Candidate controls are incomplete.')
    }

    const tolerance = 1
    const toggleRect = toggle.getBoundingClientRect()
    const arrowRects = arrows.map((arrow) => arrow.getBoundingClientRect())
    const textRects = []
    const walker = document.createTreeWalker(toggle, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      if (node.textContent?.trim()) {
        const range = document.createRange()
        range.selectNodeContents(node)
        textRects.push(
          ...[...range.getClientRects()]
            .filter((rect) => rect.width > 0 && rect.height > 0),
        )
      }
      node = walker.nextNode()
    }

    return {
      arrowCount: arrows.length,
      controlsClientWidth: controls.clientWidth,
      controlsScrollWidth: controls.scrollWidth,
      textWithinToggle: textRects.length > 0 && textRects.every((rect) =>
        rect.left >= toggleRect.left - tolerance
        && rect.right <= toggleRect.right + tolerance
        && rect.top >= toggleRect.top - tolerance
        && rect.bottom <= toggleRect.bottom + tolerance),
      toggleBelowArrows: (
        arrowRects.length > 0
        && toggleRect.top
          >= Math.max(...arrowRects.map((rect) => rect.bottom)) - tolerance
      ),
      toggleClientWidth: toggle.clientWidth,
      toggleScrollWidth: toggle.scrollWidth,
    }
  })
  const mobileControlDetails = JSON.stringify(mobileControlLayout)
  assert.equal(mobileControlLayout.arrowCount, 2, mobileControlDetails)
  assert.equal(mobileControlLayout.toggleBelowArrows, true, mobileControlDetails)
  assert.ok(
    mobileControlLayout.controlsScrollWidth
      <= mobileControlLayout.controlsClientWidth + 1,
    mobileControlDetails,
  )
  assert.ok(
    mobileControlLayout.toggleScrollWidth
      <= mobileControlLayout.toggleClientWidth + 1,
    mobileControlDetails,
  )
  assert.equal(mobileControlLayout.textWithinToggle, true, mobileControlDetails)
  await assertNoOverflow(mobilePage)
  await mobilePage.screenshot({
    path: `${OUTPUT_DIR}/capture-preview-mobile.png`,
    fullPage: true,
  })
  assert.deepEqual(mobileErrors, [])
  await mobileContext.close()
}

async function testSinglePaidEagerCapture(browserInstance) {
  const successContext = await browserInstance.newContext({
    colorScheme: 'dark',
    locale: 'en-US',
    viewport: { width: 1360, height: 980 },
    reducedMotion: 'reduce',
  })
  const successState = createState()
  const eagerInputUrl = 'https://Example.COM/product'
  const eagerRequestUrl = 'https://example.com/product'
  const successCapture = capturePreviewFixture(
    eagerRequestUrl,
    'selection',
    {
      colorScheme: 'dark',
      productCount: 3,
    },
  )
  successState.capturePreviewResponses.push({ body: successCapture })
  await installBackendMock(successContext, successState)
  const successPage = await successContext.newPage()
  const successErrors = []
  successPage.on('pageerror', (error) => successErrors.push(error))

  await openWizardForm(successPage, 'Website product')
  await fillWizardRequiredFields(successPage, {
    sourceUrl: eagerInputUrl,
    productName: 'Signal Studio',
    destinationUrl: 'https://example.com/start',
  })
  await successPage.getByRole('button', { name: 'Capture website' }).click()
  const evidence = successPage.locator('.website-evidence-panel')
  await evidence.waitFor()
  await evidence.getByText('Captured image candidates', { exact: true }).waitFor()
  await evidence.getByText(
    'Choose which captured images enter the candidate set and set their priority if this evidence is reused. These are preferences, not a guarantee: Editor still includes a final review, and Automatic may omit or reorder images within the included set.',
    { exact: true },
  ).waitFor()
  assert.equal(
    await evidence.locator(
      '.website-evidence-candidate-controls button[aria-describedby]',
    ).count(),
    0,
  )
  await evidence.locator('figure').filter({ hasText: 'Website logo' })
    .getByRole('button', { name: 'Exclude Website logo as a candidate' })
    .click()
  await evidence.locator('figure').filter({ hasText: 'Product image 2' })
    .getByRole('button', { name: 'Exclude Product image 2 as a candidate' })
    .click()
  await evidence.locator('figure').filter({ hasText: 'Product image 3' })
    .getByRole('button', { name: 'Raise Product image 3 candidate priority' })
    .click()

  assert.deepEqual(
    await evidence.locator('figure.is-candidate.is-included figcaption').allTextContents(),
    ['Product image 3', 'Product image 1'],
  )
  assert.deepEqual(
    await evidence.locator('figure.is-candidate.is-excluded figcaption').allTextContents(),
    ['Website logo', 'Product image 2'],
  )
  assert.deepEqual(
    await evidence.locator(
      'figure.is-candidate.is-included .website-evidence-image-preview > b',
    ).allTextContents(),
    ['1', '2'],
  )
  await assertNoOverflow(successPage)
  await submitWizardAndWaitForEnqueue(successPage, successState, 1)

  assert.equal(successState.capturePreviewRequests[0].body.url, eagerRequestUrl)
  assert.equal(successState.capturePreviewRequests[0].body.color_scheme, 'dark')
  assert.equal(successState.storageUploads.length, 1)
  assert.match(
    successState.storageUploads[0].key,
    /^style-board\/campaign-asset\/eager\/[0-9a-f-]+\.jpg$/,
  )
  const adopted = successState.campaignWrites.find((write) =>
    write.method === 'PATCH' && write.body.eager_capture_url
  )
  assert.ok(adopted)
  assert.equal(adopted.body.eager_capture_url, eagerRequestUrl)
  assert.equal(adopted.body.eager_capture_color_scheme, 'dark')
  assert.equal(adopted.body.screenshot_key, successState.storageUploads[0].key)
  const [productOne, productTwo, productThree] =
    successCapture.preview.imageUrls
  assert.deepEqual(adopted.body.brand_assets, {
    logo_url: successCapture.preview.logoUrl,
    images: [
      { url: productThree },
      { url: productOne },
      { url: productTwo },
    ],
    primary_image_url: productThree,
    eager_selection: {
      version: 1,
      excluded_urls: [productTwo],
      logo_excluded: true,
    },
  })
  assert.equal(successState.enqueueRequests[0].p_color_scheme, 'dark')
  assertOperationOrder(successState, [
    'capture-preview',
    'storage-upload',
    'campaign-eager-update',
    'enqueue',
  ])
  assert.deepEqual(successErrors, [])
  await successContext.close()

  const degradedContext = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 980 },
    reducedMotion: 'reduce',
  })
  const degradedState = createState()
  const degradedUrl = 'https://degraded.example/product'
  degradedState.capturePreviewResponses.push({
    body: {
      ...capturePreviewFixture(degradedUrl, 'degraded'),
      error: {
        code: 'capture_timeout',
        message: 'Capture request timed out.',
        retryable: true,
      },
    },
  })
  await installBackendMock(degradedContext, degradedState)
  const degradedPage = await degradedContext.newPage()

  await openWizardForm(degradedPage, 'Website product')
  await fillWizardRequiredFields(degradedPage, {
    sourceUrl: degradedUrl,
    productName: 'Signal Studio',
    destinationUrl: 'https://example.com/start',
  })
  await degradedPage.getByRole('button', { name: 'Capture website' }).click()
  const degradedEvidence = degradedPage.locator('.website-evidence-panel')
  await degradedEvidence.waitFor()
  await degradedEvidence.getByText('Website style board', { exact: true }).waitFor()
  await degradedEvidence.getByText('Website colors', { exact: true }).waitFor()
  const degradedDescription = degradedEvidence.getByText(
    'Partial website evidence cannot be curated and will not be reused. Capture again to edit candidates.',
    { exact: true },
  )
  await degradedDescription.waitFor()
  const degradedDescriptionId = await degradedDescription.getAttribute('id')
  assert.ok(degradedDescriptionId)
  const excludeBtn = degradedEvidence.locator('figure')
    .filter({ hasText: 'Product image 1' })
    .getByRole('button', { name: 'Exclude Product image 1 as a candidate' })
  assert.equal(await excludeBtn.isDisabled(), true)
  assert.equal(await excludeBtn.getAttribute('aria-pressed'), 'true')
  const degradedCandidateControls = degradedEvidence.locator(
    '.website-evidence-candidate-controls button',
  )
  const degradedControlStates = await degradedCandidateControls.evaluateAll(
    (controls) => controls.map((control) => ({
      describedBy: control.getAttribute('aria-describedby'),
      disabled: control instanceof HTMLButtonElement && control.disabled,
    })),
  )
  assert.ok(degradedControlStates.length > 0)
  assert.equal(
    degradedControlStates.every((control) => control.disabled),
    true,
  )
  assert.equal(
    degradedControlStates.every(
      (control) => control.describedBy === degradedDescriptionId,
    ),
    true,
  )
  await submitWizardAndWaitForEnqueue(degradedPage, degradedState, 1)

  assert.deepEqual(degradedState.storageUploads, [])
  assert.equal(
    degradedState.campaignWrites.some((write) =>
      write.method === 'PATCH' && Boolean(write.body.eager_capture_url)
    ),
    false,
  )
  assertOperationOrder(degradedState, [
    'capture-preview',
    'campaign-eager-clear',
    'enqueue',
  ])
  await degradedContext.close()

  const invalidationContext = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 980 },
    reducedMotion: 'reduce',
  })
  const invalidationState = createState()
  await installBackendMock(invalidationContext, invalidationState)
  const invalidationPage = await invalidationContext.newPage()
  const invalidationErrors = []
  invalidationPage.on('pageerror', (error) => invalidationErrors.push(error))

  await openWizardForm(invalidationPage, 'Website product')
  await fillWizardRequiredFields(invalidationPage, {
    sourceUrl: 'https://old.example/product',
    productName: 'Signal Studio',
    destinationUrl: 'https://example.com/start',
  })
  await invalidationPage.getByRole('button', { name: 'Capture website' }).click()
  await invalidationPage.locator('.website-evidence-panel').waitFor()
  await invalidationPage.locator('#source-url').fill('https://new.example/product')
  await submitWizardAndWaitForEnqueue(
    invalidationPage,
    invalidationState,
    1,
  )

  assert.deepEqual(invalidationState.storageUploads, [])
  const cleared = invalidationState.campaignWrites.find((write) =>
    write.method === 'PATCH'
    && Object.hasOwn(write.body, 'eager_capture_url')
  )
  assert.ok(cleared)
  assert.deepEqual(cleared.body, {
    design_tokens: null,
    brand_assets: null,
    screenshot_url: null,
    screenshot_key: null,
    eager_capture_url: null,
    eager_capture_color_scheme: null,
    eager_captured_at: null,
  })
  assertOperationOrder(invalidationState, [
    'capture-preview',
    'campaign-eager-clear',
    'enqueue',
  ])
  assert.deepEqual(invalidationErrors, [])
  await invalidationContext.close()

  await testEagerAdoptionFailure(browserInstance, 'upload')
  await testEagerAdoptionFailure(browserInstance, 'campaign-update')
}

async function testEagerAdoptionFailure(browserInstance, failure) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 980 },
    reducedMotion: 'reduce',
  })
  const state = createState({
    eagerCampaignUpdateFailuresRemaining: failure === 'campaign-update' ? 1 : 0,
    storageUploadFailuresRemaining: failure === 'upload' ? 1 : 0,
  })
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await openWizardForm(page, 'Website product')
  await fillWizardRequiredFields(page, {
    sourceUrl: `https://${failure}.example/product`,
    productName: 'Signal Studio',
    destinationUrl: 'https://example.com/start',
  })
  await page.getByRole('button', { name: 'Capture website' }).click()
  await page.locator('.website-evidence-panel').waitFor()
  await submitWizardAndWaitForEnqueue(page, state, 1)

  assert.equal(state.enqueueRequests.length, 1)
  assert.equal(state.enqueueRequests[0].p_color_scheme, 'light')
  assert.ok(
    state.operationLog.findIndex((entry) => entry.type === 'enqueue')
      > state.operationLog.findIndex((entry) =>
        entry.type === (
          failure === 'upload'
            ? 'storage-upload-strategy'
            : 'campaign-eager-update'
        )
      ),
  )
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
  await page.getByText(
    'Campaign details were saved; generation did not start.',
    { exact: true },
  ).waitFor()
  assert.deepEqual(
    state.campaignWrites.map((write) => write.method),
    ['POST', 'PATCH', 'PATCH'],
  )
  assert.equal(state.campaignWrites[0].body[0].use_case, 'website_product')

  // In the unified screen the use case follows the source URL — no banner, no
  // click. Editing the primary URL to an Amazon host reclassifies the draft.
  const amazonUrl =
    'https://www.amazon.com/dp/B0SWITCH?maas=maas_adg_api_123%2F456&ref_=aa_maas'
  // Turn QR off first so the retry does not require a destination.
  await page.getByRole('switch', { name: /Add a tracked QR footer/ }).click()
  await page.locator('#source-url').fill(amazonUrl)
  await page.getByText('Amazon seller reference mode', { exact: true }).waitFor()
  const listingFileInput = page.getByTestId('reference-file-input')
  await listingFileInput.setInputFiles(
    referenceImageFile('amazon-draft-switch.png'),
  )
  await page.locator('.reference-tile').waitFor()
  await submitWizardAndWaitForEnqueue(page, state, 2)

  const correction = state.campaignWrites.find((write) =>
    write.method === 'PATCH' && write.body.product_url === amazonUrl
  )
  assert.ok(correction)
  assert.equal(correction.body.product_url, amazonUrl)
  assert.equal(correction.body.use_case, 'amazon_listing')
  assert.equal(state.enqueueModes.length, 1)
  // Creation never runs the editor asset-review mode.
  assert.deepEqual(state.enqueueModes, ['yolo'])
  assert.deepEqual(pageErrors, [])
  await context.close()
}

// Order-139: the wizard persists the campaign BEFORE uploading references and
// enqueueing, so a failed submit leaves a real row. Discarding the local draft
// drops serverCampaignId — the only pointer to it — so the row has to be deleted
// as part of the discard or it survives as an indistinguishable 'Draft'.
async function testCampaignWizardDiscardDeletesOrphanedCampaign(browserInstance) {
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
    productName: 'Orphan Check',
    destinationUrl: 'https://example.com/start',
  })
  await submitWizardAndWaitForEnqueue(page, state, 1)
  await page.getByText(
    'Campaign details were saved; generation did not start.',
    { exact: true },
  ).waitFor()
  // The row exists at this point and nothing has deleted it.
  assert.equal(state.campaignDeleted, false)

  // Discard is offered on a RESTORED draft, so reload the way a user who walked
  // away and came back would. The restored draft carries serverCampaignId, which
  // is what makes the orphaned row reachable at all.
  await page.reload()
  await page.getByRole('heading', { name: 'Create campaign' }).waitFor()
  await page.getByText('Local draft restored.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Retry generation' }).waitFor()

  // The discard label names the campaign only once one exists, because discarding
  // now deletes it — 'Discard local draft' alone reads as browser-only.
  assert.equal(
    await page.getByRole('button', { name: 'Discard local draft' }).count(),
    0,
  )
  await page.getByRole('button', { name: 'Discard draft and saved campaign' })
    .click()

  await waitFor(() => state.campaignDeleted === true)
  assert.deepEqual(
    state.operationLog.filter((entry) => entry.type === 'campaign-delete').length,
    1,
  )
  // The form is reset back to a fresh create, and the failed-submit notice is
  // gone along with the draft that pointed at the deleted row.
  await page.getByRole('button', { name: 'Generate poster' }).waitFor()
  assert.equal(
    await page.getByText(
      'Campaign details were saved; generation did not start.',
      { exact: true },
    ).count(),
    0,
  )
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testCampaignWizardPreference(browserInstance) {
  // The mid-pipeline asset-selection preference was removed from creation (it is
  // hardcoded to yolo and lives only in the editor). What remains worth checking
  // is that a local draft round-trips the output kind across a reload.
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  const state = createState()
  await installBackendMock(context, state)
  const page = await context.newPage()

  await openWizardForm(page, 'Website product')
  assert.equal(
    await page.getByRole('group', { name: 'Asset selection mode' }).count(),
    0,
  )
  await page.getByRole('radio', { name: 'Multi-page post' }).click()
  await page.waitForFunction(
    () => document.querySelector('[role="radio"][aria-checked="true"]')?.textContent?.includes('Multi-page post') ?? false,
  )
  await page.reload()
  await page.getByRole('heading', { name: 'Create campaign' }).waitFor()
  await page.getByText('Local draft restored.', { exact: true }).waitFor()
  await page.getByRole('radio', { name: 'Multi-page post' }).waitFor()
  assert.equal(
    await page.getByRole('radio', { name: 'Multi-page post' }).getAttribute('aria-checked'),
    'true',
  )
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
  const transcript = page.locator('.poster-transcript')
  await transcript.getByText('Poster text', { exact: true }).waitFor()
  await transcript.getByText('Signal Studio', { exact: true }).waitFor()
  await transcript.getByText('Make the signal visible', { exact: true }).waitFor()
  await transcript.getByRole('button', { name: 'Copy poster text' }).waitFor()
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
  // qrCapable use case with a banded default: QR toggle + 4 banded aspect options.
  assert.equal(await page.getByRole('switch', { name: /Add a tracked QR footer/ }).count(), 1)
  assert.equal(await page.locator('#next-poster-format option').count(), 4)

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
    'Product and brand images Required',
  )
  const amazonFileInput = page.getByTestId('reference-file-input')
  assert.equal(await amazonFileInput.getAttribute('aria-required'), 'true')
  const generate = page.getByRole('button', { name: 'Generate version' })
  assert.equal(await generate.isDisabled(), true)
  await page.getByText('Add at least 1 images.', { exact: true }).waitFor()
  await page.getByText('Amazon seller reference mode', { exact: true }).waitFor()
  // qrCapable use case with a banded default: QR toggle + 4 banded aspect options.
  assert.equal(await page.getByRole('switch', { name: /Add a tracked QR footer/ }).count(), 1)
  assert.equal(await page.locator('#next-poster-format option').count(), 4)
  await assertNoOverflow(page)
  await page.screenshot({
    path: `${OUTPUT_DIR}/amazon-editor-inputs-desktop.png`,
    fullPage: true,
  })
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testReferenceOnlyEditorReusesPersistedImages(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  const state = createState({ editorReady: true })
  const persistedReference = {
    key: 'references/user-asset/current.png',
    url: `${BASE_URL}/fixture/poster.svg`,
    name: 'current.png',
    mime_type: 'image/png',
    size_bytes: 120,
  }
  Object.assign(state.campaign, {
    product_url: null,
    destination_url: null,
    use_case: 'social_cover',
    platform_hint: 'Instagram',
    poster_format: 'rednote_cover_3x4',
    reference_images: [persistedReference],
  })
  Object.assign(state.currentGeneration, {
    use_case: 'social_cover',
    platform_hint: 'Instagram',
    poster_format: 'rednote_cover_3x4',
    reference_images: [persistedReference],
  })
  state.placements = []
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await page.getByRole('heading', { name: 'Create next version' }).waitFor()
  await page.getByText(
    'Existing reference images are reused when no new images are added.',
  ).first().waitFor()
  await page.locator('.editor-inspector .generation-references textarea').fill(
    'Keep the composition and make the headline more direct.',
  )

  const generate = page.getByRole('button', { name: 'Generate version' })
  assert.equal(await generate.isEnabled(), true)
  await generate.click()
  await waitFor(() => state.enqueueRequests.length === 1)
  assert.deepEqual(
    state.enqueueRequests[0].p_reference_images,
    [persistedReference],
  )
  assert.equal(
    state.enqueueRequests[0].p_instruction,
    'Keep the composition and make the headline more direct.',
  )
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testAmazonEditorReusesPersistedImages(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  const state = createState({ editorReady: true })
  const amazonUrl = 'https://www.amazon.com/dp/B0EXAMPLE'
  const persistedReference = {
    key: 'references/user-asset/amazon-current.png',
    url: `${BASE_URL}/fixture/poster.svg`,
    name: 'amazon-current.png',
    mime_type: 'image/png',
    size_bytes: 120,
  }
  Object.assign(state.campaign, {
    product_url: amazonUrl,
    destination_url: amazonUrl,
    use_case: 'amazon_listing',
    reference_images: [persistedReference],
  })
  Object.assign(state.currentGeneration, {
    use_case: 'amazon_listing',
    reference_images: [persistedReference],
  })
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await page.getByRole('heading', { name: 'Create next version' }).waitFor()
  assert.equal(
    await page.locator(
      '.editor-inspector .generation-references .field-label',
    ).innerText(),
    'Product and brand images Required',
  )
  assert.equal(
    await page.getByTestId('reference-file-input').getAttribute('aria-required'),
    'true',
  )
  // Amazon listings are never scraped, so the "re-read website" control is not
  // offered (Order-138) — and the analyze stage still runs over seller
  // references, which is what generation_mode='website_refresh' selects.
  assert.equal(
    await page.getByRole('checkbox', { name: 'Re-read website before generating' }).count(),
    0,
  )

  const generate = page.getByRole('button', { name: 'Generate version' })
  assert.equal(await generate.isEnabled(), true)
  await generate.click()
  await waitFor(() => state.enqueueRequests.length === 1)
  assert.deepEqual(
    state.enqueueRequests[0].p_reference_images,
    [persistedReference],
  )
  assert.equal(state.enqueueRequests[0].p_refresh_website, true)
  assert.deepEqual(state.storageUploads, [])
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testPosterTranscriptVersionSwitch(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  await context.addInitScript(() => {
    window.__posterTranscriptClipboardWrites = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(value) {
          window.__posterTranscriptClipboardWrites.push(String(value))
          return Promise.resolve()
        },
      },
    })
  })
  const state = createState({ editorReady: true })
  state.currentGeneration.version_number = 2
  state.currentGeneration.poster_spec = {
    qr_label: 'Review current',
    urls: 'https://example.com',
  }
  state.currentGeneration.poster_layout = posterLayout([
    { band: 'top', role: 'brand', content: 'Signal Studio' },
    { band: 'upper', role: 'headline', content: 'Current signal' },
    { band: 'lower', role: 'proof', content: 'Current proof' },
  ])
  state.readyGenerations.push({
    ...state.currentGeneration,
    id: 'generation-previous',
    version_number: 1,
    poster_spec: {
      qr_label: 'Review earlier',
      urls: 'https://example.com',
    },
    poster_layout: posterLayout([
      { band: 'lower', role: 'proof', content: 'Previous proof' },
      { band: 'top', role: 'brand', content: 'Signal Studio' },
      { band: 'upper', role: 'headline', content: 'Earlier signal' },
    ]),
  })
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
  const transcript = page.locator('.poster-transcript')
  await transcript.getByText('Current signal', { exact: true }).waitFor()
  assert.equal(
    await page.locator('[data-poster-hero]').getAttribute('alt'),
    'Poster for Signal Studio: Current signal · Current proof · Review current · Point your camera here',
  )

  const versions = page.getByRole('region', { name: 'Versions' })
  if (await versions.count() === 0) {
    await page.getByRole('button', { name: 'Toggle versions panel' }).click()
  }
  await versions.locator('.version-row').filter({ hasText: 'Version 1' }).click()
  await transcript.getByText('Earlier signal', { exact: true }).waitFor()
  assert.equal(
    await page.locator('[data-poster-hero]').getAttribute('alt'),
    'Poster for Signal Studio: Earlier signal · Previous proof · Review earlier · Point your camera here',
  )

  await transcript.getByRole('button', { name: 'Copy poster text' }).click()
  await page.getByText('Poster text copied.', { exact: true }).waitFor()
  assert.deepEqual(
    await page.evaluate(() => window.__posterTranscriptClipboardWrites),
    [
      'Signal Studio\n\nEarlier signal\n\nPrevious proof\n\nReview earlier\n\nPoint your camera here',
    ],
  )
  assert.equal(
    await page.locator('[data-poster-footer]').getAttribute('aria-hidden'),
    'true',
  )
  await assertNoOverflow(page)
  await page.screenshot({
    path: `${OUTPUT_DIR}/poster-transcript-version-desktop.png`,
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

async function testSocialCoverLateQrSampling(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  await installPosterSamplingCounter(context)
  const state = createState()
  configureSocialCoverState(state, { qrEnabled: false })
  state.campaign.current_generation_id = null
  state.campaign.hero_image_url = `${BASE_URL}/fixture/edge-poster.svg`
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await page.getByRole('heading', { name: 'Create next version' }).waitFor()
  const hero = page.locator(
    '.canvas-stage [data-poster-size="rednote_cover_3x4"] [data-poster-hero]',
  )
  await waitForHeroComplete(hero)
  assert.equal(
    await posterSamplingCount(page),
    0,
    'the full-bleed social cover must not sample before QR eligibility',
  )
  await retainPosterHeroAndArmLoadCounter(hero)

  await page.getByRole('switch', { name: /Add a tracked QR footer/ }).click()
  await page.locator('#editor-social-cover-qr-destination')
    .fill('https://example.com/late-qr')
  await page.getByRole('button', { name: 'Save QR settings' }).click()

  const footer = page.locator(
    '.canvas-stage [data-poster-size="rednote_3x4"] '
    + '[data-poster-footer][data-footer-color-source="sampled"]',
  )
  await footer.waitFor()
  await waitForComputedStyle(footer, 'backgroundColor', 'rgb(237, 243, 238)')
  const currentHero = page.locator(
    '.canvas-stage [data-poster-size="rednote_3x4"] [data-poster-hero]',
  )
  assert.equal(
    await isRetainedPosterHero(currentHero),
    true,
    'late QR eligibility must retain the completed hero element',
  )
  assert.equal(
    await posterHeroLoadCount(page),
    0,
    'late QR eligibility must not load the retained hero again',
  )
  assert.equal(
    await posterSamplingCount(page),
    1,
    'late QR eligibility must sample the retained hero exactly once',
  )
  assert.equal(await footer.getAttribute('data-footer-color'), '#edf3ee')
  assert.equal(state.placementWrites.length, 1)
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testPosterBackgroundReloadPreservesHero(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  await installPosterSamplingCounter(context)
  const state = createState({
    awaitingReviewActivity: true,
    editorReady: true,
  })
  const edgePosterUrl = `${BASE_URL}/fixture/edge-poster.svg`
  state.campaign.hero_image_url = edgePosterUrl
  state.currentGeneration.hero_image_url = edgePosterUrl

  const initialCampaignGate = deferred()
  const initialGenerationGate = deferred()
  state.campaignReadGate = initialCampaignGate.promise
  state.generationReadGate = initialGenerationGate.promise
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await waitFor(() => (
    operationCount(state, 'campaign-read') >= 1
    && operationCount(state, 'generation-read') >= 1
  ))
  await page.locator('.spinner-wrap.full').waitFor()
  assert.equal(await page.locator('.canvas-stage [data-poster-hero]').count(), 0)

  state.campaignReadGate = null
  state.generationReadGate = null
  initialCampaignGate.resolve()
  initialGenerationGate.resolve()

  const footer = page.locator(
    '.canvas-stage [data-poster-size="a4_2x3"] '
    + '[data-poster-footer][data-footer-color-source="sampled"]',
  )
  await footer.waitFor()
  await page.locator('.editor-generation-status')
    .getByRole('link', { name: 'Review assets' })
    .waitFor()
  await waitForAnimationFrames(page, 2)
  const hero = page.locator(
    '.canvas-stage [data-poster-size="a4_2x3"] [data-poster-hero]',
  )
  await waitForHeroComplete(hero)
  assert.equal(await posterSamplingCount(page), 1)
  await retainPosterHeroAndArmLoadCounter(hero)

  const campaignReads = operationCount(state, 'campaign-read')
  const generationReads = operationCount(state, 'generation-read')
  const backgroundCampaignGate = deferred()
  const backgroundGenerationGate = deferred()
  state.campaignReadGate = backgroundCampaignGate.promise
  state.generationReadGate = backgroundGenerationGate.promise
  state.now = new Date(Date.parse(state.now) + 1000).toISOString()

  const campaignResponse = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/database/records/campaigns'
  ))
  const generationResponse = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/database/records/poster_generations'
  ))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => (
    operationCount(state, 'campaign-read') > campaignReads
    && operationCount(state, 'generation-read') > generationReads
  ))

  assert.equal(
    await isRetainedPosterHero(hero),
    true,
    'a pending same-ID refresh must retain the mounted hero',
  )
  assert.equal(
    await page.locator('.spinner-wrap.full').count(),
    0,
    'a pending same-ID refresh must not replace the editor with a full spinner',
  )
  assert.equal(await posterHeroLoadCount(page), 0)
  assert.equal(await posterSamplingCount(page), 1)

  state.campaignReadGate = null
  state.generationReadGate = null
  backgroundCampaignGate.resolve()
  backgroundGenerationGate.resolve()
  await Promise.all([campaignResponse, generationResponse])
  await waitForAnimationFrames(page, 2)

  assert.equal(
    await isRetainedPosterHero(hero),
    true,
    'an unchanged same-ID refresh must preserve hero identity after both responses',
  )
  assert.equal(await page.locator('.spinner-wrap.full').count(), 0)
  assert.equal(
    await posterHeroLoadCount(page),
    0,
    'an unchanged same-ID refresh must not load the hero again',
  )
  assert.equal(
    await posterSamplingCount(page),
    1,
    'an unchanged same-ID refresh must retain the single preview sample',
  )
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

async function testQrFooterRasterFontParity(browserInstance) {
  const context = await browserInstance.newContext({
    acceptDownloads: true,
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  await installPosterExportSvgAudit(context)
  const state = createState({ editorReady: true })
  const edgePosterUrl = `${BASE_URL}/fixture/edge-poster.svg`
  state.campaign.hero_image_url = edgePosterUrl
  state.currentGeneration.hero_image_url = edgePosterUrl
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  const normalCaption = 'Explore Notion'
  const overlongCaption =
    'Explore Notion with your entire distributed product team from every campaign surface'
  const formats = [
    {
      slug: 'a4_2x3',
      exportButtonName: 'Export A4 poster (2:3 artwork) PNG',
      exportSize: { width: 2480, height: 3508 },
    },
    {
      slug: 'rednote_3x4',
      exportButtonName: 'Export Portrait 3:4 with QR footer PNG',
      exportSize: { width: 1242, height: 1656 },
    },
    {
      slug: 'yt_thumb_16x9',
      exportButtonName: 'Export Landscape 16:9 PNG',
      exportSize: { width: 1280, height: 720 },
    },
    {
      slug: 'luma_1x1',
      exportButtonName: 'Export Square 1:1 PNG',
      exportSize: { width: 1080, height: 1080 },
    },
  ]

  for (const format of formats) {
    state.campaign.poster_format = format.slug
    state.currentGeneration.poster_format = format.slug
    setQrFooterCaption(state, normalCaption)
    await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
    await page.getByRole('heading', { name: 'Create next version' }).waitFor()
    let sheet = page.locator(
      `.canvas-stage [data-poster-size="${format.slug}"][data-qr-band="scaled"]`,
    ).first()
    await sheet.locator('[data-poster-footer]').waitFor()
    await page.evaluate(() => document.fonts.ready)
    await assertQrFooterLayout(sheet, {
      caption: normalCaption,
      expectHorizontalOverflow: false,
    })

    setQrFooterCaption(state, overlongCaption)
    await page.reload()
    await page.getByRole('heading', { name: 'Create next version' }).waitFor()
    sheet = page.locator(
      `.canvas-stage [data-poster-size="${format.slug}"][data-qr-band="scaled"]`,
    ).first()
    await sheet.locator('[data-poster-footer]').waitFor()
    await page.evaluate(() => document.fonts.ready)
    await assertQrFooterLayout(sheet, {
      caption: overlongCaption,
      expectHorizontalOverflow: true,
    })

    await page.evaluate(() => {
      window.__posterExportSvgAudits.length = 0
    })
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
    await page.getByRole('button', {
      name: format.exportButtonName,
      exact: true,
    }).click()
    const download = await downloadPromise
    const artifactPath = `${OUTPUT_DIR}/qr-footer-font-${format.slug}.png`
    await download.saveAs(artifactPath)
    const png = await readFile(artifactPath)
    assert.deepEqual(
      await probePngDimensions(page, png),
      format.exportSize,
      `${format.slug} export must retain its registered raster dimensions`,
    )

    const audits = await page.evaluate(() => window.__posterExportSvgAudits)
    const formatAudits = audits.filter((audit) => audit.posterSize === format.slug)
    const auditDetails = JSON.stringify(formatAudits)
    assert.ok(
      formatAudits.length > 0,
      `${format.slug} export did not serialize a poster foreignObject: ${auditDetails}`,
    )
    assert.equal(
      formatAudits.some((audit) => audit.hasBareRelativeFontUrl),
      false,
      `${format.slug} export retained a bare relative font URL: ${auditDetails}`,
    )
    assert.ok(
      formatAudits.some((audit) =>
        audit.hasSpaceGrotesk && audit.hasEmbeddedFontData
      ),
      `${format.slug} export did not embed Space Grotesk as a data URL: ${auditDetails}`,
    )
    assert.equal(
      formatAudits.some((audit) => audit.hasRedNoteCjk),
      false,
      `${format.slug} QR export unexpectedly embedded the RedNote CJK face: ${auditDetails}`,
    )

    await page.locator('[data-poster-export-render]').waitFor({ state: 'detached' })
  }

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
  // Bandless formats (the full-bleed twins) appear once the QR footer is off.
  await page.getByRole('switch', { name: /Add a tracked QR footer/ }).click()
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

async function testRedNoteBundledCjkFontAndExports(browserInstance) {
  const context = await browserInstance.newContext({
    acceptDownloads: true,
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  await installPosterExportSvgAudit(context)
  const state = createState({ editorReady: true })
  const edgePosterUrl = `${BASE_URL}/fixture/edge-poster.svg`
  const redNotePlan = {
    schema_version: 1,
    pages: [
      {
        kind: 'cover',
        title: '中文封面测试',
        subtitle: '今天一起看上海',
      },
      {
        kind: 'content',
        heading: '第一步',
        blocks: ['从这里开始。'],
      },
    ],
  }
  const redNoteContent = {
    headline: redNotePlan.pages[0].title,
    what_it_does: redNotePlan.pages[0].subtitle,
    how_it_works: [],
    why_use_it: [],
    features: [redNotePlan.pages[1].heading],
    cta: '',
    rednote_post: redNotePlan,
  }
  const markedLayout = {
    ...posterLayout([]),
    render_mode: 'rednote-background-v1',
  }
  for (const record of [state.campaign, state.currentGeneration]) {
    Object.assign(record, {
      use_case: 'rednote_post',
      poster_format: 'rednote_cover_3x4',
      poster_content: redNoteContent,
      poster_layout: markedLayout,
      hero_image_url: edgePosterUrl,
      hero_image_key: 'poster/rednote-cjk-background.png',
    })
  }
  state.placements = []
  await installBackendMock(context, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await page.getByRole('heading', { name: 'Create next version' }).waitFor()
  assert.equal(await page.locator('#next-poster-format option').count(), 1)
  assert.equal(
    await page.locator('#next-poster-format').inputValue(),
    'rednote_cover_3x4',
  )
  assert.equal(
    await page.getByRole('switch', { name: /Add a tracked QR footer/ }).count(),
    0,
  )
  assert.equal(
    await page.getByRole('button', { name: 'Publish', exact: true }).count(),
    0,
  )
  await page.addStyleTag({
    content:
      '[data-rednote-page-index] {'
      + 'font-family:"Posterlytics RedNote CJK","__missing_cjk__" !important;'
      + '}',
  })
  const renderedPage = page.locator(
    '.canvas-stage '
    + '[data-rednote-page-index="0"]'
    + '[data-rednote-font-status="loaded"]'
    + '[data-poster-render-status="not-applicable"]',
  )
  await renderedPage.waitFor()
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })

  const title = renderedPage.locator('[data-rednote-title]')
  const fontState = await title.evaluate((element) => {
    const family = 'Posterlytics RedNote CJK'
    const faces = Array.from(document.fonts)
      .filter((face) => face.family.replace(/["']/g, '') === family)
      .map((face) => ({ family: face.family, status: face.status }))
    return {
      check: document.fonts.check(`500 16px "${family}"`, element.textContent ?? ''),
      computedFamily: getComputedStyle(element).fontFamily,
      faces,
    }
  })
  const fontDetails = JSON.stringify(fontState)
  assert.equal(fontState.check, true, fontDetails)
  assert.match(fontState.computedFamily, /^"Posterlytics RedNote CJK"/, fontDetails)
  assert.ok(
    fontState.faces.some((face) => face.status === 'loaded'),
    fontDetails,
  )

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root } = await cdp.send('DOM.getDocument')
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '.canvas-stage [data-rednote-title]',
  })
  assert.ok(nodeId, 'RedNote title DOM node was not available to CDP.')
  const platformFonts = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
  const titleGlyphCount = Array.from(redNotePlan.pages[0].title).length
  const customGlyphCount = platformFonts.fonts
    .filter((font) => font.isCustomFont === true)
    .reduce((sum, font) => sum + font.glyphCount, 0)
  assert.equal(
    customGlyphCount,
    titleGlyphCount,
    JSON.stringify(platformFonts.fonts),
  )
  assert.equal(
    platformFonts.fonts.some((font) =>
      font.glyphCount > 0
      && font.isCustomFont === false
    ),
    false,
    JSON.stringify(platformFonts.fonts),
  )

  await page.evaluate(() => {
    window.__posterExportSvgAudits.length = 0
  })
  let downloadPromise = page.waitForEvent('download', { timeout: 90_000 })
  await page.getByRole('button', {
    name: 'Export page 1 of 2 as Portrait 3:4 full bleed PNG',
  }).click()
  let download = await downloadPromise
  let downloadPath = await download.path()
  assert.ok(downloadPath)
  assert.deepEqual(
    await probePngDimensions(page, await readFile(downloadPath)),
    { width: 1242, height: 1656 },
  )
  assertRedNoteFontAudits(
    await page.evaluate(() => window.__posterExportSvgAudits),
    1,
  )
  await page.locator('[data-poster-export-render]').waitFor({ state: 'detached' })

  await page.evaluate(() => {
    window.__posterExportSvgAudits.length = 0
  })
  downloadPromise = page.waitForEvent('download', { timeout: 180_000 })
  await page.getByRole('button', {
    name: 'Export all 2 pages as Portrait 3:4 full bleed ZIP',
  }).click()
  download = await downloadPromise
  downloadPath = await download.path()
  assert.ok(downloadPath)
  const zipEntries = execFileSync(
    '/usr/bin/unzip',
    ['-Z1', downloadPath],
    { encoding: 'utf8' },
  ).trim().split('\n')
  assert.deepEqual(zipEntries, [
    'Signal-Studio-v1-FullBleed-3x4-page-01-of-02.png',
    'Signal-Studio-v1-FullBleed-3x4-page-02-of-02.png',
  ])
  for (const filename of zipEntries) {
    const png = execFileSync(
      '/usr/bin/unzip',
      ['-p', downloadPath, filename],
      { maxBuffer: 64 * 1024 * 1024 },
    )
    assert.deepEqual(
      await probePngDimensions(page, png),
      { width: 1242, height: 1656 },
      filename,
    )
  }
  assertRedNoteFontAudits(
    await page.evaluate(() => window.__posterExportSvgAudits),
    2,
  )

  await assertNoOverflow(page)
  assert.deepEqual(pageErrors, [])
  await cdp.detach()
  await context.close()
}

async function testRedNotePostPagerAndCurrentPageExport(browserInstance) {
  const context = await browserInstance.newContext({
    acceptDownloads: true,
    locale: 'en-US',
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  await installPosterExportRunAudit(context)
  const state = createState({ editorReady: true })
  const edgePosterUrl = `${BASE_URL}/fixture/edge-poster.svg`
  const generationBPosterUrl = `${BASE_URL}/fixture/generation-b-poster.svg`
  const redNotePlan = {
    schema_version: 1,
    pages: [
      {
        kind: 'cover',
        title: 'Walk Shanghai slowly',
        subtitle: 'Three pages from one shared background',
      },
      {
        kind: 'content',
        heading: 'A quieter route',
        blocks: [
          'Start before the busiest streets fill up.',
          'Keep the river on your left and follow the morning light.',
        ],
      },
      {
        kind: 'content',
        heading: '章节'.repeat(32),
        blocks: Array.from({ length: 4 }, () => '内容'.repeat(80)),
      },
    ],
  }
  const redNoteContent = {
    headline: 'Walk Shanghai slowly',
    what_it_does: 'Three pages from one shared background',
    how_it_works: [],
    why_use_it: [],
    features: ['A quieter route'],
    cta: '',
    rednote_post: redNotePlan,
  }
  const markedLayout = {
    ...posterLayout([]),
    render_mode: 'rednote-background-v1',
  }

  Object.assign(state.campaign, {
    use_case: 'rednote_post',
    poster_format: 'rednote_cover_3x4',
    poster_content: redNoteContent,
    poster_layout: markedLayout,
    hero_image_url: edgePosterUrl,
    hero_image_key: 'poster/rednote-background.png',
  })
  Object.assign(state.currentGeneration, {
    use_case: 'rednote_post',
    poster_format: 'rednote_cover_3x4',
    poster_content: redNoteContent,
    poster_layout: markedLayout,
    hero_image_url: edgePosterUrl,
    hero_image_key: 'poster/rednote-background.png',
  })
  state.readyGenerations = [{
    ...state.currentGeneration,
    id: 'generation-legacy-rednote',
    parent_generation_id: state.currentGeneration.id,
    version_number: 2,
    instruction: 'Generation B square poster.',
    use_case: 'website_product',
    poster_format: 'luma_1x1',
    poster_content: null,
    poster_layout: posterLayout([
      {
        band: 'upper',
        role: 'headline',
        content: 'Generation B square',
      },
    ]),
    hero_image_url: generationBPosterUrl,
    hero_image_key: 'poster/generation-b-square.png',
  }]
  state.placements = []
  await installBackendMock(context, state)
  const page = await context.newPage()
  let armedHeroFetch = null
  let heldHeroFetchCount = 0
  await page.route(edgePosterUrl, async (route) => {
    const gate = armedHeroFetch
    if (route.request().resourceType() === 'fetch' && gate) {
      armedHeroFetch = null
      heldHeroFetchCount += 1
      await gate.promise
    }
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: edgePosterSvg(),
    })
  })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await page.getByRole('heading', { name: 'Create next version' }).waitFor()
  const pager = page.getByRole('group', { name: 'Page navigation' })
  await pager.waitFor()
  const previousPage = pager.getByRole('button', { name: 'Previous page' })
  const nextPage = pager.getByRole('button', { name: 'Next page' })
  assert.equal(await previousPage.isDisabled(), true)
  assert.equal(await nextPage.isEnabled(), true)
  await pager.getByText('Page 1 of 3', { exact: true }).waitFor()

  const canvas = page.locator('.canvas-stage')
  let renderedPage = canvas.locator('[data-rednote-page-index="0"]')
  await renderedPage.waitFor()
  const sharedHeroSource = await renderedPage
    .locator('[data-poster-hero]')
    .getAttribute('src')
  assert.ok(sharedHeroSource)
  assert.equal(await renderedPage.locator('[data-poster-hero]').count(), 1)
  const transcript = page.locator('.poster-transcript-copy')
  assert.deepEqual(
    await transcript.locator('p').allTextContents(),
    ['Walk Shanghai slowly', 'Three pages from one shared background'],
  )

  await nextPage.click()
  renderedPage = canvas.locator(
    '[data-rednote-page-index="1"][data-poster-render-status="not-applicable"]',
  )
  await renderedPage.waitFor()
  await pager.getByText('Page 2 of 3', { exact: true }).waitFor()
  assert.equal(
    await renderedPage.locator('[data-poster-hero]').getAttribute('src'),
    sharedHeroSource,
  )
  assert.deepEqual(
    await transcript.locator('p').allTextContents(),
    [
      'A quieter route',
      'Start before the busiest streets fill up.',
      'Keep the river on your left and follow the morning light.',
    ],
  )

  await nextPage.click()
  renderedPage = canvas.locator(
    '[data-rednote-page-index="2"][data-poster-render-status="not-applicable"]',
  )
  await renderedPage.waitFor()
  await pager.getByText('Page 3 of 3', { exact: true }).waitFor()
  assert.equal(await nextPage.isDisabled(), true)
  assert.equal(await previousPage.isEnabled(), true)
  assert.equal(
    await renderedPage.locator('[data-poster-hero]').getAttribute('src'),
    sharedHeroSource,
  )
  await waitForAnimationFrames(page, 2)
  for (const selector of ['[data-rednote-heading]', '[data-rednote-body]']) {
    const metrics = await redNoteLayoutMetrics(
      renderedPage.locator(selector),
    )
    const diagnostic = JSON.stringify(metrics, null, 2)
    console.log(`RedNote layout diagnostic for ${selector}:\n${diagnostic}`)
    assert.deepEqual(
      {
        clientHeight: metrics.clientHeight,
        clientWidth: metrics.clientWidth,
      },
      selector === '[data-rednote-heading]'
        ? { clientHeight: 216, clientWidth: 954 }
        : { clientHeight: 896, clientWidth: 954 },
      `${selector} does not use its native composition rectangle:\n${diagnostic}`,
    )
    assert.deepEqual(
      {
        clientHeight: metrics.root.clientHeight,
        clientWidth: metrics.root.clientWidth,
      },
      { clientHeight: 1656, clientWidth: 1242 },
      `RedNote root is not a native-size layout box:\n${diagnostic}`,
    )
    assert.ok(
      metrics.scrollHeight <= metrics.clientHeight,
      `${selector} overflows at ${metrics.scrollHeight}px/${metrics.clientHeight}px:\n${diagnostic}`,
    )
  }

  const versions = page.getByRole('region', { name: 'Versions' })
  await versions.locator('.version-row').filter({ hasText: 'Version 2' }).click()
  await pager.waitFor({ state: 'detached' })
  assert.equal(
    await page.getByRole('button', {
      name: 'Export Square 1:1 PNG',
    }).isEnabled(),
    false,
  )
  assert.equal(
    await page.getByRole('button', {
      name: /Export all .* pages .* ZIP/,
    }).count(),
    0,
  )
  await versions.locator('.version-row').filter({ hasText: 'Version 1' }).click()
  await page.getByRole('group', { name: 'Page navigation' }).waitFor()
  await page.getByText('Page 1 of 3', { exact: true }).waitFor()

  const resetPager = page.getByRole('group', { name: 'Page navigation' })
  await resetPager.getByRole('button', { name: 'Next page' }).click()
  await resetPager.getByText('Page 2 of 3', { exact: true }).waitFor()
  const exportButton = page.getByRole('button', {
    name: 'Export page 2 of 3 as Portrait 3:4 full bleed PNG',
  })
  const currentPageGate = deferred()
  armedHeroFetch = currentPageGate
  await page.evaluate(() => {
    window.__posterExportRunAudits = []
  })
  await exportButton.click()
  await waitFor(() => heldHeroFetchCount === 1)
  let downloadPromise = null
  try {
    await versions.locator('.version-row').filter({ hasText: 'Version 2' }).click()
    await resetPager.waitFor({ state: 'detached' })
    await versions
      .locator('.version-row[aria-pressed="true"]')
      .filter({ hasText: 'Version 2' })
      .waitFor()
    assert.equal(
      await page.locator('[data-poster-export-render]').count(),
      0,
      'the export clone mounts only after the held hero prefetch resolves',
    )
    downloadPromise = page.waitForEvent('download', { timeout: 90_000 })
  } finally {
    currentPageGate.resolve()
  }
  assert.ok(downloadPromise)
  const currentPageExport = page.locator(
    '[data-poster-export-render] '
    + '[data-poster-size="rednote_cover_3x4"]'
    + '[data-rednote-page-index="1"]'
    + '[data-poster-render-status="not-applicable"]',
  )
  await currentPageExport.waitFor()
  assert.equal(
    (
      await currentPageExport
        .locator('[data-rednote-heading]')
        .textContent()
    )?.trim(),
    'A quieter route',
  )
  const download = await downloadPromise
  const downloadPath = await download.path()
  assert.ok(downloadPath)
  assert.equal(
    download.suggestedFilename(),
    'Signal-Studio-v1-FullBleed-3x4-page-02-of-03.png',
  )
  const png = await readFile(downloadPath)
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG')
  assert.deepEqual(
    {
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
    },
    { width: 1242, height: 1656 },
  )
  const currentPageAudits = await page.evaluate(
    () => window.__posterExportRunAudits,
  )
  assert.equal(currentPageAudits.length, 1)
  assert.deepEqual(
    {
      heading: currentPageAudits[0].heading,
      pageIndex: currentPageAudits[0].pageIndex,
      posterSize: currentPageAudits[0].posterSize,
    },
    {
      heading: 'A quieter route',
      pageIndex: '1',
      posterSize: 'rednote_cover_3x4',
    },
  )
  assert.equal(
    currentPageAudits[0].text.includes('Generation B square'),
    false,
  )
  await page.locator('[data-poster-export-render]').waitFor({ state: 'detached' })

  await versions.locator('.version-row').filter({ hasText: 'Version 1' }).click()
  await resetPager.waitFor()
  await resetPager.getByText('Page 1 of 3', { exact: true }).waitFor()
  const allPagesExportButton = page.getByRole('button', {
    name: 'Export all 3 pages as Portrait 3:4 full bleed ZIP',
  })
  const allPagesGate = deferred()
  armedHeroFetch = allPagesGate
  await page.evaluate(() => {
    window.__posterExportRunAudits = []
  })
  await allPagesExportButton.click()
  await waitFor(() => heldHeroFetchCount === 2)
  let zipDownloadPromise = null
  try {
    await versions.locator('.version-row').filter({ hasText: 'Version 2' }).click()
    await resetPager.waitFor({ state: 'detached' })
    await versions
      .locator('.version-row[aria-pressed="true"]')
      .filter({ hasText: 'Version 2' })
      .waitFor()
    assert.equal(
      await page.locator('[data-poster-export-render]').count(),
      0,
      'the ZIP clone mounts only after the held hero prefetch resolves',
    )
    zipDownloadPromise = page.waitForEvent('download', { timeout: 180_000 })
  } finally {
    allPagesGate.resolve()
  }
  assert.ok(zipDownloadPromise)
  const zipDownload = await zipDownloadPromise
  const zipDownloadPath = await zipDownload.path()
  assert.ok(zipDownloadPath)
  assert.equal(
    zipDownload.suggestedFilename(),
    'Signal-Studio-v1-FullBleed-3x4-all-pages.zip',
  )
  const expectedZipEntries = [
    'Signal-Studio-v1-FullBleed-3x4-page-01-of-03.png',
    'Signal-Studio-v1-FullBleed-3x4-page-02-of-03.png',
    'Signal-Studio-v1-FullBleed-3x4-page-03-of-03.png',
  ]
  const zipEntries = execFileSync(
    '/usr/bin/unzip',
    ['-Z1', zipDownloadPath],
    { encoding: 'utf8' },
  ).trim().split('\n')
  assert.deepEqual(zipEntries, expectedZipEntries)
  for (const filename of zipEntries) {
    const pagePng = execFileSync(
      '/usr/bin/unzip',
      ['-p', zipDownloadPath, filename],
      { maxBuffer: 64 * 1024 * 1024 },
    )
    assert.equal(pagePng.subarray(1, 4).toString('ascii'), 'PNG')
    assert.deepEqual(
      {
        width: pagePng.readUInt32BE(16),
        height: pagePng.readUInt32BE(20),
      },
      { width: 1242, height: 1656 },
      filename,
    )
  }
  const zipAudits = await page.evaluate(() => window.__posterExportRunAudits)
  assert.deepEqual(
    zipAudits.map((audit) => ({
      pageIndex: audit.pageIndex,
      posterSize: audit.posterSize,
    })),
    [
      { pageIndex: '0', posterSize: 'rednote_cover_3x4' },
      { pageIndex: '1', posterSize: 'rednote_cover_3x4' },
      { pageIndex: '2', posterSize: 'rednote_cover_3x4' },
    ],
  )
  assert.equal(zipAudits[0].text.includes('Walk Shanghai slowly'), true)
  assert.equal(zipAudits[1].text.includes('A quieter route'), true)
  assert.equal(zipAudits[2].text.includes('章节'), true)
  assert.equal(
    zipAudits.some((audit) => audit.text.includes('Generation B square')),
    false,
  )
  await page.locator('[data-poster-export-render]').waitFor({ state: 'detached' })
  await versions.locator('.version-row').filter({ hasText: 'Version 1' }).click()
  await resetPager.waitFor()
  await resetPager.getByText('Page 1 of 3', { exact: true }).waitFor()
  await resetPager.getByRole('button', { name: 'Next page' }).click()
  await resetPager.getByText('Page 2 of 3', { exact: true }).waitFor()
  await canvas.locator('[data-rednote-page-index="1"]').waitFor()
  await assertNoOverflow(page)
  await page.screenshot({
    path: `${OUTPUT_DIR}/rednote-post-page-export-desktop.png`,
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

  // The asset-mode control lives only in the editor now (creation is hardcoded
  // yolo), so the tooltip behavior is exercised there.
  await desktopPage.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await desktopPage.getByRole('heading', { name: 'Create next version' }).waitFor()
  let mode = desktopPage.getByRole('group', { name: 'Asset selection mode' })
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

  await mobilePage.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await mobilePage.getByRole('heading', { name: 'Create next version' }).waitFor()
  const mobileMode = mobilePage.getByRole('group', { name: 'Asset selection mode' })
  await assertModeTooltipBehavior(
    mobilePage,
    mobileMode,
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

  await mode.getByRole('button', { name: 'Automatic' }).click()
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

// The unified creation screen has no picker: a use case is implied by the inputs.
// This drives the form to the state that resolves to each named use case, so the
// existing call sites keep reading like intent.
async function selectWizardUseCase(page, useCaseName) {
  await page.locator('.campaign-form').waitFor()
  const outputPoster = page.getByRole('radio', { name: 'Single poster' })
  const outputPost = page.getByRole('radio', { name: 'Multi-page post' })
  const primaryUrl = page.locator('#source-url')

  if (useCaseName === 'RedNote post') {
    await outputPost.click()
    return
  }
  await outputPoster.click()
  if (useCaseName === 'Social cover') {
    await primaryUrl.fill('')
    return
  }
  if (useCaseName === 'Amazon listing') {
    await primaryUrl.fill('https://www.amazon.com/dp/B0EXAMPLE')
    return
  }
  // Website product: any non-Amazon source URL.
  await primaryUrl.fill('https://yourproduct.com')
}

function referenceImageFile(name) {
  return {
    name,
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  }
}

async function fillWizardRequiredFields(
  page,
  {
    sourceUrl,
    productName,
    destinationUrl,
  },
) {
  await page.locator('#source-url').fill(sourceUrl)
  await page.locator('#product-name').fill(productName)
  if (destinationUrl !== undefined) {
    // A website_product defaults to QR on, so the destination field is present.
    await page.locator('#poster-qr-destination').fill(destinationUrl)
  }
}

async function submitWizardAndWaitForEnqueue(page, state, expectedRequestCount) {
  await page.getByRole('button', {
    name: /^(?:Generate poster|Retry generation)$/,
  }).click()
  await waitFor(() => state.enqueueRequests.length === expectedRequestCount)
}

async function assertModeTooltipBehavior(page, mode, container, action) {
  const editor = mode.getByRole('button', { name: 'Editor' })
  const yolo = mode.getByRole('button', { name: 'Automatic' })
  const editorDescriptionId = await assertModeDescription(editor, EDITOR_MODE_DESCRIPTION)
  const yoloDescriptionId = await assertModeDescription(yolo, YOLO_MODE_DESCRIPTION)
  assert.notEqual(editorDescriptionId, yoloDescriptionId)
  await assertTooltipAbsentFromAccessibleName(page, editor, EDITOR_MODE_DESCRIPTION)
  await assertTooltipAbsentFromAccessibleName(page, yolo, YOLO_MODE_DESCRIPTION)

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

// The tooltip bubble must not leak into the button's accessible NAME: Chromium
// folds generated content into name-from-content, so an always-present
// `content: attr(data-tooltip)` made "Editor" announce as "Editor Review,
// include, exclude, ..." and stop matching voice control / by-name queries.
async function assertTooltipAbsentFromAccessibleName(page, button, description) {
  const restingContent = await button.evaluate(
    (element) => getComputedStyle(element, '::after').content,
  )
  assert.equal(restingContent, 'none')
  const snapshot = await button.ariaSnapshot()
  assert.equal(snapshot.includes(description), false)
  // The visible label alone must still resolve the control by name.
  const visibleLabel = (await button.textContent()).trim()
  assert.equal(await page.getByRole('button', { name: visibleLabel, exact: true }).count() >= 1, true)
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

function assertOperationOrder(state, expectedTypes) {
  let previousIndex = -1
  for (const type of expectedTypes) {
    const index = state.operationLog.findIndex(
      (entry, candidateIndex) =>
        candidateIndex > previousIndex && entry.type === type,
    )
    assert.ok(
      index > previousIndex,
      `Missing ordered operation ${type}: ${JSON.stringify(state.operationLog)}`,
    )
    previousIndex = index
  }
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

  await context.route('**/amazon-product-lookup', async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: capturePreviewCorsHeaders(),
      })
      return
    }

    const body = request.postData()
      ? JSON.parse(request.postData())
      : {}
    state.amazonProductLookupRequests.push({
      authorization: request.headers().authorization ?? null,
      body,
    })
    state.operationLog.push({ type: 'amazon-product-lookup' })
    const queued = state.amazonProductLookupResponses.shift() ?? {
      body: { status: 'unavailable' },
    }
    if (queued.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, queued.delayMs))
    }
    await capturePreviewJson(route, queued.body, queued.status ?? 200)
  })

  await context.route('**/capture-preview', async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: capturePreviewCorsHeaders(),
      })
      return
    }

    const body = request.postData()
      ? JSON.parse(request.postData())
      : {}
    state.capturePreviewRequests.push({
      authorization: request.headers().authorization ?? null,
      body,
    })
    state.operationLog.push({ type: 'capture-preview' })
    const queued = state.capturePreviewResponses.shift() ?? {
      body: capturePreviewFixture(
        body.url ?? 'https://example.com',
        `request-${state.capturePreviewRequests.length}`,
        {
          colorScheme: body.color_scheme === 'dark' ? 'dark' : 'light',
        },
      ),
    }
    if (queued.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, queued.delayMs))
    }
    await capturePreviewJson(route, queued.body, queued.status ?? 200)
  })

  await context.route('**/api/**', async (route) => {
    const request = route.request()
    const requestUrl = new URL(request.url())
    const path = requestUrl.pathname
    const postData = request.postData()
    const body = postData
      && request.headers()['content-type']?.includes('application/json')
      ? JSON.parse(postData)
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
      state.operationLog.push({ type: 'enqueue' })
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
    if (path === '/api/storage/buckets/assets/upload-strategy') {
      state.storageUploadStrategies.push(body)
      state.operationLog.push({ type: 'storage-upload-strategy' })
      if (state.storageUploadFailuresRemaining > 0) {
        state.storageUploadFailuresRemaining -= 1
        return json(route, {
          error: 'STORAGE_ERROR',
          message: 'Mock storage upload failed.',
          statusCode: 500,
        }, 500)
      }
      return json(route, { method: 'direct' })
    }
    const storageObjectPrefix = '/api/storage/buckets/assets/objects/'
    if (path.startsWith(storageObjectPrefix)) {
      const key = decodeURIComponent(path.slice(storageObjectPrefix.length))
      if (request.method() === 'DELETE') {
        state.storageRemovals.push(key)
        state.operationLog.push({ type: 'storage-remove', key })
        return json(route, { key })
      }
      if (request.method() === 'PUT') {
        state.storageUploads.push({ key })
        state.operationLog.push({ type: 'storage-upload', key })
        return json(route, {
          key,
          url: `${BASE_URL}${storageObjectPrefix}${encodeURIComponent(key)}`,
        })
      }
    }
    if (path === '/api/database/records/campaigns') {
      const method = request.method()
      if (method === 'POST') {
        state.campaignWrites.push({ method, body })
        state.operationLog.push({ type: 'campaign-create' })
        Object.assign(state.campaign, body[0])
        return json(route, { id: state.campaign.id })
      }
      if (method === 'PATCH') {
        state.campaignWrites.push({ method, body })
        if (
          Object.hasOwn(body, 'poster_format')
          && Object.hasOwn(body, 'destination_url')
        ) {
          state.operationLog.push({ type: 'campaign-qr-update' })
        }
        if (Object.hasOwn(body, 'eager_capture_url')) {
          state.operationLog.push({
            type: body.eager_capture_url
              ? 'campaign-eager-update'
              : 'campaign-eager-clear',
          })
          if (state.eagerCampaignUpdateFailuresRemaining > 0) {
            state.eagerCampaignUpdateFailuresRemaining -= 1
            return json(route, {
              error: 'DATABASE_ERROR',
              message: 'Mock eager campaign update failed.',
              statusCode: 500,
            }, 500)
          }
        }
        Object.assign(state.campaign, body)
        return json(route, [])
      }
      if (method === 'DELETE') {
        state.campaignWrites.push({ method, body })
        state.operationLog.push({ type: 'campaign-delete' })
        state.campaignDeleted = true
        return json(route, [])
      }
      state.operationLog.push({ type: 'campaign-read' })
      const campaignReadGate = state.campaignReadGate
      if (campaignReadGate) await campaignReadGate
      return json(route, [state.campaign])
    }
    if (path === '/api/database/records/poster_generations') {
      state.operationLog.push({ type: 'generation-read' })
      const generationReadGate = state.generationReadGate
      if (generationReadGate) await generationReadGate
      return json(route, state.editorReady
        ? [
            state.currentGeneration,
            ...state.readyGenerations,
            ...state.failedGenerations,
          ]
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
      if (request.method() === 'POST') {
        state.placementWrites.push(body)
        state.operationLog.push({ type: 'placement-create' })
        if (state.placementCreateFailuresRemaining > 0) {
          state.placementCreateFailuresRemaining -= 1
          return json(route, {
            error: 'DATABASE_ERROR',
            message: 'Mock placement creation failed.',
            statusCode: 500,
          }, 500)
        }
        const values = body[0]
        const placement = {
          id: `placement-${state.placementWrites.length}`,
          created_at: state.now,
          ...values,
        }
        state.placements.push(placement)
        return json(route, [placement])
      }
      state.operationLog.push({
        type: requestUrl.searchParams.get('select') === 'id'
          ? 'placement-lookup'
          : 'placement-refresh',
      })
      return json(route, state.placements)
    }
    return json(route, [])
  })
}

function posterLayout(zones) {
  return {
    composition: 'editorial',
    mood: 'direct',
    art_style: 'print',
    palette_roles: {
      bg: '#ffffff',
      text: '#111111',
      primary: '#3156d3',
      accent: '#10b981',
    },
    zones,
  }
}

function createState({
  selectedIds = ['asset-a', 'asset-b'],
  awaitingReviewActivity = false,
  editorReady = false,
  eagerCampaignUpdateFailuresRemaining = 0,
  enqueueFailuresRemaining = 0,
  placementCreateFailuresRemaining = 0,
  saveFailuresRemaining = 0,
  storageUploadFailuresRemaining = 0,
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
    campaignReadGate: null,
    generationReadGate: null,
    saveAttempts: [],
    saveFailuresRemaining,
    savedSelections: [],
    confirmedSelections: [],
    cancelCalls: 0,
    campaignWrites: [],
    campaignDeleted: false,
    amazonProductLookupRequests: [],
    amazonProductLookupResponses: [],
    capturePreviewRequests: [],
    capturePreviewResponses: [],
    eagerCampaignUpdateFailuresRemaining,
    enqueueFailuresRemaining,
    enqueueModes: [],
    enqueueRequests: [],
    readyGenerations: [],
    failedGenerations: [],
    operationLog: [],
    placementCreateFailuresRemaining,
    placementWrites: [],
    storageRemovals: [],
    storageUploads: [],
    storageUploadFailuresRemaining,
    storageUploadStrategies: [],
    traceRequests: [],
    traces: [],
  }
  applySelection(state, selectedIds)
  return state
}

function configureSocialCoverState(state, { qrEnabled }) {
  const reference = {
    key: 'references/user-asset/social.png',
    url: `${BASE_URL}/fixture/poster.svg`,
    name: 'social.png',
    mime_type: 'image/png',
    size_bytes: 120,
  }
  const posterFormat = qrEnabled ? 'rednote_3x4' : 'rednote_cover_3x4'
  Object.assign(state.campaign, {
    product_url: null,
    destination_url: qrEnabled ? 'https://example.com/social' : null,
    use_case: 'social_cover',
    platform_hint: 'Instagram',
    poster_format: posterFormat,
    reference_images: [reference],
  })
  Object.assign(state.currentGeneration, {
    use_case: 'social_cover',
    platform_hint: 'Instagram',
    poster_format: posterFormat,
    reference_images: [reference],
  })
  state.placements = []
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

async function waitForHeroComplete(hero) {
  await hero.waitFor()
  await hero.evaluate(async (image) => {
    if (!(image instanceof HTMLImageElement)) {
      throw new Error('Poster hero is not an image.')
    }
    await image.decode()
    if (!image.complete || image.naturalWidth === 0) {
      throw new Error('Poster hero did not complete successfully.')
    }
  })
}

async function retainPosterHeroAndArmLoadCounter(hero) {
  await hero.evaluate((image) => {
    window.__retainedPosterHero = image
    window.__posterHeroLoadCount = 0
    document.addEventListener('load', (event) => {
      if (
        event.target instanceof HTMLImageElement
        && event.target.matches('.canvas-stage [data-poster-hero]')
      ) {
        window.__posterHeroLoadCount += 1
      }
    }, true)
  })
}

async function isRetainedPosterHero(hero) {
  return hero.evaluate((image) => image === window.__retainedPosterHero)
}

async function posterHeroLoadCount(page) {
  return page.evaluate(() => window.__posterHeroLoadCount)
}

function operationCount(state, type) {
  return state.operationLog.filter((entry) => entry.type === type).length
}

async function installPosterExportSvgAudit(context) {
  await context.addInitScript(() => {
    window.__posterExportSvgAudits = []
    const serializeToString = XMLSerializer.prototype.serializeToString
    XMLSerializer.prototype.serializeToString = function (node) {
      const serialized = serializeToString.call(this, node)
      try {
        if (!(node instanceof SVGElement)) return serialized
        const foreignObject = node.querySelector('foreignObject')
        const poster = foreignObject?.querySelector('[data-poster-size]')
        if (!poster) return serialized

        const fontStyles = Array.from(poster.querySelectorAll('style'))
          .map((style) => style.textContent ?? '')
          .filter((css) => css.includes('@font-face'))
        const fontStyle = fontStyles.find((css) => css.includes('Space Grotesk'))
        const redNoteFontStyle = fontStyles.find((css) =>
          css.includes('Posterlytics RedNote CJK')
        )
        const fontUrlIndex = fontStyle?.indexOf('url(') ?? -1
        window.__posterExportSvgAudits.push({
          posterSize: poster.getAttribute('data-poster-size'),
          hasSpaceGrotesk: !!fontStyle,
          hasEmbeddedFontData: !!fontStyle
            && /url\(\s*["']?data:/i.test(fontStyle),
          hasBareRelativeFontUrl: !!fontStyle
            && /url\(\s*["']?\.\.?\//i.test(fontStyle),
          fontSource: fontStyle && fontUrlIndex >= 0
            ? fontStyle.slice(fontUrlIndex, fontUrlIndex + 160)
            : null,
          hasRedNoteCjk: !!redNoteFontStyle,
          redNoteFontCssLength: redNoteFontStyle?.length ?? 0,
          redNoteHasEmbeddedFontData: !!redNoteFontStyle
            && /url\(\s*["']?data:font\/woff2;base64,/i.test(redNoteFontStyle),
          redNoteHasBareFontUrl: !!redNoteFontStyle
            && /url\(\s*["']?(?!data:)[^)]*\.woff2/i.test(redNoteFontStyle),
        })
      } catch (error) {
        window.__posterExportSvgAudits.push({
          posterSize: null,
          auditError: error instanceof Error ? error.message : String(error),
        })
      }
      return serialized
    }
  })
}

function assertRedNoteFontAudits(audits, expectedCount) {
  const redNoteAudits = audits.filter((audit) =>
    audit.posterSize === 'rednote_cover_3x4'
  )
  const details = JSON.stringify(redNoteAudits)
  assert.equal(redNoteAudits.length, expectedCount, details)
  for (const audit of redNoteAudits) {
    assert.equal(audit.hasRedNoteCjk, true, details)
    assert.equal(audit.redNoteHasEmbeddedFontData, true, details)
    assert.equal(audit.redNoteHasBareFontUrl, false, details)
    assert.equal(audit.hasSpaceGrotesk, false, details)
    assert.ok(audit.redNoteFontCssLength > 0, details)
    assert.ok(
      audit.redNoteFontCssLength <= REDNOTE_FONT_EMBED_CSS_MAX_CHARS,
      details,
    )
  }
}

async function installPosterExportRunAudit(context) {
  await context.addInitScript(() => {
    window.__posterExportRunAudits = []
    const serializeToString = XMLSerializer.prototype.serializeToString
    XMLSerializer.prototype.serializeToString = function (node) {
      const serialized = serializeToString.call(this, node)
      if (!(node instanceof SVGElement)) return serialized
      const poster = node
        .querySelector('foreignObject')
        ?.querySelector('[data-poster-size]')
      if (!poster) return serialized
      window.__posterExportRunAudits.push({
        heading: poster
          .querySelector('[data-rednote-heading]')
          ?.textContent
          ?.trim() ?? null,
        pageIndex: poster.getAttribute('data-rednote-page-index'),
        posterSize: poster.getAttribute('data-poster-size'),
        text: poster.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      })
      return serialized
    }
  })
}

function setQrFooterCaption(state, caption) {
  state.campaign.poster_spec = { qr_label: caption }
  state.currentGeneration.poster_spec = { qr_label: caption }
}

async function assertQrFooterLayout(
  sheet,
  { caption, expectHorizontalOverflow },
) {
  const metrics = await sheet.evaluate((poster, expectedCaption) => {
    const footer = poster.querySelector('[data-poster-footer]')
    const primary = poster.querySelector('[data-poster-footer-primary]')
    const secondary = poster.querySelector('[data-poster-footer-secondary]')
    if (
      !(footer instanceof HTMLElement)
      || !(primary instanceof HTMLElement)
      || !(secondary instanceof HTMLElement)
      || !(primary.parentElement instanceof HTMLElement)
    ) {
      throw new Error('QR footer text elements are missing.')
    }

    const rectOf = (rect) => ({
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
    })
    const footerRect = footer.getBoundingClientRect()
    const primaryRect = primary.getBoundingClientRect()
    const secondaryRect = secondary.getBoundingClientRect()
    const primaryStyle = getComputedStyle(primary)
    const copyStyle = getComputedStyle(primary.parentElement)
    const textRange = document.createRange()
    textRange.selectNodeContents(primary)
    const lineTops = []
    for (const rect of textRange.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0) continue
      if (!lineTops.some((top) => Math.abs(top - rect.top) < 1)) {
        lineTops.push(rect.top)
      }
    }

    return {
      caption: primary.textContent?.trim() ?? '',
      copy: {
        flexGrow: copyStyle.flexGrow,
        minWidth: copyStyle.minWidth,
      },
      fontReady: document.fonts?.check('700 16px "Space Grotesk"') ?? true,
      footer: rectOf(footerRect),
      intersects: (
        primaryRect.left < secondaryRect.right
        && primaryRect.right > secondaryRect.left
        && primaryRect.top < secondaryRect.bottom
        && primaryRect.bottom > secondaryRect.top
      ),
      lineCount: lineTops.length,
      primary: {
        ...rectOf(primaryRect),
        clientHeight: primary.clientHeight,
        clientWidth: primary.clientWidth,
        display: primaryStyle.display,
        fontFamily: primaryStyle.fontFamily,
        lineHeight: Number.parseFloat(primaryStyle.lineHeight),
        overflowX: primaryStyle.overflowX,
        scrollWidth: primary.scrollWidth,
        textOverflow: primaryStyle.textOverflow,
        whiteSpace: primaryStyle.whiteSpace,
      },
      secondary: rectOf(secondaryRect),
      expectedCaption,
    }
  }, caption)
  const details = JSON.stringify(metrics)

  assert.equal(metrics.caption, caption, details)
  assert.equal(metrics.expectedCaption, caption, details)
  assert.equal(metrics.fontReady, true, details)
  assert.match(metrics.primary.fontFamily, /Space Grotesk/, details)
  assert.equal(metrics.copy.flexGrow, '1', details)
  assert.equal(metrics.copy.minWidth, '0px', details)
  assert.equal(metrics.primary.display, 'block', details)
  assert.equal(metrics.primary.whiteSpace, 'nowrap', details)
  assert.equal(metrics.primary.overflowX, 'hidden', details)
  assert.equal(metrics.primary.textOverflow, 'ellipsis', details)
  assert.equal(metrics.lineCount, 1, details)
  assert.ok(
    Math.abs(metrics.primary.clientHeight - metrics.primary.lineHeight) <= 1,
    details,
  )
  if (expectHorizontalOverflow) {
    assert.ok(metrics.primary.scrollWidth > metrics.primary.clientWidth + 1, details)
  } else {
    assert.ok(metrics.primary.scrollWidth <= metrics.primary.clientWidth + 1, details)
  }
  assert.equal(metrics.intersects, false, details)
  assert.ok(metrics.primary.top >= metrics.footer.top - 1, details)
  assert.ok(metrics.primary.bottom <= metrics.footer.bottom + 1, details)
  assert.ok(metrics.secondary.top >= metrics.footer.top - 1, details)
  assert.ok(metrics.secondary.bottom <= metrics.footer.bottom + 1, details)
}

async function waitForAnimationFrames(page, count) {
  await page.evaluate(async (frameCount) => {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
  }, count)
}

async function readCampaignWizardReflowGeometry(page) {
  return page.evaluate(() => {
    // The unified screen has no use-case label or asset-mode control; the
    // low-vision reflow guarantee now covers the summary rows and inputs.
    const summary = document.querySelector('.campaign-summary')
    if (!(summary instanceof HTMLElement)) {
      throw new Error('Campaign summary is missing.')
    }

    const tolerance = 1
    const rectOf = (rect) => ({
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
    })
    const within = (rect, container) =>
      rect.left >= container.left - tolerance
      && rect.right <= container.right + tolerance
      && rect.top >= container.top - tolerance
      && rect.bottom <= container.bottom + tolerance
    const intersects = (first, second) =>
      first.left < second.right - tolerance
      && first.right > second.left + tolerance
      && first.top < second.bottom - tolerance
      && first.bottom > second.top + tolerance
    const sharesLine = (firstRects, secondRects) =>
      firstRects.some((first) =>
        secondRects.some((second) =>
          first.top < second.bottom - tolerance
          && first.bottom > second.top + tolerance))
    const textRectsOf = (element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      return [...range.getClientRects()]
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map(rectOf)
    }
    const textNodeRectsOf = (element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      const rects = []
      let node = walker.nextNode()
      while (node) {
        if (node.textContent?.trim()) {
          const range = document.createRange()
          range.selectNodeContents(node)
          rects.push(
            ...[...range.getClientRects()]
              .filter((rect) => rect.width > 0 && rect.height > 0)
              .map(rectOf),
          )
        }
        node = walker.nextNode()
      }
      return rects
    }

    const summaryElements = [...summary.querySelectorAll('dl > div')]
    const summaryRows = summaryElements.map((row, index) => {
      const term = row.querySelector('dt')
      const value = row.querySelector('dd')
      if (!(row instanceof HTMLElement)
        || !(term instanceof HTMLElement)
        || !(value instanceof HTMLElement)) {
        throw new Error('Campaign summary definition row is incomplete.')
      }

      const rowRect = rectOf(row.getBoundingClientRect())
      const termRect = rectOf(term.getBoundingClientRect())
      const valueRect = rectOf(value.getBoundingClientRect())
      const termTextRects = textRectsOf(term)
      const valueTextRects = textRectsOf(value)
      const nextRow = summaryElements[index + 1]
      const nextRowRect = nextRow instanceof HTMLElement
        ? rectOf(nextRow.getBoundingClientRect())
        : null

      return {
        doesNotIntersectNext: !nextRowRect || !intersects(rowRect, nextRowRect),
        rowClientWidth: row.clientWidth,
        rowScrollWidth: row.scrollWidth,
        term: term.textContent?.trim() ?? '',
        termClientWidth: term.clientWidth,
        termScrollWidth: term.scrollWidth,
        termTextRects,
        termTextWithinElementAndRow: termTextRects.every(
          (rect) => within(rect, termRect) && within(rect, rowRect),
        ),
        termValueShareLine: sharesLine(termTextRects, valueTextRects),
        termValueTextIntersects: termTextRects.some((termTextRect) =>
          valueTextRects.some((valueTextRect) => intersects(termTextRect, valueTextRect))),
        value: value.textContent?.trim() ?? '',
        valueBelowTerm: (
          termTextRects.length > 0
          && valueTextRects.length > 0
          && Math.min(...valueTextRects.map((rect) => rect.top))
            >= Math.max(...termTextRects.map((rect) => rect.bottom)) - tolerance
        ),
        valueClientWidth: value.clientWidth,
        valueScrollWidth: value.scrollWidth,
        valueTextRects,
        valueTextWithinElementAndRow: valueTextRects.every(
          (rect) => within(rect, valueRect) && within(rect, rowRect),
        ),
      }
    })

    const inputReports = [...document.querySelectorAll('.campaign-form input.input')]
      .flatMap((input) => {
        if (!(input instanceof HTMLInputElement)) return []
        const rect = input.getBoundingClientRect()
        const style = getComputedStyle(input)
        if (style.display === 'none' || style.visibility === 'hidden' || rect.height <= 0) {
          return []
        }
        const lineHeight = Number.parseFloat(style.lineHeight)
        const requiredHeight = lineHeight
          + Number.parseFloat(style.paddingTop)
          + Number.parseFloat(style.paddingBottom)
          + Number.parseFloat(style.borderTopWidth)
          + Number.parseFloat(style.borderBottomWidth)
        return [{
          height: rect.height,
          id: input.id,
          requiredHeight,
        }]
      })

    // The output-kind segmented control replaces the removed asset-mode control
    // as the reflow-critical multi-button row.
    const outputGroup = document.querySelector(
      '.campaign-form .output-kind-control .segmented-control',
    )
    const outputButtons = outputGroup instanceof HTMLElement
      ? [...outputGroup.querySelectorAll('button')].flatMap((button) => {
        if (!(button instanceof HTMLButtonElement)) return []
        const buttonRect = rectOf(button.getBoundingClientRect())
        const textRects = textNodeRectsOf(button)
        return [{
          clientWidth: button.clientWidth,
          rect: buttonRect,
          scrollWidth: button.scrollWidth,
          textWithinButton: textRects.every((rect) => within(rect, buttonRect)),
        }]
      })
      : []

    return {
      outputButtons,
      outputButtonsIntersect: outputButtons.some((button, index) =>
        outputButtons.slice(index + 1).some((other) => intersects(button.rect, other.rect))),
      inputReports,
      summaryRows,
    }
  })
}

async function doubleComputedTextMetrics(page, selector) {
  await page.locator(selector).evaluateAll((elements) => {
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue
      const style = getComputedStyle(element)
      const fontSize = Number.parseFloat(style.fontSize)
      const computedLineHeight = Number.parseFloat(style.lineHeight)
      const lineHeight = Number.isFinite(computedLineHeight)
        ? computedLineHeight
        : fontSize * 1.2
      element.style.setProperty('font-size', `${fontSize * 2}px`, 'important')
      element.style.setProperty('line-height', `${lineHeight * 2}px`, 'important')
    }
  })
  await waitForAnimationFrames(page, 2)
}

async function redNoteLayoutMetrics(locator) {
  return locator.evaluate((element) => {
    const rectOf = (rect) => ({
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.width,
      x: rect.x,
      y: rect.y,
    })
    const styleOf = (node) => {
      const style = getComputedStyle(node)
      return {
        alignItems: style.alignItems,
        boxSizing: style.boxSizing,
        display: style.display,
        flex: style.flex,
        flexBasis: style.flexBasis,
        flexGrow: style.flexGrow,
        flexShrink: style.flexShrink,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        gridTemplateColumns: style.gridTemplateColumns,
        height: style.height,
        justifyContent: style.justifyContent,
        lineHeight: style.lineHeight,
        maxHeight: style.maxHeight,
        maxWidth: style.maxWidth,
        minHeight: style.minHeight,
        minWidth: style.minWidth,
        overflow: style.overflow,
        overflowWrap: style.overflowWrap,
        placeItems: style.placeItems,
        position: style.position,
        transform: style.transform,
        transformOrigin: style.transformOrigin,
        whiteSpace: style.whiteSpace,
        width: style.width,
      }
    }
    const dimensionsOf = (node) => ({
      clientHeight: node.clientHeight,
      clientWidth: node.clientWidth,
      offsetHeight: node.offsetHeight,
      offsetWidth: node.offsetWidth,
      rect: rectOf(node.getBoundingClientRect()),
      scrollHeight: node.scrollHeight,
      scrollWidth: node.scrollWidth,
      style: styleOf(node),
    })
    const labelOf = (node) => {
      if (node.hasAttribute('data-rednote-heading')) return '[data-rednote-heading]'
      if (node.hasAttribute('data-rednote-body')) return '[data-rednote-body]'
      if (node.hasAttribute('data-rednote-page-index')) {
        return `[data-rednote-page-index="${node.getAttribute('data-rednote-page-index')}"]`
      }
      if (node.classList.contains('canvas-stage')) return '.canvas-stage'
      const classes = Array.from(node.classList).slice(0, 2).join('.')
      return `${node.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`
    }
    const textRange = document.createRange()
    textRange.selectNodeContents(element)
    const root = element.closest('[data-rednote-page-index]')
    if (!root) throw new Error('RedNote text is missing its native poster root.')

    const ancestors = []
    let current = element
    while (current) {
      ancestors.push({
        label: labelOf(current),
        ...dimensionsOf(current),
      })
      if (current.classList.contains('canvas-stage')) break
      current = current.parentElement
    }

    return {
      ...dimensionsOf(element),
      ancestors,
      lineFragments: Array.from(textRange.getClientRects(), rectOf),
      root: dimensionsOf(root),
      rootScale: root.clientWidth > 0
        ? root.getBoundingClientRect().width / root.clientWidth
        : null,
    }
  })
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

async function probePngDimensions(page, png) {
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  return page.evaluate(async (src) => {
    const image = new Image()
    image.src = src
    await image.decode()
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
    }
  }, dataUrl)
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

function capturePreviewFixture(
  sourceUrl,
  marker,
  {
    colorScheme = 'light',
    includeMissingImage = false,
    productCount = 1,
  } = {},
) {
  return {
    preview: {
      sourceUrl,
      captureId: '10000000-0000-4000-8000-000000000001',
      capturedAt: new Date().toISOString(),
      colorScheme,
      designTokens: capturePreviewDesignTokens(),
      styleBoardDataUrl: EAGER_STYLE_BOARD_DATA_URL,
      logoUrl: `${BASE_URL}/fixture/logo-${marker}.svg`,
      imageUrls: [
        ...Array.from(
          { length: productCount },
          (_, index) => index === 0
            ? `${BASE_URL}/fixture/product-${marker}.svg`
            : `${BASE_URL}/fixture/product-${marker}-${index + 1}.svg`,
        ),
        ...(includeMissingImage
          ? [`${BASE_URL}/fixture/missing-poster.svg`]
          : []),
      ],
      colors: ['#174a58', '#e05b3f', '#b9dfce'],
      fonts: ['Space Grotesk', 'Archivo'],
    },
    error: null,
  }
}

function emptyCapturePreview(sourceUrl) {
  return {
    sourceUrl,
    captureId: null,
    capturedAt: null,
    colorScheme: 'light',
    designTokens: null,
    styleBoardDataUrl: null,
    logoUrl: null,
    imageUrls: [],
    colors: [],
    fonts: [],
  }
}

function capturePreviewDesignTokens() {
  return {
    typography: {
      headingFamily: 'Space Grotesk',
      bodyFamily: 'Archivo',
      scale: [16, 24, 48],
      weights: [400, 700],
    },
    colors: {
      bg: '#f2f3f0',
      text: '#17222b',
      primary: '#174a58',
      accent: '#e05b3f',
      palette: ['#174a58', '#e05b3f', '#b9dfce'],
      theme: 'light',
    },
    radii: [4, 8],
    shadows: [],
    spacing: [8, 16, 24],
    button: null,
    fontLinks: [],
  }
}

function capturePreviewCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

async function capturePreviewJson(route, body, status = 200) {
  try {
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: capturePreviewCorsHeaders(),
      body: JSON.stringify(body),
    })
  } catch (error) {
    if (!/closed|disposed|already handled/i.test(String(error))) throw error
  }
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
    if (server.exitCode !== null) {
      throw new Error(
        `Vite server exited with code ${server.exitCode} before startup.\n${serverOutput}`,
      )
    }
    if (serverOutput.includes(BASE_URL)) {
      try {
        const response = await fetch(BASE_URL)
        if (response.ok) return
      } catch {
        // This Vite process reported ready, but its socket is not accepting yet.
      }
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

function deferred() {
  let resolvePromise = () => {}
  const promise = new Promise((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: resolvePromise,
  }
}

async function waitForFocused(page, target) {
  if (typeof target === 'string') {
    await page.waitForFunction(
      (selector) => document.activeElement === document.querySelector(selector),
      target,
    )
    return
  }

  const handle = await target.elementHandle()
  assert.ok(handle)
  try {
    await page.waitForFunction(
      (element) => document.activeElement === element,
      handle,
    )
  } finally {
    await handle.dispose()
  }
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

async function testNativeOnlyFieldInvalidState(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  const state = createState()
  await installBackendMock(context, state)
  const page = await context.newPage()
  await openWizardForm(page, 'Website product')

  // The QR destination is the one natively-required field on the unified screen
  // (it appears when the QR footer is on, which is the tracked-poster default).
  const destination = page.locator('#poster-qr-destination')
  await destination.waitFor()
  assert.equal(await destination.getAttribute('required'), '')
  assert.equal(await destination.getAttribute('aria-required'), 'true')
  assert.equal(await destination.getAttribute('pattern'), 'https?://.+')

  // An invalid value blocks submission via native validation, and focus lands on
  // the offending control.
  await destination.fill('not-a-url')
  await page.getByRole('button', { name: 'Generate poster', exact: true }).click()
  await waitForFocused(page, destination)
  assert.deepEqual(state.campaignWrites, [])

  console.log('  OK native-only required destination blocks submit and focuses')
  await context.close()
}
