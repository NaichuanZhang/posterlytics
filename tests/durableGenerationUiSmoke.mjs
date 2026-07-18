import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import process from 'node:process'
import { chromium } from 'playwright'

const HOST = '127.0.0.1'
const PORT = 4173
const BASE_URL = `http://${HOST}:${PORT}`
const OUTPUT_DIR = 'test-results/durable-generation'

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
      VITE_INSFORGE_ANON_KEY: 'ui-smoke-anon-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)

let serverOutput = ''
server.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString()
})
server.stderr.on('data', (chunk) => {
  serverOutput += chunk.toString()
})

let browser
try {
  await waitForServer()
  browser = await chromium.launch({ headless: true })
  await testDesktop(browser)
  await testMobile(browser)
  console.log(`durable generation UI smoke passed; screenshots: ${OUTPUT_DIR}`)
} finally {
  await browser?.close()
  server.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ])
}

async function testDesktop(browserInstance) {
  const context = await browserInstance.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await installBackendMock(context)

  await page.goto(`${BASE_URL}/campaigns/campaign-active`)
  await page.getByRole('heading', { name: 'Create next version' }).waitFor()

  const status = page.locator('.editor-generation-status')
  await status.getByText('Designing layout', { exact: true }).waitFor()
  assert.match(await status.innerText(), /Generation started\. Safe to leave Posterlytics\./)
  assert.equal(await status.locator('.durable-generation-status').getAttribute('aria-live'), 'polite')
  assert.equal((await status.innerText()).includes('%'), false)

  const existingPoster = page.getByRole('img', { name: 'Northstar Analytics poster' })
  await existingPoster.waitFor()
  assert.match(await existingPoster.getAttribute('src'), /old-poster\.svg$/)
  const posterBox = await existingPoster.boundingBox()
  assert.ok(posterBox && posterBox.width > 200 && posterBox.height > 250)

  const activityButton = page.getByRole('button', {
    name: 'Generation activity, 2 unread',
  })
  await activityButton.click()

  const dialog = page.getByRole('dialog', { name: 'Generation activity' })
  await dialog.waitFor()
  assert.equal(await dialog.getAttribute('aria-modal'), 'true')
  assert.deepEqual(
    await dialog.locator('.activity-group-heading h3').allTextContents(),
    ['Active', 'Unread', 'Recent'],
  )
  assert.match(
    await dialog.locator('.activity-group').first().innerText(),
    /Northstar Analytics[\s\S]*Designing layout/,
  )

  await assertFocused(page, 'Close generation activity')
  const markAllRead = dialog.getByRole('button', { name: 'Mark all read' })
  await markAllRead.focus()
  await page.keyboard.press('Shift+Tab')
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.closest('.activity-row')?.textContent?.includes('Archived launch')
    ),
    true,
  )
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Mark all read')

  const sheetBox = await dialog.boundingBox()
  assert.ok(sheetBox)
  assert.ok(sheetBox.x > 900)
  assert.ok(Math.abs(sheetBox.width - 410) <= 1)
  await assertNoPageOverflow(page)
  await page.screenshot({
    path: `${OUTPUT_DIR}/activity-desktop.png`,
    fullPage: true,
  })

  await markAllRead.click()
  await page.getByRole('button', {
    name: 'Generation activity',
    exact: true,
  }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: 'Mark all read' }).count(), 0)

  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  await assertFocused(page, 'Generation activity')
  await assertNoPageOverflow(page)
  await page.screenshot({
    path: `${OUTPUT_DIR}/editor-active-generation.png`,
    fullPage: true,
  })

  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function testMobile(browserInstance) {
  const context = await browserInstance.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await installBackendMock(context)

  await page.goto(`${BASE_URL}/campaigns/campaign-active`)
  await page.getByText('Designing layout', { exact: true }).first().waitFor()

  const activityButton = page.getByRole('button', {
    name: 'Generation activity, 2 unread',
  })
  await activityButton.click()

  const dialog = page.getByRole('dialog', { name: 'Generation activity' })
  await dialog.waitFor()
  const sheetBox = await dialog.boundingBox()
  assert.ok(sheetBox)
  assert.ok(Math.abs(sheetBox.x) <= 1)
  assert.ok(Math.abs(sheetBox.width - 390) <= 1)
  assert.ok(Math.abs(sheetBox.height - 844) <= 1)
  await assertNoPageOverflow(page)
  await page.screenshot({
    path: `${OUTPUT_DIR}/activity-mobile.png`,
    fullPage: true,
  })

  await assertFocused(page, 'Close generation activity')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  await assertFocused(page, 'Generation activity, 2 unread')
  await assertNoPageOverflow(page)

  assert.deepEqual(pageErrors, [])
  await context.close()
}

