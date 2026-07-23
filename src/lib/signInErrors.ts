import {
  isOfflineLikeError,
  readClientError,
} from './clientErrors'

export type SignInErrorKind = 'credentials' | 'offline' | 'unknown'

const CREDENTIAL_ERROR_CODES = new Set([
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_USER_NOT_FOUND',
  'INVALID_CREDENTIALS',
])

export function classifySignInError(error: unknown): SignInErrorKind {
  const details = readClientError(error)
  if (
    CREDENTIAL_ERROR_CODES.has(details.code)
    || details.statusCode === 401
    || /invalid (?:login )?credentials|invalid email or password|incorrect email or password/i
      .test(details.message)
  ) {
    return 'credentials'
  }

  if (isOfflineLikeError(error)) return 'offline'

  return 'unknown'
}
