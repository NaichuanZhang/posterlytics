import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import process from 'node:process'
import { chromium } from 'playwright'

const HOST = '127.0.0.1'
const PORT = 4176
const BASE_URL = `http://${HOST}:${PORT}`
const OUTPUT_DIR = 'test-results/marketing'

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
      VITE_INSFORGE_ANON_KEY: 'marketing-ui-anon-key',
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

  await testGuestHome(browser)
  await testAuthenticatedHome(browser)
  await testSignupMode(browser)
  await testProtectedReturnPath(browser)
  await captureVisualMatrix(browser)

  console.log(`Marketing UI smoke passed; screenshots: ${OUTPUT_DIR}`)
} finally {
  await browser?.close()
  server.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ])
}

async function testGuestHome(browserInstance) {
  const context = await browserInstance.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  await installBackendMock(context, { authenticated: false })
  const page = await context.newPage()

  await page.goto(`${BASE_URL}/`)
  await page.getByRole('heading', { name: 'Posterlytics', exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/')
  assert.equal(await page.getByRole('heading', { name: 'Campaigns' }).count(), 0)

  await context.close()
}

async function testAuthenticatedHome(browserInstance) {
  const context = await browserInstance.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  await installBackendMock(context, { authenticated: true })
  const page = await context.newPage()

  await page.goto(`${BASE_URL}/`)
  await page.getByRole('heading', { name: 'Campaigns', exact: true }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Posterlytics', exact: true }).count(), 0)

  await context.close()
}

async function testSignupMode(browserInstance) {
  const context = await browserInstance.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  await installBackendMock(context, { authenticated: false })
  const page = await context.newPage()

  await page.goto(`${BASE_URL}/signin?mode=signup&next=%2Fcampaigns%2Fnew`)
  await page.getByRole('heading', { name: 'Create an account' }).waitFor()
  const signupMode = page.getByRole('button', { name: 'Create account', exact: true }).first()
  assert.equal(await signupMode.getAttribute('aria-pressed'), 'true')

  await context.close()
}

async function testProtectedReturnPath(browserInstance) {
  const context = await browserInstance.newContext({
    viewport: { width: 1024, height: 768 },
    reducedMotion: 'reduce',
  })
  const authState = { authenticated: false }
  await installBackendMock(context, authState)
  const page = await context.newPage()
  const returnPath = '/campaigns/sample-campaign/analytics?range=30d#countries'

  await page.goto(`${BASE_URL}${returnPath}`)
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
  const signInUrl = new URL(page.url())
  assert.equal(signInUrl.pathname, '/signin')
  assert.equal(signInUrl.searchParams.get('next'), returnPath)

  await page.getByLabel('Email').fill('sample@posterlytics.test')
  await page.getByLabel('Password').fill('sample-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await page.getByRole('heading', { name: 'Analytics', exact: true }).waitFor()

  const returnedUrl = new URL(page.url())
  assert.equal(
    `${returnedUrl.pathname}${returnedUrl.search}${returnedUrl.hash}`,
    returnPath,
  )
  assert.equal(authState.authenticated, true)

  await context.close()
}

async function captureVisualMatrix(browserInstance) {
  const viewports = [
    { label: '1440x960', width: 1440, height: 960 },
    { label: '1024x768', width: 1024, height: 768 },
    { label: '390x844', width: 390, height: 844 },
  ]
  const modes = [
    { label: 'light', colorScheme: 'light', reducedMotion: 'no-preference' },
    { label: 'dark', colorScheme: 'dark', reducedMotion: 'no-preference' },
    { label: 'reduced', colorScheme: 'light', reducedMotion: 'reduce' },
  ]

  for (const mode of modes) {
    for (const viewport of viewports) {
      const context = await browserInstance.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: mode.colorScheme,
        reducedMotion: mode.reducedMotion,
        deviceScaleFactor: 1,
      })
      await installBackendMock(context, { authenticated: false })
      const page = await context.newPage()
      const pageErrors = []
      page.on('pageerror', (error) => pageErrors.push(error.message))

      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: 'Posterlytics', exact: true }).waitFor()
      await page.evaluate(() => document.fonts.ready)
      await revealLazyContent(page)
      await assertLandingGeometry(page)
      assert.deepEqual(pageErrors, [])

      await page.screenshot({
        path: `${OUTPUT_DIR}/${mode.label}-${viewport.label}.png`,
        fullPage: true,
      })
      await context.close()
    }
  }
}

