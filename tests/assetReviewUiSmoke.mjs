import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
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
  await testHistoricalAssetAudit(browser)
  await testCampaignWizardPreference(browser)
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
    viewport: { width: 1280, height: 840 },
    reducedMotion: 'reduce',
  })
  const state = createState({ awaitingReviewActivity: true })
  await installBackendMock(context, state)
  const page = await context.newPage()

  await page.goto(`${BASE_URL}/campaigns/campaign-asset`)
  await page.getByRole('link', { name: 'Review assets' }).waitFor()
  await page.getByRole('button', { name: /Generation activity/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Generation activity' })
  await dialog.getByText('Assets ready for review', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Review assets' }).click()
  await page.waitForURL(reviewUrl())
  await page.getByText('2/6', { exact: true }).waitFor()
  await context.close()
}

async function testHistoricalAssetAudit(browserInstance) {
  const context = await browserInstance.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  const state = createState({ editorReady: true })
  state.currentGeneration = {
    ...state.currentGeneration,
    trace_schema_version: 2,
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
  await dialog.getByRole('tab', { name: 'Assets' }).click()
  await dialog.getByRole('heading', { name: 'Selection audit' }).waitFor()

  assert.match(await dialog.locator('.asset-audit-summary').innerText(), /Yolo[\s\S]*Rules fallback[\s\S]*2[\s\S]*Rules fallback/)
  assert.deepEqual(
    await dialog.locator('.asset-audit-decision').allTextContents(),
    ['Included · 1', 'Included · 2', 'Excluded', 'Excluded'],
  )
  await dialog.getByText('Hero could not fetch the frozen style board.').waitFor()
  await assertNoOverflow(page)
  await page.screenshot({ path: `${OUTPUT_DIR}/historical-audit-desktop.png`, fullPage: true })
  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testCampaignWizardPreference(browserInstance) {
  const context = await browserInstance.newContext({
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  const state = createState()
  await installBackendMock(context, state)
  const page = await context.newPage()

  await page.goto(`${BASE_URL}/campaigns/new`)
  await page.getByRole('heading', { name: 'Create campaign' }).waitFor()
  let mode = page.getByRole('group', { name: 'Asset selection mode' })
  assert.equal(await mode.getByRole('button', { name: 'Editor' }).getAttribute('aria-pressed'), 'true')

  await mode.getByRole('button', { name: 'Yolo' }).click()
  await page.reload()
  mode = page.getByRole('group', { name: 'Asset selection mode' })
  assert.equal(await mode.getByRole('button', { name: 'Yolo' }).getAttribute('aria-pressed'), 'true')
  await context.close()
}

async function testAssetModeTooltips(browserInstance) {
  const desktopContext = await browserInstance.newContext({
    viewport: { width: 1360, height: 900 },
    reducedMotion: 'reduce',
  })
  const desktopState = createState({ editorReady: true })
  await installBackendMock(desktopContext, desktopState)
  const desktopPage = await desktopContext.newPage()
  const desktopErrors = []
  desktopPage.on('pageerror', (error) => desktopErrors.push(error))

  await desktopPage.goto(`${BASE_URL}/campaigns/new`)
  await desktopPage.getByRole('heading', { name: 'Create campaign' }).waitFor()
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
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  const mobileState = createState({ editorReady: true })
  await installBackendMock(mobileContext, mobileState)
  const mobilePage = await mobileContext.newPage()
  const mobileErrors = []
  mobilePage.on('pageerror', (error) => mobileErrors.push(error))

  await mobilePage.goto(`${BASE_URL}/campaigns/new`)
  await mobilePage.getByRole('heading', { name: 'Create campaign' }).waitFor()
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
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: posterSvg(),
    })
  })

  await context.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
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
      return json(route, [state.campaign])
    }
    if (path === '/api/database/records/poster_generations') {
      return json(route, state.editorReady
        ? [state.currentGeneration]
        : [state.reviewGeneration])
    }
    if (path === '/api/database/records/generation_assets') {
      return json(route, state.assets)
    }
    if (path === '/api/database/records/generation_stage_traces') {
      return json(route, state.traces)
    }
    if (path === '/api/database/records/placements') {
      return json(route, [state.placement])
    }
    return json(route, [])
  })
}

function createState({
  selectedIds = ['asset-a', 'asset-b'],
  awaitingReviewActivity = false,
  editorReady = false,
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
    event_details: null,
    current_generation_id: 'generation-current',
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
    scenario: 'product',
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
  const state = {
    now,
    user,
    campaign,
    reviewGeneration,
    currentGeneration,
    placement: {
      id: 'placement-1',
      campaign_id: campaign.id,
      user_id: user.id,
      label: 'Primary',
      code: 'asset001',
      created_at: now,
    },
    assets,
    awaitingReviewActivity,
    editorReady,
    saveAttempts: [],
    saveFailuresRemaining,
    savedSelections: [],
    confirmedSelections: [],
    cancelCalls: 0,
    enqueueModes: [],
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
    failure_metadata: stage === 'assets'
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

async function assertNoOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  assert.ok(dimensions.scrollWidth <= dimensions.clientWidth + 1)
}
