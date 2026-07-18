import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, unlink } from 'node:fs/promises'
import process from 'node:process'
import { chromium } from 'playwright'

const HOST = '127.0.0.1'
const PORT = 4175
const BASE_URL = `http://${HOST}:${PORT}`
const OUTPUT_DIR = 'public/marketing/product'
const TEMP_DIR = 'test-results/marketing-capture'

await mkdir(OUTPUT_DIR, { recursive: true })
await mkdir(TEMP_DIR, { recursive: true })

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
      VITE_INSFORGE_ANON_KEY: 'marketing-capture-anon-key',
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
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'light',
  })
  await context.addCookies([{
    name: 'insforge_csrf_token',
    value: 'marketing-capture-csrf',
    url: BASE_URL,
  }])
  await installBackendMock(context)

  const captures = [
    {
      name: 'editor',
      path: '/campaigns/sample-campaign',
      ready: (page) => page.getByRole('heading', { name: 'Create next version' }),
    },
    {
      name: 'placements',
      path: '/campaigns/sample-campaign/placements',
      ready: (page) => page.getByRole('heading', { name: 'Placements', exact: true }),
    },
    {
      name: 'analytics',
      path: '/campaigns/sample-campaign/analytics',
      ready: (page) => page.getByRole('heading', { name: 'Analytics', exact: true }),
    },
  ]

  for (const capture of captures) {
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto(`${BASE_URL}${capture.path}`, { waitUntil: 'networkidle' })
    await capture.ready(page).waitFor()
    await page.waitForFunction(() =>
      [...document.images].every((image) => image.complete && image.naturalWidth > 0)
    )
    await page.evaluate(() => document.fonts.ready)

    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }))
    assert.ok(
      dimensions.document <= dimensions.viewport && dimensions.body <= dimensions.viewport,
      `${capture.name} has horizontal overflow: ${JSON.stringify(dimensions)}`,
    )
    assert.deepEqual(pageErrors, [], `${capture.name} emitted page errors`)

    const pngPath = `${TEMP_DIR}/${capture.name}.png`
    const webpPath = `${OUTPUT_DIR}/${capture.name}.webp`
    await page.screenshot({ path: pngPath })
    execFileSync('cwebp', ['-quiet', '-q', '82', pngPath, '-o', webpPath])
    await unlink(pngPath)
    await page.close()
  }

  await context.close()

  const socialContext = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'light',
  })
  await socialContext.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/refresh') return json(route, { user: null })
    return json(route, [])
  })
  const socialPage = await socialContext.newPage()
  await socialPage.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' })
  await socialPage.getByRole('heading', { name: 'Posterlytics', exact: true }).waitFor()
  await socialPage.evaluate(() => document.fonts.ready)
  await socialPage.waitForFunction(() =>
    [...document.querySelectorAll('.public-hero img')]
      .every((image) => image.complete && image.naturalWidth > 0)
  )
  await socialPage.screenshot({
    path: 'public/marketing/social-card.jpg',
    type: 'jpeg',
    quality: 88,
  })
  await socialContext.close()

  console.log(`Marketing product captures written to ${OUTPUT_DIR}`)
} finally {
  await browser?.close()
  server.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ])
}

