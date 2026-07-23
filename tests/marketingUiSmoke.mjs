import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import process from 'node:process'
import { chromium } from 'playwright'

const HOST = '127.0.0.1'
const PORT = 4176
const BASE_URL = `http://${HOST}:${PORT}`
const OUTPUT_DIR = 'test-results/marketing'
const SESSION_EXPIRY_NOTICE = 'Your session ended. Sign in to continue.'
const SESSION_EXPIRY_RAW_ERROR = 'No refresh token provided'
const SESSION_EXPIRY_RPC_ERROR = 'Raw InsForgeError text must remain hidden.'
const SESSION_EXPIRY_DRAFT_KEY = 'posterlytics.campaignDraft.v1:sample-user'
const SESSION_EXPIRY_DRAFT_VALUE = JSON.stringify({
  version: 1,
  ownerId: 'sample-user',
  updatedAt: '2026-07-23T20:00:00.000Z',
  data: { productName: 'Unsaved expiry recovery draft' },
})

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
  await testStaticFirstPaintHtml()
  browser = await chromium.launch({ headless: true })

  await testFirstPaintLifecycle(browser)
  await testGuestHome(browser)
  await testAuthenticatedHome(browser)
  await testColdLoadSessionExpiry(browser)
  await testOnlineLazyChunkRetry(browser)
  await testOfflineLazyChunkReconnect(browser)
  await testHeroMotionImportFailure(browser)
  await testAuthenticatedNotFound(browser)
  await testSignupMode(browser)
  await testPasswordRecovery(browser)
  await testSignInErrorRecovery(browser)
  await testCampaignCreationFailure(browser)
  await testPublicResponsiveAccessibility(browser)
  await testHeroTextSpacing(browser)
  await testHeroTextResize(browser)
  await testPosterBreakpoints(browser)
  await testProtectedReturnPath(browser)
  await testChineseLocale(browser)
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

async function testStaticFirstPaintHtml() {
  for (const pathname of ['/', '/signin']) {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      headers: { Accept: 'text/html' },
    })
    assert.equal(response.status, 200, `${pathname} did not return HTML successfully`)
    assert.match(
      response.headers.get('content-type') ?? '',
      /^text\/html\b/,
      `${pathname} did not return an HTML content type`,
    )

    const html = await response.text()
    const shellTag = html.match(
      /<div\b[^>]*data-first-paint-shell="static"[^>]*>/,
    )?.[0]
    assert.ok(shellTag, `${pathname} is missing the static first-paint shell`)
    assert.match(shellTag, /\brole="status"/)
    assert.match(shellTag, /\baria-live="polite"/)
    assert.match(shellTag, /\baria-busy="true"/)
    assert.ok(
      html.includes('id="first-paint-shell-styles"'),
      `${pathname} is missing the inline first-paint styles`,
    )
    assert.match(html, /<main\b[^>]*data-noscript-fallback/)
  }
}

async function testFirstPaintLifecycle(browserInstance) {
  const routes = [
    { pathname: '/', appSelector: '.public-surface' },
    { pathname: '/signin', appSelector: '.public-auth' },
  ]

  for (const { pathname, appSelector } of routes) {
    const context = await browserInstance.newContext({
      locale: 'en-US',
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
    })
    await installBackendMock(context, { authenticated: false })

    let releaseEntryModule
    const entryModuleGate = new Promise((resolve) => {
      releaseEntryModule = resolve
    })
    await context.route('**/src/main.tsx', async (route) => {
      await entryModuleGate
      await route.continue()
    })

    const page = await context.newPage()
    const navigation = page.goto(`${BASE_URL}${pathname}`, {
      waitUntil: 'domcontentloaded',
    })
    const staticShell = page.locator('[data-first-paint-shell="static"]')
    await staticShell.waitFor()
    assert.equal(await staticShell.getAttribute('role'), 'status')
    assert.equal(await page.getByRole('status').count(), 1)

    releaseEntryModule()
    await navigation
    await page.locator(appSelector).waitFor()
    assert.equal(await page.locator('[data-first-paint-shell]').count(), 0)

    await context.close()
  }
}

