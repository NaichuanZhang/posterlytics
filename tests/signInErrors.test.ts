import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifySignInError } from '../src/lib/signInErrors.ts'

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
  assert.equal(
    classifySignInError({
      error: 'AUTH_NEED_VERIFICATION',
      message: 'Email verification required',
      statusCode: 403,
    }),
    'unknown',
  )
  assert.equal(classifySignInError(null), 'unknown')
})
