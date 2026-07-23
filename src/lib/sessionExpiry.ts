const SESSION_EXPIRED_CODES = new Set([
  'AUTH_UNAUTHORIZED',
  'AUTH_TOKEN_EXPIRED',
])

const CREDENTIAL_ERROR_CODES = new Set([
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_INVALID_PASSWORD',
  'INVALID_CREDENTIALS',
])

const MISSING_REFRESH_MESSAGE =
  /^(?:No refresh token provided|Refresh token cookie is missing)\.?$/
const CREDENTIAL_ERROR_MESSAGE =
  /^(?:Invalid credentials|Invalid email or password)\.?$/i

type SessionExpiryListener = () => void

const listeners = new Set<SessionExpiryListener>()
let expiryActive = false
let expiryPending = false
let publishing = false

export function isSessionExpiredError(error: unknown): boolean {
  if (typeof error === 'string') {
    const value = error.trim()
    return SESSION_EXPIRED_CODES.has(value) || MISSING_REFRESH_MESSAGE.test(value)
  }
  if (!error || typeof error !== 'object') return false

  const record = error as Record<string, unknown>
  const code = stringValue(record.error) ?? stringValue(record.code)
  const message = error instanceof Error
    ? error.message.trim()
    : stringValue(record.message)?.trim()

  if (
    (code && CREDENTIAL_ERROR_CODES.has(code))
    || (message && CREDENTIAL_ERROR_MESSAGE.test(message))
  ) {
    return false
  }
  if (code && SESSION_EXPIRED_CODES.has(code)) return true
  if (message && MISSING_REFRESH_MESSAGE.test(message)) return true

  const status = numberValue(record.statusCode) ?? numberValue(record.status)
  return status === 401
}

export function subscribeToSessionExpiry(
  listener: SessionExpiryListener,
): () => void {
  listeners.add(listener)
  if (expiryPending && !publishing) notifyListener(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function publishSessionExpired(): void {
  if (expiryActive) return
  expiryActive = true
  expiryPending = true
  publishing = true
  try {
    for (const listener of [...listeners]) notifyListener(listener)
  } finally {
    publishing = false
  }
}

export function consumeSessionExpired(): boolean {
  if (!expiryPending) return false
  expiryPending = false
  return true
}

export function clearSessionExpiry(): void {
  expiryActive = false
  expiryPending = false
  publishing = false
}

function notifyListener(listener: SessionExpiryListener): void {
  try {
    listener()
  } catch {
    // Session observation must never change the SDK fetch result.
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