async function testGuestHome(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  await installBackendMock(context, { authenticated: false })
  const page = await context.newPage()

  await page.goto(`${BASE_URL}/`)
  await page.getByRole('heading', { name: 'Posterlytics', exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/')
  assert.equal(new URL(page.url()).searchParams.get('reason'), null)
  assert.equal(await page.getByRole('heading', { name: 'Campaigns' }).count(), 0)

  await context.close()
}

async function testAuthenticatedHome(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  const authState = { authenticated: true, expired: false }
  await installBackendMock(context, authState)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto(`${BASE_URL}/`)
  await page.getByRole('heading', { name: 'Campaigns', exact: true }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Posterlytics', exact: true }).count(), 0)
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, value)
  }, {
    key: SESSION_EXPIRY_DRAFT_KEY,
    value: SESSION_EXPIRY_DRAFT_VALUE,
  })

  authState.expired = true
  const activityFailure = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/api/database/rpc/generation_activity'
      && response.status() === 401
  })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await activityFailure

  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
  await page.getByText(SESSION_EXPIRY_NOTICE, { exact: true }).waitFor()
  const expiredUrl = new URL(page.url())
  assert.equal(expiredUrl.pathname, '/signin')
  assert.equal(expiredUrl.searchParams.get('next'), '/')
  assert.equal(expiredUrl.searchParams.get('reason'), 'session_expired')
  assert.equal(
    await page.locator('body').getByText(SESSION_EXPIRY_RAW_ERROR, {
      exact: true,
    }).count(),
    0,
  )
  assert.equal(await page.getByText('AUTH_TOKEN_EXPIRED', { exact: true }).count(), 0)
  assert.equal(await page.getByText(SESSION_EXPIRY_RPC_ERROR, { exact: true }).count(), 0)
  assert.equal(await page.locator('.rail-avatar').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Sign out' }).count(), 0)
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), SESSION_EXPIRY_DRAFT_KEY),
    SESSION_EXPIRY_DRAFT_VALUE,
  )

  await page.evaluate(() => {
    window.history.pushState({}, '', '/campaigns/new')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.waitForFunction(() => {
    const url = new URL(window.location.href)
    return url.pathname === '/signin'
      && url.searchParams.get('next') === '/campaigns/new'
  })
  const blockedUrl = new URL(page.url())
  assert.equal(blockedUrl.pathname, '/signin')
  assert.equal(blockedUrl.searchParams.get('next'), '/campaigns/new')
  assert.deepEqual(pageErrors, [])

  await context.close()
}

async function testColdLoadSessionExpiry(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1024, height: 768 },
    reducedMotion: 'reduce',
  })
  await installBackendMock(context, {
    authenticated: true,
    expired: true,
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, value)
  }, {
    key: SESSION_EXPIRY_DRAFT_KEY,
    value: SESSION_EXPIRY_DRAFT_VALUE,
  })
  const destination = '/campaigns/new?resume=website#source'

  await page.goto(`${BASE_URL}${destination}`)
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
  await page.getByText(SESSION_EXPIRY_NOTICE, { exact: true }).waitFor()

  const expiredUrl = new URL(page.url())
  assert.equal(expiredUrl.pathname, '/signin')
  assert.equal(expiredUrl.searchParams.get('next'), destination)
  assert.equal(expiredUrl.searchParams.get('reason'), 'session_expired')
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), SESSION_EXPIRY_DRAFT_KEY),
    SESSION_EXPIRY_DRAFT_VALUE,
  )
  assert.equal(
    await page.locator('body').getByText(SESSION_EXPIRY_RAW_ERROR, {
      exact: true,
    }).count(),
    0,
  )
  assert.equal(await page.locator('.rail-avatar').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Sign out' }).count(), 0)
  assert.deepEqual(pageErrors, [])

  await context.close()
}