async function installBackendMock(context) {
  const fixtures = createFixtures()

  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname

    if (path === '/api/auth/refresh') {
      return json(route, {
        accessToken: 'marketing-capture-access-token',
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
      return json(route, fixtures.generations)
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
      density: 'balanced',
    },
    poster_copy: null,
    poster_content: {
      headline: 'Cut through.',
      what_it_does: 'Turn a product website into a tracked physical campaign.',
      how_it_works: ['Read the source', 'Build the poster', 'Mint each placement'],
      why_use_it: ['Keep versions', 'Compare placement response'],
      features: ['Poster generation', 'Distinct QR codes', 'Placement analytics'],
      cta: 'Create a campaign',
    },
    brand_assets: {
      images: [{
        url: `${BASE_URL}/marketing/photos/picsum-35.webp`,
        key: 'sample/picsum-35.webp',
      }],
      primary_image_url: `${BASE_URL}/marketing/photos/picsum-35.webp`,
    },
    brand_essence: 'A focused print lab for product and growth teams.',
    poster_spec: { qr_label: 'Scan the launch', urls: 'posterlytics.insforge.site' },
    hero_image_url: `${BASE_URL}/marketing/photos/picsum-35.webp`,
    hero_image_key: 'sample/poster-v3.jpg',
    design_tokens: null,
    screenshot_url: null,
    screenshot_key: null,
    poster_layout: null,
    design_status: 'ready',
    reference_context: null,
    reference_images: [],
    scenario: 'product',
    event_details: null,
    current_generation_id: 'sample-generation-3',
    status: 'published',
    created_at: '2026-07-10T17:00:00.000Z',
  }

  const generationBase = {
    campaign_id: campaign.id,
    user_id: user.id,
    parent_generation_id: null,
    status: 'ready',
    generation_mode: 'iteration',
    instruction: null,
    reference_images: [],
    scenario: 'product',
    event_details: null,
    style_profile: campaign.style_profile,
    poster_copy: null,
    poster_content: campaign.poster_content,
    brand_assets: campaign.brand_assets,
    brand_essence: campaign.brand_essence,
    poster_spec: campaign.poster_spec,
    design_tokens: null,
    screenshot_url: null,
    screenshot_key: null,
    poster_layout: null,
    design_status: 'ready',
    updated_at: now,
    completed_at: now,
    failed_at: null,
    failure_stage: null,
    failure_code: null,
    failure_message: null,
    trace_schema_version: 1,
    trace_incomplete: false,
  }

  const generations = [
    {
      ...generationBase,
      id: 'sample-generation-3',
      parent_generation_id: 'sample-generation-2',
      version_number: 3,
      instruction: 'Make the launch line more direct.',
      hero_image_url: `${BASE_URL}/marketing/photos/picsum-35.webp`,
      hero_image_key: 'sample/poster-v3.jpg',
      created_at: '2026-07-17T17:00:00.000Z',
    },
    {
      ...generationBase,
      id: 'sample-generation-2',
      parent_generation_id: 'sample-generation-1',
      version_number: 2,
      instruction: 'Use a sharper, more urban image.',
      hero_image_url: `${BASE_URL}/marketing/photos/picsum-88.webp`,
      hero_image_key: 'sample/poster-v2.jpg',
      created_at: '2026-07-15T17:00:00.000Z',
    },
    {
      ...generationBase,
      id: 'sample-generation-1',
      version_number: 1,
      generation_mode: 'website_refresh',
      hero_image_url: `${BASE_URL}/marketing/photos/picsum-95.webp`,
      hero_image_key: 'sample/poster-v1.jpg',
      created_at: '2026-07-10T17:00:00.000Z',
    },
  ]

  const placements = [
    {
      id: 'sample-placement-lobby',
      campaign_id: campaign.id,
      user_id: user.id,
      label: 'Launch lobby',
      code: 'sample-launch-lobby',
      created_at: '2026-07-11T17:00:00.000Z',
    },
    {
      id: 'sample-placement-conference',
      campaign_id: campaign.id,
      user_id: user.id,
      label: 'Conference wall',
      code: 'sample-conference-wall',
      created_at: '2026-07-12T17:00:00.000Z',
    },
    {
      id: 'sample-placement-mailer',
      campaign_id: campaign.id,
      user_id: user.id,
      label: 'Partner mailer',
      code: 'sample-partner-mailer',
      created_at: '2026-07-13T17:00:00.000Z',
    },
  ]

  const stats = [
    {
      placement_id: placements[0].id,
      label: placements[0].label,
      code: placements[0].code,
      visits: 184,
      unique_visitors: 149,
    },
    {
      placement_id: placements[1].id,
      label: placements[1].label,
      code: placements[1].code,
      visits: 137,
      unique_visitors: 118,
    },
    {
      placement_id: placements[2].id,
      label: placements[2].label,
      code: placements[2].code,
      visits: 76,
      unique_visitors: 63,
    },
  ]

  const breakdowns = {
    devices: [
      { key: 'Mobile', visits: 321 },
      { key: 'Desktop', visits: 58 },
      { key: 'Tablet', visits: 18 },
    ],
    os: [
      { key: 'iOS', visits: 202 },
      { key: 'Android', visits: 119 },
      { key: 'macOS', visits: 47 },
      { key: 'Windows', visits: 29 },
    ],
    countries: [
      { key: 'United States', visits: 231 },
      { key: 'Canada', visits: 74 },
      { key: 'United Kingdom', visits: 52 },
      { key: 'Germany', visits: 40 },
    ],
  }

  return {
    now,
    user,
    campaign,
    generations,
    placements,
    stats,
    breakdowns,
  }
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