async function installBackendMock(context, authState) {
  const fixtures = createFixtures()

  if (authState.authenticated) {
    await context.addCookies([{
      name: 'insforge_csrf_token',
      value: 'marketing-ui-csrf',
      url: BASE_URL,
    }])
  }

  await context.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname

    if (path === '/api/auth/refresh') {
      return json(route, authState.authenticated
        ? { accessToken: 'marketing-ui-access-token', user: fixtures.user }
        : { user: null })
    }

    if (path === '/api/auth/sessions' && request.method() === 'POST') {
      authState.authenticated = true
      return json(route, {
        accessToken: 'marketing-ui-access-token',
        user: fixtures.user,
      })
    }

    if (path === '/api/database/rpc/generation_activity') {
      return json(route, {
        items: [],
        unread_count: 0,
        refreshed_at: fixtures.now,
      })
    }

    if (path === '/api/database/rpc/placement_stats') {
      return json(route, fixtures.stats)
    }

    if (path === '/api/database/rpc/campaign_breakdowns') {
      return json(route, fixtures.breakdowns)
    }

    if (path === '/api/database/records/campaigns') {
      return json(route, [fixtures.campaign])
    }

    if (path === '/api/database/records/poster_generations') {
      return json(route, [fixtures.generation])
    }

    if (path === '/api/database/records/placements') {
      return json(route, fixtures.placements)
    }

    return json(route, [])
  })
}

function createFixtures() {
  const now = '2026-07-17T18:00:00.000Z'
  const user = {
    id: 'sample-user',
    email: 'sample@posterlytics.test',
  }
  const campaign = {
    id: 'sample-campaign',
    user_id: user.id,
    product_url: 'https://posterlytics.insforge.site',
    product_name: 'Posterlytics Sample Launch',
    tagline: 'Website to poster. Placement to signal.',
    cta_text: 'Create a campaign',
    destination_url: 'https://posterlytics.insforge.site',
    style_profile: {
      palette: {
        primary: '#e94f37',
        bg: '#edf1df',
        text: '#151719',
        accent: '#f4c95d',
      },
      fonts: { heading: 'Archivo', body: 'Archivo' },
      tone: 'direct, tactile, precise',
    },
    poster_copy: null,
    poster_content: null,
    brand_assets: {
      images: [],
      primary_image_url: `${BASE_URL}/marketing/photos/picsum-35.webp`,
    },
    brand_essence: 'A focused print lab for product and growth teams.',
    poster_spec: { qr_label: 'Scan the launch', urls: 'posterlytics.insforge.site' },
    hero_image_url: `${BASE_URL}/marketing/photos/picsum-35.webp`,
    hero_image_key: 'sample/poster.jpg',
    design_tokens: null,
    screenshot_url: null,
    screenshot_key: null,
    poster_layout: null,
    design_status: 'ready',
    reference_context: null,
    reference_images: [],
    scenario: 'product',
    event_details: null,
    current_generation_id: 'sample-generation',
    status: 'published',
    created_at: '2026-07-10T17:00:00.000Z',
  }
  const generation = {
    id: 'sample-generation',
    campaign_id: campaign.id,
    user_id: user.id,
    parent_generation_id: null,
    version_number: 1,
    status: 'ready',
    generation_mode: 'website_refresh',
    instruction: null,
    reference_images: [],
    scenario: 'product',
    event_details: null,
    style_profile: campaign.style_profile,
    poster_copy: null,
    poster_content: null,
    brand_assets: campaign.brand_assets,
    brand_essence: campaign.brand_essence,
    poster_spec: campaign.poster_spec,
    design_tokens: null,
    screenshot_url: null,
    screenshot_key: null,
    poster_layout: null,
    design_status: 'ready',
    hero_image_url: campaign.hero_image_url,
    hero_image_key: campaign.hero_image_key,
    created_at: campaign.created_at,
    updated_at: now,
    completed_at: now,
    failed_at: null,
    failure_stage: null,
    failure_code: null,
    failure_message: null,
    trace_schema_version: 1,
    trace_incomplete: false,
  }
  const placements = [{
    id: 'sample-placement',
    campaign_id: campaign.id,
    user_id: user.id,
    label: 'Launch lobby',
    code: 'sample-launch-lobby',
    created_at: campaign.created_at,
  }]
  const stats = [{
    placement_id: placements[0].id,
    label: placements[0].label,
    code: placements[0].code,
    visits: 184,
    unique_visitors: 149,
  }]
  const breakdowns = {
    devices: [{ key: 'Mobile', visits: 161 }, { key: 'Desktop', visits: 23 }],
    os: [{ key: 'iOS', visits: 111 }, { key: 'Android', visits: 73 }],
    countries: [{ key: 'United States', visits: 122 }, { key: 'Canada', visits: 62 }],
  }

  return {
    now,
    user,
    campaign,
    generation,
    placements,
    stats,
    breakdowns,
  }
}