async function testOnlineLazyChunkRetry(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  })
  await installBackendMock(context, { authenticated: true })
  const campaignWizardModule =
    /\/src\/pages\/CampaignWizardPage\.tsx(?:\?|$)/
  await context.route(campaignWizardModule, (route) => route.abort('failed'))
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto(`${BASE_URL}/`)
  await page.getByRole('heading', { name: 'Campaigns', exact: true }).waitFor()
  await page.locator('.toolbar-actions')
    .getByRole('link', { name: 'New campaign', exact: true })
    .click()

  const { retry } = await assertRecoverableErrorScreen(page, {
    description:
      'Posterlytics ran into an unexpected error. Try again or reload the page.',
    heading: 'Something went wrong',
    retryDisabled: false,
  })
  assert.equal(new URL(page.url()).pathname, '/campaigns/new')

  await context.unroute(campaignWizardModule)
  const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded' })
  await retry.click()
  await navigation
  await page.getByRole('heading', { name: 'Create campaign', exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/campaigns/new')
  assert.equal(
    await page.evaluate(() =>
      performance.getEntriesByType('navigation')[0]?.type
    ),
    'reload',
  )
  assert.ok(
    pageErrors.every((message) =>
      /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk\b.*failed/i.test(message)
    ),
    `Unexpected page errors: ${JSON.stringify(pageErrors)}`,
  )

  await context.close()
}

async function testOfflineLazyChunkReconnect(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  })
  await installBackendMock(context, { authenticated: true })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto(`${BASE_URL}/`)
  await page.getByRole('heading', { name: 'Campaigns', exact: true }).waitFor()
  await context.setOffline(true)
  await page.locator('.toolbar-actions')
    .getByRole('link', { name: 'New campaign', exact: true })
    .click()

  await assertRecoverableErrorScreen(page, {
    description:
      'Posterlytics could not connect. Check your internet connection and try again.',
    heading: 'Connection interrupted',
    retryDisabled: true,
  })
  assert.equal(new URL(page.url()).pathname, '/campaigns/new')

  const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded' })
  await context.setOffline(false)
  await navigation
  await page.getByRole('heading', { name: 'Create campaign', exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/campaigns/new')
  assert.ok(
    pageErrors.every((message) =>
      /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk\b.*failed/i.test(message)
    ),
    `Unexpected page errors: ${JSON.stringify(pageErrors)}`,
  )

  await context.close()
}

async function testHeroMotionImportFailure(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'no-preference',
  })
  await installBackendMock(context, { authenticated: false })
  await context.route(
    /\/src\/marketing\/heroMotion\.ts(?:\?|$)/,
    (route) => route.abort('failed'),
  )
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto(`${BASE_URL}/`)
  await page.getByRole('heading', { name: 'Posterlytics', exact: true }).waitFor()
  await page.waitForFunction(() =>
    !document.querySelector('.public-hero')
      ?.classList.contains('hero-motion-pending')
  )
  assert.deepEqual(pageErrors, [])

  await context.close()
}

async function assertRecoverableErrorScreen(page, {
  description,
  heading,
  retryDisabled,
}) {
  const alert = page.getByRole('alert')
  await alert.waitFor()
  const errorHeading = alert.getByRole('heading', { name: heading, exact: true })
  await errorHeading.waitFor()
  await alert.getByText(description, { exact: true }).waitFor()

  const retry = alert.getByRole('button', { name: 'Retry', exact: true })
  const reload = alert.getByRole('button', { name: 'Reload page', exact: true })
  assert.equal(await retry.isDisabled(), retryDisabled)
  assert.equal(await reload.isEnabled(), true)
  assert.equal(
    await errorHeading.evaluate((element) => document.activeElement === element),
    true,
  )
  assert.equal(
    await page.locator('#root').evaluate((root) =>
      root.childElementCount > 0 && (root.textContent?.trim().length ?? 0) > 0
    ),
    true,
  )

  return { reload, retry }
}

