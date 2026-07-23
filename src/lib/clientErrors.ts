export type AppErrorKind = 'connection' | 'unexpected'

export interface ClientErrorDetails {
  code: string
  name: string
  message: string
  statusCode: number | null
}

interface ClientErrorLike {
  code?: unknown
  error?: unknown
  message?: unknown
  name?: unknown
  status?: unknown
  statusCode?: unknown
}

const OFFLINE_ERROR_CODES = new Set([
  'NETWORK_ERROR',
  'REQUEST_TIMEOUT',
])

const OFFLINE_MESSAGE_PATTERN =
  /network request failed|failed to fetch|fetch failed|networkerror|load failed|request timed out|internet disconnected|connection (?:failed|refused)/i

const CHUNK_LOAD_MESSAGE_PATTERN =
  /loading chunk \S+ failed|failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i

export function readClientError(error: unknown): ClientErrorDetails {
  if (!error || typeof error !== 'object') {
    return {
      code: '',
      name: '',
      message: typeof error === 'string' ? error : '',
      statusCode: null,
    }
  }

  const candidate = error as ClientErrorLike
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
    name: typeof candidate.name === 'string' ? candidate.name : '',
    message: typeof candidate.message === 'string' ? candidate.message : '',
    statusCode,
  }
}

export function isOfflineLikeError(error: unknown): boolean {
  const details = readClientError(error)
  return (
    OFFLINE_ERROR_CODES.has(details.code)
    || details.statusCode === 0
    || OFFLINE_MESSAGE_PATTERN.test(details.message)
  )
}

export function isChunkLoadError(error: unknown): boolean {
  const details = readClientError(error)
  return (
    details.name.toLowerCase() === 'chunkloaderror'
    || CHUNK_LOAD_MESSAGE_PATTERN.test(details.message)
  )
}

export function classifyAppError(
  error: unknown,
  online: boolean | undefined,
): AppErrorKind {
  // Chunk errors can also match "failed to fetch"; connectivity owns the copy.
  if (isChunkLoadError(error)) {
    return online === false ? 'connection' : 'unexpected'
  }
  if (online === false || isOfflineLikeError(error)) return 'connection'
  return 'unexpected'
}