async function installBackendMock(context) {
  await context.addCookies([{
    name: 'insforge_csrf_token',
    value: 'ui-smoke-csrf',
    url: BASE_URL,
  }])
  let notificationsRead = false
  const fixtures = createFixtures()

  await context.route('**/fixture/old-poster.svg', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: posterSvg(),
    })
  })

  await context.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname

    if (path === '/api/auth/refresh') {
      return json(route, {
        accessToken: 'ui-smoke-access-token',
        user: fixtures.user,
      })
    }

    if (path === '/api/database/rpc/generation_activity') {
      const items = fixtures.activities.map((item) => (
        notificationsRead && item.notification_id
          ? { ...item, read_at: item.read_at ?? fixtures.now }
          : item
      ))
      return json(route, {
        items,
        unread_count: notificationsRead ? 0 : 2,
        refreshed_at: fixtures.now,
      })
    }

    if (path === '/api/database/rpc/mark_generation_notifications_read') {
      notificationsRead = true
      return json(route, null)
    }

    if (path === '/api/database/records/campaigns') {
      return json(route, [fixtures.campaign])
    }

    if (path === '/api/database/records/poster_generations') {
      return json(route, [fixtures.activeGeneration, fixtures.currentGeneration])
    }

    if (path === '/api/database/records/placements') {
      return json(route, [fixtures.placement])
    }

    return json(route, [])
  })
}

function createFixtures() {
  const nowDate = new Date()
  const now = nowDate.toISOString()
  const startedAt = new Date(nowDate.getTime() - 94_000).toISOString()
  const completedAt = new Date(nowDate.getTime() - 35_000).toISOString()
  const user = {
    id: 'user-ui-smoke',
    email: 'designer@posterlytics.test',
  }
  const campaign = {
    id: 'campaign-active',
    user_id: user.id,
    product_url: 'https://northstar.example',
    product_name: 'Northstar Analytics',
    tagline: 'Decisions without the dashboard hunt',
    cta_text: 'Start analyzing',
    destination_url: 'https://northstar.example/start',
    style_profile: {
      palette: {
        primary: '#174a58',
        bg: '#edf3ee',
        text: '#102629',
        accent: '#e05b3f',
      },
      fonts: { heading: 'Space Grotesk', body: 'Space Grotesk' },
      tone: 'precise and energetic',
    },
    poster_copy: null,
    poster_content: null,
    brand_assets: null,
    brand_essence: 'Clear analysis for focused teams.',
    poster_spec: { qr_label: 'See the signal', urls: 'northstar.example' },
    hero_image_url: `${BASE_URL}/fixture/old-poster.svg`,
    hero_image_key: 'posters/campaign-active/version-1.svg',
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
    created_at: new Date(nowDate.getTime() - 86_400_000).toISOString(),
  }
  const generationBase = {
    campaign_id: campaign.id,
    user_id: user.id,
    parent_generation_id: null,
    generation_mode: 'iteration',
    instruction: null,
    reference_images: [],
    scenario: 'product',
    event_details: null,
    style_profile: campaign.style_profile,
    poster_copy: null,
    poster_content: null,
    brand_assets: null,
    brand_essence: campaign.brand_essence,
    poster_spec: campaign.poster_spec,
    design_tokens: null,
    screenshot_url: null,
    screenshot_key: null,
    poster_layout: null,
    design_status: 'ready',
    updated_at: now,
    failed_at: null,
    failure_stage: null,
    failure_code: null,
    failure_message: null,
    trace_schema_version: 1,
    trace_incomplete: false,
  }
  const currentGeneration = {
    ...generationBase,
    id: 'generation-current',
    version_number: 1,
    status: 'ready',
    hero_image_url: campaign.hero_image_url,
    hero_image_key: campaign.hero_image_key,
    created_at: campaign.created_at,
    completed_at: new Date(nowDate.getTime() - 82_800_000).toISOString(),
  }
  const activeGeneration = {
    ...generationBase,
    id: 'generation-active',
    parent_generation_id: currentGeneration.id,
    version_number: 2,
    status: 'designing',
    instruction: 'Make the launch message more direct.',
    hero_image_url: null,
    hero_image_key: null,
    design_status: 'generating',
    created_at: startedAt,
    completed_at: null,
  }
  const activityBase = {
    color_scheme: 'light',
    attempt_count: 1,
    retry_count: 0,
    max_attempts: 3,
    available_at: startedAt,
    started_at: startedAt,
    completed_at: null,
    created_at: startedAt,
    updated_at: now,
    last_error_code: null,
    last_error_message: null,
    generation_mode: 'iteration',
    scenario: 'product',
    instruction: null,
    hero_image_url: null,
    generation_created_at: startedAt,
    notification_id: null,
    notification_outcome: null,
    read_at: null,
    notification_created_at: null,
    version_number: 1,
  }
  const activities = [
    {
      ...activityBase,
      job_id: 'job-active',
      generation_id: activeGeneration.id,
      campaign_id: campaign.id,
      campaign_name: campaign.product_name,
      status: 'running',
      stage: 'designer',
      generation_status: 'designing',
      version_number: 2,
    },
    {
      ...activityBase,
      job_id: 'job-ready',
      generation_id: 'generation-ready',
      campaign_id: 'campaign-ready',
      campaign_name: 'Spring launch',
      status: 'succeeded',
      stage: 'hero',
      generation_status: 'ready',
      completed_at: completedAt,
      notification_id: 'notification-ready',
      notification_outcome: 'ready',
      notification_created_at: completedAt,
    },
    {
      ...activityBase,
      job_id: 'job-failed',
      generation_id: 'generation-failed',
      campaign_id: 'campaign-failed',
      campaign_name: 'Retail window kit',
      status: 'failed',
      stage: 'hero',
      generation_status: 'failed',
      completed_at: completedAt,
      retry_count: 2,
      attempt_count: 3,
      last_error_code: 'upstream_503',
      last_error_message: 'Image service remained unavailable.',
      notification_id: 'notification-failed',
      notification_outcome: 'failed',
      notification_created_at: completedAt,
    },
    {
      ...activityBase,
      job_id: 'job-history',
      generation_id: 'generation-history',
      campaign_id: 'campaign-history',
      campaign_name: 'Archived launch',
      status: 'succeeded',
      stage: 'hero',
      generation_status: 'ready',
      completed_at: completedAt,
      notification_id: 'notification-history',
      notification_outcome: 'ready',
      notification_created_at: completedAt,
      read_at: completedAt,
    },
  ]
  const placement = {
    id: 'placement-primary',
    campaign_id: campaign.id,
    user_id: user.id,
    label: 'Primary',
    code: 'northstar-primary',
    created_at: campaign.created_at,
  }

  return {
    now,
    user,
    campaign,
    currentGeneration,
    activeGeneration,
    activities,
    placement,
  }
}