async function testAuthenticatedNotFound(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  await installBackendMock(context, { authenticated: true })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto(`${BASE_URL}/campaigns/stale-link/details`)
  await page.getByRole('heading', { name: 'Page not found', exact: true }).waitFor()
  const rail = page.getByRole('complementary')
  await rail.waitFor()
  const primaryNavigation = rail.getByRole('navigation', { name: 'Primary navigation' })
  await primaryNavigation.waitFor()
  assert.equal(
    await primaryNavigation.getByRole('link', { name: 'Campaigns', exact: true }).count(),
    1,
  )
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  )
  await page.screenshot({
    path: `${OUTPUT_DIR}/not-found-authenticated.png`,
    fullPage: true,
  })

  await page.getByRole('link', { name: 'Back to campaigns' }).click()
  await page.getByRole('heading', { name: 'Campaigns', exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/')
  assert.deepEqual(pageErrors, [])

  await context.close()
}

async function testSignupMode(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  await installBackendMock(context, { authenticated: false })
  const page = await context.newPage()

  await page.goto(`${BASE_URL}/signin?mode=signup&next=%2Fcampaigns%2Fnew`)
  await page.getByRole('heading', { name: 'Create an account' }).waitFor()
  const signupMode = page.getByRole('button', { name: 'Create account', exact: true }).first()
  assert.equal(await signupMode.getAttribute('aria-pressed'), 'true')
  await page.evaluate(() => document.fonts.ready)
  await assertSamplePosterGeometry(page, 'signup mobile')

  await context.close()
}

async function testPasswordRecovery(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  const authState = { authenticated: false, resetCalls: [] }
  await installBackendMock(context, authState)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto(`${BASE_URL}/signin`)
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await page.getByRole('heading', { name: 'Reset your password' }).waitFor()
  await waitForFocused(page, '#auth-heading')
  await page.keyboard.press('Tab')
  await waitForFocused(page, '#reset-email')

  await page.getByLabel('Email').fill('locked-out@posterlytics.test')
  await page.getByRole('button', { name: 'Send reset code' }).click()
  await page.getByRole('heading', { name: 'Enter the code' }).waitFor()
  await waitForFocused(page, '#reset-code')
  await page.getByText(
    'If an account exists, a code was sent. Check your inbox and spam folder.',
  ).waitFor()

  const resendButton = page.getByRole('button', { name: /Resend in \d+s/ })
  assert.equal(await resendButton.isDisabled(), true)

  await page.getByLabel('Reset code').fill('123456')
  await page.getByRole('button', { name: 'Verify code' }).click()
  await page.getByRole('heading', { name: 'Create a new password' }).waitFor()
  await waitForFocused(page, '#reset-new-password')

  await page.getByLabel('New password', { exact: true }).fill('new-secure-password')
  await page.getByLabel('Confirm new password').fill('new-secure-password')
  await page.getByRole('button', { name: 'Reset password' }).click()
  await page.getByRole('heading', { name: 'Password updated' }).waitFor()
  await waitForFocused(page, '#auth-heading')
  await page.getByText('Your password has been changed.').waitFor()

  assert.deepEqual(authState.resetCalls, [
    {
      endpoint: 'send',
      body: { email: 'locked-out@posterlytics.test' },
    },
    {
      endpoint: 'exchange',
      body: { email: 'locked-out@posterlytics.test', code: '123456' },
    },
    {
      endpoint: 'reset',
      body: {
        newPassword: 'new-secure-password',
        otp: 'marketing-reset-token',
      },
    },
  ])

  await page.getByRole('button', { name: 'Sign in with new password' }).click()
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
  await waitForFocused(page, '#auth-heading')
  assert.equal(
    await page.getByLabel('Email').inputValue(),
    'locked-out@posterlytics.test',
  )
  assert.deepEqual(pageErrors, [])

  await context.close()
}

async function testSignInErrorRecovery(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  const authState = {
    authenticated: false,
    signInFailure: 'credentials',
  }
  await installBackendMock(context, authState)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto(`${BASE_URL}/signin`)
  await page.getByLabel('Email').fill('locked-out@posterlytics.test')
  await page.getByLabel('Password').fill('wrong-password')
  await page.locator('.public-auth-submit').click()

  const credentialNotice = page.getByRole('alert')
  await credentialNotice.getByText('Invalid email or password.', { exact: true }).waitFor()
  await credentialNotice.getByRole('button', { name: 'Forgot password?' }).click()
  await page.getByRole('heading', { name: 'Reset your password' }).waitFor()
  assert.equal(
    await page.getByLabel('Email').inputValue(),
    'locked-out@posterlytics.test',
  )

  await page.getByRole('button', { name: 'Back to sign in' }).click()
  authState.signInFailure = 'network'
  await page.getByLabel('Password').fill('still-wrong')
  await page.locator('.public-auth-submit').click()
  await page.getByText(
    'Posterlytics could not connect. Check your internet connection and try again.',
    { exact: true },
  ).waitFor()
  assert.equal(
    await page.getByText('Network request failed: Failed to fetch', {
      exact: true,
    }).count(),
    0,
  )
  assert.equal(await page.locator('.public-auth-submit').isEnabled(), true)
  assert.deepEqual(pageErrors, [])

  await context.close()
}

async function testCampaignCreationFailure(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  })
  await installBackendMock(context, {
    authenticated: true,
    campaignCreateFailure: true,
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto(`${BASE_URL}/campaigns/new`)
  await page.getByRole('button', { name: /Website product/ }).click()
  await page.getByLabel('Website URL').fill('https://example.test/product')
  await page.getByLabel('Product name').fill('Failed campaign')
  await page.getByLabel('Destination URL').fill('https://example.test/buy')
  await page.getByRole('button', { name: 'Generate poster' }).click()

  await page.getByText(
    'Could not create campaign. Check your connection and try again.',
    { exact: true },
  ).waitFor()
  assert.equal(
    await page.getByText(
      'Campaign details were saved; generation did not start.',
      { exact: true },
    ).count(),
    0,
  )
  assert.equal(
    await page.getByText('Backend campaign insert failed', {
      exact: true,
    }).count(),
    0,
  )
  assert.equal(
    await page.getByRole('button', { name: 'Generate poster' }).isEnabled(),
    true,
  )
  assert.deepEqual(pageErrors, [])

  await context.close()
}

async function testPublicResponsiveAccessibility(browserInstance) {
  const viewports = [
    { width: 280, height: 653 },
    { width: 320, height: 653 },
    { width: 375, height: 812 },
    { width: 768, height: 900 },
    { width: 1280, height: 900 },
    { width: 2560, height: 1440 },
  ]

  for (const viewport of viewports) {
    const context = await browserInstance.newContext({
      locale: 'en-US',
      viewport,
      reducedMotion: 'reduce',
      deviceScaleFactor: 1,
    })
    await installBackendMock(context, { authenticated: false })
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Posterlytics', exact: true }).waitFor()
    await page.locator('#attribution').waitFor()
    await page.evaluate(() => document.fonts.ready)
    await assertNoHorizontalOverflow(page, `landing ${viewport.width}px`)

    if (viewport.width === 280) {
      await assertElementsWithinViewport(
        page,
        '.public-hero h1, .public-hero-actions .public-button-primary',
        'landing 280px critical content',
      )
      await assertMinimumHitTargets(
        page,
        '.public-nav a',
        'landing 280px visible navigation links',
      )
      await assertMinimumHitTargets(
        page,
        '.public-nav-shell > .public-brand, .public-nav select',
        'landing 280px header controls',
      )
      await assertNoTargetIntersections(
        page,
        '.public-nav-shell > .public-brand, .public-nav a, .public-nav select',
        'landing 280px header controls',
      )
      await page.screenshot({
        path: `${OUTPUT_DIR}/responsive-280x653-landing.png`,
        fullPage: true,
      })
    }

    await page.goto(`${BASE_URL}/signin`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
    await page.getByLabel('Email').waitFor()
    await page.evaluate(() => document.fonts.ready)
    await assertNoHorizontalOverflow(page, `sign in ${viewport.width}px`)

    if (viewport.width === 280) {
      await assertElementsWithinViewport(
        page,
        [
          '.public-auth-panel',
          '.public-auth-language select',
          '.public-auth-field input',
          '.public-auth-submit',
        ].join(', '),
        'sign in 280px critical content',
      )
      await assertMinimumHitTargets(
        page,
        '.public-auth-brand, .public-auth-language select, .public-auth-inline-button',
        'sign in 280px header and recovery controls',
      )
      await assertNoTargetIntersections(
        page,
        '.public-auth-brand, .public-auth-language select',
        'sign in 280px header controls',
      )
      await page.screenshot({
        path: `${OUTPUT_DIR}/responsive-280x653-sign-in.png`,
        fullPage: true,
      })
    }

    assert.deepEqual(
      pageErrors,
      [],
      `${viewport.width}px public page errors: ${pageErrors.join('; ')}`,
    )
    await context.close()
  }
}

async function testHeroTextSpacing(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 320, height: 653 },
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
  })
  await installBackendMock(context, { authenticated: false })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Posterlytics', exact: true }).waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({
    content: `
      .public-hero-copy,
      .public-hero-copy * {
        line-height: 1.5 !important;
        letter-spacing: 0.12em !important;
        word-spacing: 0.16em !important;
      }
    `,
  })
  await waitForLayout(page)

  const report = await readHeroTextGeometry(page)
  assert.ok(
    report.headingScrollWidth <= report.headingClientWidth,
    `spaced hero heading clipped horizontally: ${JSON.stringify(report)}`,
  )
  assert.equal(
    report.headingTextWithinBox,
    true,
    `spaced hero text escaped its heading box: ${JSON.stringify(report)}`,
  )
  assert.ok(
    report.copyBottom <= report.stageTop + 1,
    `spaced hero copy overlaps poster stage: ${JSON.stringify(report)}`,
  )
  assert.ok(
    report.documentScrollWidth <= report.viewportWidth,
    `spaced hero caused horizontal overflow: ${JSON.stringify(report)}`,
  )
  assert.deepEqual(pageErrors, [])
  await page.screenshot({
    path: `${OUTPUT_DIR}/responsive-320x653-wcag-text-spacing.png`,
    fullPage: true,
  })
  await context.close()
}

