export type SignInErrorKind = 'credentials' | 'offline' | 'unknown'

interface SignInErrorLike {
  code?: unknown
  error?: unknown
  message?: unknown
  status?: unknown
  statusCode?: unknown
}

const CREDENTIAL_ERROR_CODES = new Set([
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_USER_NOT_FOUND',
  'INVALID_CREDENTIALS',
])

const OFFLINE_ERROR_CODES = new Set([
  'NETWORK_ERROR',
  'REQUEST_TIMEOUT',
])

export function classifySignInError(error: unknown): SignInErrorKind {
  const details = errorDetails(error)
  if (
    CREDENTIAL_ERROR_CODES.has(details.code)
    || details.statusCode === 401
    || /invalid (?:login )?credentials|invalid email or password|incorrect email or password/i
      .test(details.message)
  ) {
    return 'credentials'
  }

  if (
    OFFLINE_ERROR_CODES.has(details.code)
    || details.statusCode === 0
    || /network request failed|failed to fetch|fetch failed|networkerror|load failed|request timed out|internet disconnected|connection (?:failed|refused)/i
      .test(details.message)
  ) {
    return 'offline'
  }

  return 'unknown'
}

function errorDetails(error: unknown): {
  code: string
  message: string
  statusCode: number | null
} {
  if (!error || typeof error !== 'object') {
    return {
      code: '',
      message: typeof error === 'string' ? error : '',
      statusCode: null,
    }
  }

  const candidate = error as SignInErrorLike
  const code = typeof candidate.error === 'string'
    ? candidate.error
    : typeof candidate.code === 'string'
      ? candidate.code
      : ''
  const statusCode = typeof candidate.statusCode === 'number'
    ? candidate.statusCode
    : typeof candidate.status === 'number'
      ? candidate.status
      : null

  return {
    code,
    message: typeof candidate.message === 'string' ? candidate.message : '',
    statusCode,
  }
}
