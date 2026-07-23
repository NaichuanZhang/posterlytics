import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hasAuthHydrationSignal,
  parseAuthMode,
  parseSignInReason,
  safeNextPath,
  shouldLoadSessionApp,
  signInPath,
} from '../src/lib/authRouting.ts'

test('auth mode accepts signup and defaults every other value to signin', () => {
  assert.equal(parseAuthMode('signup'), 'signup')
  assert.equal(parseAuthMode('signin'), 'signin')
  assert.equal(parseAuthMode('SIGNUP'), 'signin')
  assert.equal(parseAuthMode(null), 'signin')
})

test('sign in reason accepts only the session expiry allowlist value', () => {
  assert.equal(parseSignInReason('session_expired'), 'session_expired')
  assert.equal(parseSignInReason('SESSION_EXPIRED'), null)
  assert.equal(parseSignInReason('signed_out'), null)
  assert.equal(parseSignInReason(''), null)
  assert.equal(parseSignInReason(null), null)
})

test('safe next paths preserve internal path, query, and hash values', () => {
  assert.equal(
    safeNextPath('/campaigns/launch/analytics?range=30d#countries'),
    '/campaigns/launch/analytics?range=30d#countries',
  )
  assert.equal(safeNextPath('/campaigns/new'), '/campaigns/new')
})

test('safe next paths reject external and browser-normalized escape values', () => {
  const unsafeValues = [
    'https://example.com',
    '//example.com/path',
    '/%2f%2fexample.com',
    '/\\example.com',
    '/%5cexample.com',
    'javascript:alert(1)',
    ' /campaigns/new',
    '/campaigns/new\n',
    '%2Fcampaigns%2Fnew',
  ]

  for (const value of unsafeValues) {
    assert.equal(safeNextPath(value), '/', value)
  }
})

test('sign in paths encode the validated internal destination', () => {
  assert.equal(
    signInPath('/campaigns/launch/placements?view=grid'),
    '/signin?next=%2Fcampaigns%2Flaunch%2Fplacements%3Fview%3Dgrid',
  )
  assert.equal(
    signInPath('/campaigns/new', 'signup'),
    '/signin?mode=signup&next=%2Fcampaigns%2Fnew',
  )
  assert.equal(signInPath('https://example.com'), '/signin?next=%2F')
})

test('sign in paths append an optional reason after mode and encoded next', () => {
  assert.equal(
    signInPath(
      '/campaigns/launch/analytics?range=30d#countries',
      'signin',
      'session_expired',
    ),
    '/signin?next=%2Fcampaigns%2Flaunch%2Fanalytics%3Frange%3D30d%23countries&reason=session_expired',
  )
  assert.equal(
    signInPath('/campaigns/new', 'signup', 'session_expired'),
    '/signin?mode=signup&next=%2Fcampaigns%2Fnew&reason=session_expired',
  )
})

test('sign in paths without a reason remain byte-compatible', () => {
  assert.equal(
    signInPath('/campaigns/launch/placements?view=grid'),
    '/signin?next=%2Fcampaigns%2Flaunch%2Fplacements%3Fview%3Dgrid',
  )
  assert.equal(
    signInPath('/campaigns/new', 'signup'),
    '/signin?mode=signup&next=%2Fcampaigns%2Fnew',
  )
})

test('auth hydration runs only when a session or OAuth callback is present', () => {
  assert.equal(hasAuthHydrationSignal('', ''), false)
  assert.equal(hasAuthHydrationSignal('theme=dark', '?next=%2Fcampaigns'), false)
  assert.equal(
    hasAuthHydrationSignal('theme=dark; insforge_csrf_token=csrf-value', ''),
    true,
  )
  assert.equal(hasAuthHydrationSignal('', '?insforge_code=oauth-code'), true)
})

test('the session app is skipped only for a confirmed guest home route', () => {
  assert.equal(shouldLoadSessionApp('/', '', ''), false)
  assert.equal(
    shouldLoadSessionApp('/', 'insforge_csrf_token=csrf-value', ''),
    true,
  )
  assert.equal(shouldLoadSessionApp('/', '', '?insforge_code=oauth-code'), true)
  assert.equal(shouldLoadSessionApp('/signin', '', ''), true)
  assert.equal(shouldLoadSessionApp('/campaigns/new', '', ''), true)
})