async function testHeroTextResize(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
  })
  await installBackendMock(context, { authenticated: false })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Posterlytics', exact: true }).waitFor()
  await page.evaluate(() => document.fonts.ready)
  await doubleComputedTextMetrics(
    page,
    [
      '.public-overline',
      '.public-hero h1',
      '.public-hero-copy > p',
      '.public-hero-actions a',
    ].join(', '),
  )

  const report = await readHeroTextGeometry(page)
  assert.ok(
    report.headingScrollWidth <= report.headingClientWidth,
    `resized hero heading clipped horizontally: ${JSON.stringify(report)}`,
  )
  assert.equal(
    report.headingTextWithinBox,
    true,
    `resized hero text escaped its heading box: ${JSON.stringify(report)}`,
  )
  assert.equal(
    report.headingTextIntersectsStage,
    false,
    `resized hero text intersects poster stage: ${JSON.stringify(report)}`,
  )
  assert.ok(
    report.documentScrollWidth <= report.viewportWidth,
    `resized hero caused horizontal overflow: ${JSON.stringify(report)}`,
  )
  assert.deepEqual(pageErrors, [])
  await page.screenshot({
    path: `${OUTPUT_DIR}/hero-1280-200-percent-text.png`,
    fullPage: true,
  })
  await context.close()
}