async function revealLazyContent(page) {
  const selectors = [
    '#workflow',
    '#versions',
    '#attribution',
    '.analytics-section',
    '.public-final-cta',
  ]
  for (const selector of selectors) {
    await page.locator(selector).scrollIntoViewIfNeeded()
    await page.waitForTimeout(100)
  }
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto'
    window.scrollTo(0, 0)
  })
  await page.waitForFunction(() => window.scrollY === 0)
  await page.waitForTimeout(100)
}

async function assertLandingGeometry(page) {
  const report = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0
    }
    const clippedControls = [...document.querySelectorAll('a, button')]
      .filter(visible)
      .filter((element) =>
        element.scrollWidth > element.clientWidth + 1
        || element.scrollHeight > element.clientHeight + 1
      )
      .map((element) => element.textContent?.trim())
    const missingImages = [...document.images]
      .filter((image) => !image.complete || image.naturalWidth === 0)
      .map((image) => image.getAttribute('src'))
    const navRects = [...document.querySelectorAll('.public-nav a')]
      .map((element) => element.getBoundingClientRect())
    const heroHeading = document.querySelector('.public-hero h1')?.getBoundingClientRect()
    const heroHeadingStyle = document.querySelector('.public-hero h1')
      ? getComputedStyle(document.querySelector('.public-hero h1'))
      : null
    const workflow = document.querySelector('#workflow')?.getBoundingClientRect()

    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      missingImages,
      clippedControls,
      navWithinViewport: navRects.every((rect) => rect.left >= 0 && rect.right <= window.innerWidth),
      heroHeadingWithinViewport: !!heroHeading
        && heroHeading.left >= 0
        && heroHeading.right <= window.innerWidth,
      heroHeadingSingleLine: !!heroHeading
        && !!heroHeadingStyle
        && heroHeading.height <= Number.parseFloat(heroHeadingStyle.lineHeight) * 1.1,
      nextSectionVisible: !!workflow
        && workflow.top > 0
        && workflow.top < window.innerHeight,
      workflowTop: workflow?.top,
      viewportHeight: window.innerHeight,
    }
  })

  assert.ok(
    report.documentWidth <= report.viewport && report.bodyWidth <= report.viewport,
    `horizontal overflow: ${JSON.stringify(report)}`,
  )
  assert.deepEqual(report.missingImages, [])
  assert.deepEqual(report.clippedControls, [])
  assert.equal(report.navWithinViewport, true)
  assert.equal(report.heroHeadingWithinViewport, true)
  assert.equal(
    report.heroHeadingSingleLine,
    true,
    `hero heading wrapped: ${JSON.stringify(report)}`,
  )
  assert.equal(
    report.nextSectionVisible,
    true,
    `next section is not visible: ${JSON.stringify(report)}`,
  )
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

async function waitFor(check, timeoutMs, timeoutMessage) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(timeoutMessage())
}
