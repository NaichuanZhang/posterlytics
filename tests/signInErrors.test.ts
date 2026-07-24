import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enUS } from '../src/i18n/messages.ts'
import {
  classifySignInError,
  getSignInErrorPresentation,
  SIGN_IN_ERROR_KINDS,
} from '../src/lib/signInErrors.ts'

test('sign-in errors classify credential failures without depending on SDK copy', () => {
  for (const error of [
    { error: 'AUTH_INVALID_CREDENTIALS', statusCode: 401 },
    { code: 'INVALID_CREDENTIALS', status: 401 },
    { error: 'AUTH_USER_NOT_FOUND', statusCode: 404 },
    new Error('Invalid login credentials'),
  ]) {
    assert.equal(classifySignInError(error), 'credentials')
  }
})

test('sign-in errors classify duplicate accounts while preserving credential precedence', () => {
  for (const error of [
    { error: 'AUTH_EMAIL_EXISTS' },
    { error: 'DATABASE_DUPLICATE' },
    { error: 'ALREADY_EXISTS' },
  ]) {
    assert.equal(classifySignInError(error), 'email_exists')
  }

  assert.equal(
    classifySignInError({ error: 'AUTH_EMAIL_EXISTS', statusCode: 409 }),
    'email_exists',
  )
  assert.equal(
    classifySignInError({ error: 'AUTH_EMAIL_EXISTS', statusCode: 401 }),
    'credentials',
  )
})

test('sign-in errors classify code-based and HTTP rate limits', () => {
  assert.equal(
    classifySignInError({ error: 'TOO_MANY_REQUESTS', statusCode: 400 }),
    'rate_limited',
  )
  assert.equal(
    classifySignInError({ error: 'RATE_LIMITED', statusCode: 503 }),
    'rate_limited',
  )
  assert.equal(
    classifySignInError({ error: 'UNKNOWN_ERROR', statusCode: 429 }),
    'rate_limited',
  )
})

test('sign-in errors classify coded and code-less password-policy failures', () => {
  assert.equal(
    classifySignInError({ error: 'AUTH_WEAK_PASSWORD' }),
    'weak_password',
  )
  assert.equal(
    classifySignInError({
      message: 'Password requirement was rejected',
    }),
    'weak_password',
  )
})

test('sign-in errors classify SDK and browser transport failures as offline', () => {
  for (const error of [
    {
      error: 'NETWORK_ERROR',
      message: 'Network request failed: Failed to fetch',
      statusCode: 0,
    },
    {
      code: 'REQUEST_TIMEOUT',
      message: 'Request timed out after 30000ms',
      statusCode: 408,
    },
    new TypeError('Failed to fetch'),
    new Error('NetworkError when attempting to fetch resource.'),
  ]) {
    assert.equal(classifySignInError(error), 'offline')
  }
})

test('sign-in errors leave unrelated failures in the app-authored fallback', () => {
  for (const error of [
    {
      error: 'AUTH_NEED_VERIFICATION',
      message: 'Email verification required',
      statusCode: 403,
    },
    { error: 'AUTH_INVALID_EMAIL', statusCode: 400 },
    { error: 'AUTH_SIGNUP_DISABLED', statusCode: 403 },
    null,
  ]) {
    assert.equal(classifySignInError(error), 'unknown')
  }
})

test('sign-in error presentations are exhaustive and keep sign-in email-safe', () => {
  for (const mode of ['signin', 'signup'] as const) {
    for (const kind of SIGN_IN_ERROR_KINDS) {
      const presentation = getSignInErrorPresentation(kind, mode)
      assert.ok(presentation)
      assert.ok(enUS[presentation.messageKey].trim())
      assert.equal(Array.isArray(presentation.actions), true)
    }
  }

  assert.deepEqual(
    getSignInErrorPresentation('email_exists', 'signup'),
    {
      messageKey: 'An account with this email is already registered. Sign in or reset your password.',
      actions: ['sign_in', 'forgot_password'],
    },
  )

  const signInDuplicate = getSignInErrorPresentation('email_exists', 'signin')
  assert.equal(signInDuplicate.messageKey, 'Invalid email or password.')
  assert.equal(signInDuplicate.actions.includes('sign_in'), false)
})