async function testPosterBreakpoints(browserInstance) {
  for (const width of [820, 768]) {
    const context = await browserInstance.newContext({
      locale: 'en-US',
      viewport: { width, height: 900 },
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      deviceScaleFactor: 1,
    })
    await installBackendMock(context, { authenticated: false })
    const page = await context.newPage()

    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Posterlytics', exact: true }).waitFor()
    await page.locator('.placement-fan .sample-poster').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    await assertSamplePosterGeometry(page, `landing ${width}px`)

    await page.goto(`${BASE_URL}/signin`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
    await page.evaluate(() => document.fonts.ready)
    await assertSamplePosterGeometry(page, `sign in ${width}px`)

    await context.close()
  }
}

async function testProtectedReturnPath(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'en-US',
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
  assert.equal(signInUrl.searchParams.get('reason'), null)

  await page.getByLabel('Email').fill('sample@posterlytics.test')
  await page.getByLabel('Password').fill('sample-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await page.getByRole('heading', { name: 'Analytics', exact: true }).waitFor()
  assert.equal(
    await page.locator('.analytics-filter-note').innerText(),
    'Bots filtered: 17',
  )
  await page.getByRole('heading', { name: 'All time', exact: true }).waitFor()
  const freshnessTime = page.locator('.analytics-freshness time')
  await freshnessTime.waitFor()
  const freshnessDateTime = await freshnessTime.getAttribute('datetime')
  assert.ok(freshnessDateTime)
  assert.ok(Number.isFinite(Date.parse(freshnessDateTime)))
  assert.match(await freshnessTime.innerText(), /^View updated:/)

  const returnedUrl = new URL(page.url())
  assert.equal(
    `${returnedUrl.pathname}${returnedUrl.search}${returnedUrl.hash}`,
    returnPath,
  )
  assert.equal(authState.authenticated, true)

  await context.close()
}

async function testChineseLocale(browserInstance) {
  const context = await browserInstance.newContext({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  await installBackendMock(context, { authenticated: false })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto(`${BASE_URL}/`)
  await page.getByText(
    '把任意产品网站变成贴合品牌的海报，再按投放点追踪每一次扫码。',
    { exact: true },
  ).waitFor()
  assert.equal(
    await page.evaluate(() => document.documentElement.lang),
    'zh-CN',
  )
  assert.equal(await page.getByLabel('语言').inputValue(), 'zh-CN')
  assert.equal(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('posterlytics.workspace.v1')).locale
    ),
    'zh-CN',
  )

  await page.getByRole('link', { name: '登录', exact: true }).click()
  await page.getByRole('heading', { name: '登录', exact: true }).waitFor()
  await page.getByText('海报归因工作台', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('语言').inputValue(), 'zh-CN')
  assert.equal(
    await page.evaluate(() => document.documentElement.lang),
    'zh-CN',
  )
  assert.deepEqual(pageErrors, [])

  await page.screenshot({
    path: `${OUTPUT_DIR}/zh-CN-sign-in.png`,
    fullPage: true,
  })
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
        locale: 'en-US',
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
      await assertSamplePosterGeometry(
        page,
        `${mode.label} ${viewport.label}`,
      )
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
      if (authState.expired) {
        return json(route, {
          error: 'AUTH_TOKEN_EXPIRED',
          message: SESSION_EXPIRY_RAW_ERROR,
          statusCode: 401,
        }, 401)
      }
      return json(route, authState.authenticated
        ? { accessToken: 'marketing-ui-access-token', user: fixtures.user }
        : { user: null })
    }

    if (path === '/api/auth/sessions' && request.method() === 'POST') {
      if (authState.signInFailure === 'credentials') {
        return json(route, {
          error: 'AUTH_INVALID_CREDENTIALS',
          message: 'Invalid credentials',
        }, 401)
      }
      if (authState.signInFailure === 'network') {
        return route.abort('internetdisconnected')
      }
      authState.authenticated = true
      authState.expired = false
      return json(route, {
        accessToken: 'marketing-ui-access-token',
        user: fixtures.user,
      })
    }

    if (path === '/api/auth/email/send-reset-password' && request.method() === 'POST') {
      authState.resetCalls?.push({
        endpoint: 'send',
        body: request.postDataJSON(),
      })
      return json(route, {
        success: true,
        message: 'Reset code sent.',
      })
    }

    if (
      path === '/api/auth/email/exchange-reset-password-token'
      && request.method() === 'POST'
    ) {
      authState.resetCalls?.push({
        endpoint: 'exchange',
        body: request.postDataJSON(),
      })
      return json(route, {
        token: 'marketing-reset-token',
        expiresAt: '2026-07-18T19:00:00.000Z',
      })
    }

    if (path === '/api/auth/email/reset-password' && request.method() === 'POST') {
      authState.resetCalls?.push({
        endpoint: 'reset',
        body: request.postDataJSON(),
      })
      return json(route, { message: 'Password reset.' })
    }

    if (path === '/api/database/rpc/generation_activity') {
      if (authState.expired) {
        return json(route, {
          error: 'AUTH_UNAUTHORIZED',
          message: SESSION_EXPIRY_RPC_ERROR,
          statusCode: 401,
        }, 401)
      }
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
      if (
        request.method() === 'POST'
        && authState.campaignCreateFailure
      ) {
        return json(route, {
          code: 'PGRST000',
          details: null,
          hint: null,
          message: 'Backend campaign insert failed',
        }, 503)
      }
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
    use_case: 'website_product',
    platform_hint: null,
    event_details: null,
    current_generation_id: 'sample-generation',
    poster_format: 'a4_2x3',
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
    use_case: 'website_product',
    platform_hint: null,
    event_details: null,
    poster_format: 'a4_2x3',
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
    bots_filtered: 17,
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

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => {
    const root = document.scrollingElement
    return {
      clientWidth: root?.clientWidth ?? 0,
      scrollWidth: root?.scrollWidth ?? 0,
    }
  })

  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth,
    `${label} horizontal overflow: ${JSON.stringify(dimensions)}`,
  )
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
  await waitForLayout(page)
}