function posterSvg() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1350" viewBox="0 0 900 1350">
      <rect width="900" height="1350" fill="#edf3ee"/>
      <rect x="54" y="54" width="792" height="1242" rx="28" fill="#174a58"/>
      <circle cx="690" cy="250" r="178" fill="#e05b3f"/>
      <path d="M80 930 C260 720 500 1060 820 760 L820 1250 L80 1250 Z" fill="#b9dfce"/>
      <text x="96" y="170" fill="#ffffff" font-family="Arial, sans-serif" font-size="38">NORTHSTAR</text>
      <text x="96" y="520" fill="#ffffff" font-family="Arial, sans-serif" font-size="86" font-weight="700">See the signal.</text>
      <text x="96" y="600" fill="#d9ebe3" font-family="Arial, sans-serif" font-size="38">Decisions without the dashboard hunt.</text>
    </svg>
  `.trim()
}

async function json(route, value) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': BASE_URL,
      'access-control-allow-credentials': 'true',
    },
    body: JSON.stringify(value),
  })
}

async function assertFocused(page, ariaLabel) {
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
    ariaLabel,
  )
}

async function assertNoPageOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }))
  assert.ok(
    dimensions.document <= dimensions.viewport
      && dimensions.body <= dimensions.viewport,
    `horizontal overflow: ${JSON.stringify(dimensions)}`,
  )
}

async function waitForServer() {
  await waitFor(async () => {
    try {
      const response = await fetch(BASE_URL)
      return response.ok
    } catch {
      return false
    }
  }, 15_000, () => `Vite did not start.\n${serverOutput}`)
}

async function waitFor(check, timeoutMs = 5000, timeoutMessage = () => 'Timed out') {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(timeoutMessage())
}
