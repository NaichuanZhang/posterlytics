import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clearSessionExpiry,
  consumeSessionExpired,
  isSessionExpiredError,
  publishSessionExpired,
  subscribeToSessionExpiry,
} from '../src/lib/sessionExpiry.ts'

test('session expiry classifier accepts terminal auth codes', () => {
  assert.equal(isSessionExpiredError({ error: 'AUTH_UNAUTHORIZED' }), true)
  assert.equal(isSessionExpiredError({ code: 'AUTH_TOKEN_EXPIRED' }), true)
})

test('session expiry classifier accepts structural InsForge 401 errors', () => {
  assert.equal(isSessionExpiredError({
    name: 'InsForgeError',
    statusCode: 401,
    error: 'UNKNOWN_ERROR',
    message: 'Authentication is required.',
  }), true)
  assert.equal(isSessionExpiredError({ status: 401 }), true)
})

test('session expiry classifier accepts only anchored missing-refresh messages', () => {
  assert.equal(isSessionExpiredError(new Error('No refresh token provided')), true)
  assert.equal(
    isSessionExpiredError({ message: 'Refresh token cookie is missing' }),
    true,
  )
  assert.equal(
    isSessionExpiredError(new Error('Request failed: No refresh token provided')),
    false,
  )
})

test('session expiry classifier rejects unrelated and credential failures', () => {
  assert.equal(isSessionExpiredError(new TypeError('Failed to fetch')), false)
  assert.equal(isSessionExpiredError(new Error('Something went wrong')), false)
  assert.equal(isSessionExpiredError({
    statusCode: 403,
    error: 'AUTH_FORBIDDEN',
    message: 'Not allowed.',
  }), false)
  assert.equal(isSessionExpiredError({
    statusCode: 401,
    error: 'AUTH_INVALID_CREDENTIALS',
    message: 'Invalid credentials',
  }), false)
})

test('session expiry publication is idempotent until explicitly cleared', () => {
  clearSessionExpiry()
  let notifications = 0
  const unsubscribe = subscribeToSessionExpiry(() => {
    notifications += 1
  })

  try {
    publishSessionExpired()
    publishSessionExpired()
    assert.equal(notifications, 1)
    assert.equal(consumeSessionExpired(), true)
    assert.equal(consumeSessionExpired(), false)

    publishSessionExpired()
    assert.equal(notifications, 1)

    clearSessionExpiry()
    publishSessionExpired()
    assert.equal(notifications, 2)
  } finally {
    unsubscribe()
    clearSessionExpiry()
  }
})

test('session expiry publication remains sticky until a subscriber consumes it', () => {
  clearSessionExpiry()
  publishSessionExpired()

  let notifications = 0
  const unsubscribe = subscribeToSessionExpiry(() => {
    notifications += 1
  })

  try {
    assert.equal(notifications, 1)
    assert.equal(consumeSessionExpired(), true)

    let lateNotifications = 0
    const unsubscribeLate = subscribeToSessionExpiry(() => {
      lateNotifications += 1
    })
    unsubscribeLate()
    assert.equal(lateNotifications, 0)
  } finally {
    unsubscribe()
    clearSessionExpiry()
  }
})

test('session expiry subscriptions stop notifying after unsubscribe', () => {
  clearSessionExpiry()
  let notifications = 0
  const unsubscribe = subscribeToSessionExpiry(() => {
    notifications += 1
  })
  unsubscribe()

  publishSessionExpired()
  assert.equal(notifications, 0)
  clearSessionExpiry()
})

test('session expiry publication uses a listener snapshot during mutation', () => {
  clearSessionExpiry()
  const calls: string[] = []
  let unsubscribeSecond = () => {}
  let unsubscribeThird = () => {}
  let thirdSubscribed = false

  const unsubscribeFirst = subscribeToSessionExpiry(() => {
    calls.push('first')
    unsubscribeSecond()
    if (!thirdSubscribed) {
      thirdSubscribed = true
      unsubscribeThird = subscribeToSessionExpiry(() => {
        calls.push('third')
      })
    }
  })
  unsubscribeSecond = subscribeToSessionExpiry(() => {
    calls.push('second')
  })

  try {
    publishSessionExpired()
    assert.deepEqual(calls, ['first', 'second'])

    clearSessionExpiry()
    publishSessionExpired()
    assert.deepEqual(calls, ['first', 'second', 'first', 'third'])
  } finally {
    unsubscribeFirst()
    unsubscribeSecond()
    unsubscribeThird()
    clearSessionExpiry()
  }
})