async function readHeroTextGeometry(page) {
  return page.evaluate(() => {
    const heading = document.querySelector('.public-hero h1')
    const copy = document.querySelector('.public-hero-copy')
    const stage = document.querySelector('.hero-poster-stage')
    if (
      !(heading instanceof HTMLElement)
      || !(copy instanceof HTMLElement)
      || !(stage instanceof HTMLElement)
    ) {
      throw new Error('Hero geometry elements are missing.')
    }

    const toRect = (rect) => ({
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
    })
    const headingRect = toRect(heading.getBoundingClientRect())
    const copyRect = toRect(copy.getBoundingClientRect())
    const stageRect = toRect(stage.getBoundingClientRect())
    const range = document.createRange()
    range.selectNodeContents(heading)
    const textRects = [...range.getClientRects()]
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map(toRect)
    const tolerance = 1
    const intersects = (left, right) =>
      Math.min(left.right, right.right) - Math.max(left.left, right.left) > tolerance
      && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > tolerance

    return {
      copyBottom: copyRect.bottom,
      documentScrollWidth: document.documentElement.scrollWidth,
      headingClientWidth: heading.clientWidth,
      headingScrollWidth: heading.scrollWidth,
      headingTextIntersectsStage: textRects.some((rect) => intersects(rect, stageRect)),
      headingTextWithinBox: textRects.every((rect) =>
        rect.left >= headingRect.left - tolerance
        && rect.right <= headingRect.right + tolerance
        && rect.top >= headingRect.top - tolerance
        && rect.bottom <= headingRect.bottom + tolerance
      ),
      stageTop: stageRect.top,
      textRects,
      viewportWidth: window.innerWidth,
    }
  })
}

async function waitForLayout(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  }))
}

async function assertElementsWithinViewport(page, selector, label) {
  const issues = await page.locator(selector).evaluateAll((elements) => {
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = window.innerHeight
    return elements.flatMap((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      if (
        style.display === 'none'
        || style.visibility === 'hidden'
        || rect.width <= 0
        || rect.height <= 0
      ) return []

      if (
        rect.left >= -0.5
        && rect.right <= viewportWidth + 0.5
        && rect.top >= -0.5
        && rect.bottom <= viewportHeight + 0.5
      ) return []
      const name = element.getAttribute('aria-label')
        || element.textContent?.trim()
        || element.className
        || element.tagName
      return [
        `${name}: x ${rect.left.toFixed(1)}-${rect.right.toFixed(1)}px, `
        + `y ${rect.top.toFixed(1)}-${rect.bottom.toFixed(1)}px`,
      ]
    })
  })

  assert.deepEqual(issues, [], `${label} outside viewport: ${issues.join('; ')}`)
}

async function assertMinimumHitTargets(page, selector, label) {
  const issues = await page.locator(selector).evaluateAll((elements) =>
    elements.flatMap((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      if (
        style.display === 'none'
        || style.visibility === 'hidden'
        || rect.width <= 0
        || rect.height <= 0
      ) return []

      if (rect.width >= 43.99 && rect.height >= 43.99) return []
      const name = element.getAttribute('aria-label')
        || element.textContent?.trim()
        || element.className
        || element.tagName
      return [`${name}: ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}px`]
    }),
  )

  assert.deepEqual(issues, [], `${label} below 44px: ${issues.join('; ')}`)
}

async function assertNoTargetIntersections(page, selector, label) {
  const intersections = await page.locator(selector).evaluateAll((elements) => {
    const targets = elements.flatMap((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      if (
        style.display === 'none'
        || style.visibility === 'hidden'
        || rect.width <= 0
        || rect.height <= 0
      ) return []

      return [{
        name: element.getAttribute('aria-label')
          || element.textContent?.trim()
          || element.className
          || element.tagName,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      }]
    })
    const overlaps = []

    for (let leftIndex = 0; leftIndex < targets.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < targets.length; rightIndex += 1) {
        const left = targets[leftIndex]
        const right = targets[rightIndex]
        const overlapWidth = Math.min(left.right, right.right) - Math.max(left.left, right.left)
        const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top)
        if (overlapWidth > 0.5 && overlapHeight > 0.5) {
          overlaps.push(`${left.name} / ${right.name}`)
        }
      }
    }

    return overlaps
  })

  assert.deepEqual(
    intersections,
    [],
    `${label} overlap: ${intersections.join('; ')}`,
  )
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

async function assertSamplePosterGeometry(page, label) {
  const issues = await page.locator('.sample-poster').evaluateAll((posters) =>
    posters.flatMap((poster, index) => {
      const copy = poster.querySelector('.sample-poster-copy')
      const text = copy?.firstElementChild
      const title = poster.querySelector('.sample-poster-title')
      const qr = poster.querySelector('.sample-poster-qr')
      const qrImage = qr?.querySelector('img')
      if (!copy || !text || !title || !qr || !qrImage) {
        return [`poster ${index + 1}: missing footer content`]
      }

      const style = getComputedStyle(copy)
      const verticalChrome = [
        style.paddingTop,
        style.paddingBottom,
        style.borderTopWidth,
        style.borderBottomWidth,
      ].reduce((total, value) => total + Number.parseFloat(value), 0)
      const requiredHeight = Math.ceil(
        Math.max(text.scrollHeight, qr.offsetHeight) + verticalChrome,
      )
      const context = poster.closest(
        '.hero-poster, .version-stack-item, .placement-fan-item, .public-auth-poster',
      )
      const name = `${context?.className || 'sample poster'} ${poster.getAttribute('aria-label')}`
      const posterIssues = []

      if (requiredHeight > copy.offsetHeight) {
        posterIssues.push(
          `${name}: footer ${copy.offsetHeight}px is below required ${requiredHeight}px`,
        )
      }
      if (title.scrollHeight > title.clientHeight) {
        posterIssues.push(
          `${name}: title clips at ${title.clientHeight}px/${title.scrollHeight}px`,
        )
      }
      if (getComputedStyle(qrImage).display !== 'block') {
        posterIssues.push(`${name}: QR image retains inline baseline spacing`)
      }

      return posterIssues
    })
  )

  assert.deepEqual(issues, [], `${label} sample poster geometry: ${issues.join('; ')}`)
}

async function json(route, value, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': BASE_URL,
      'access-control-allow-credentials': 'true',
    },
    body: JSON.stringify(value),
  })
}

async function waitForServer() {
  const deadline = Date.now() + 15_000
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

async function waitForFocused(page, selector) {
  await page.waitForFunction(
    (targetSelector) => (
      document.activeElement === document.querySelector(targetSelector)
    ),
    selector,
  )
}
