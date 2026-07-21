import { sanitizeAmazonProductTitle } from './amazonProduct'

export type AmazonProductLookupResponse =
  | { status: 'found'; title: string }
  | { status: 'unavailable' }

export interface AmazonProductLookupErrorBody {
  code: string
  message: string
  retryable: boolean
}

export class AmazonProductLookupRequestError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly status: number

  constructor(error: AmazonProductLookupErrorBody, status: number) {
    super(error.message)
    this.name = 'AmazonProductLookupRequestError'
    this.code = error.code
    this.retryable = error.retryable
    this.status = status
  }
}

export type AmazonProductLookupTransport = (
  init: RequestInit,
) => Promise<Response>

export async function lookupAmazonProductTitle({
  url,
  signal,
  transport = defaultTransport,
}: {
  url: string
  signal?: AbortSignal
  transport?: AmazonProductLookupTransport
}): Promise<AmazonProductLookupResponse> {
  const response = await transport({
    method: 'POST',
    signal,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  })
  const payload = await response.json().catch(() => null) as unknown
  if (!response.ok) {
    throw new AmazonProductLookupRequestError(
      responseError(payload, response.status),
      response.status,
    )
  }
  return normalizeResponse(payload)
}

async function defaultTransport(init: RequestInit): Promise<Response> {
  const { FUNCTIONS_HOST, insforge } = await import('./insforge')
  if (!FUNCTIONS_HOST) {
    throw clientFailure('functions_unavailable', 503)
  }
  return await insforge.getHttpClient().rawFetch(
    `${FUNCTIONS_HOST}/amazon-product-lookup`,
    init,
  )
}

function normalizeResponse(value: unknown): AmazonProductLookupResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidResponseError()
  }
  const record = value as Record<string, unknown>
  if (record.status === 'unavailable') return { status: 'unavailable' }
  if (record.status === 'found') {
    const title = sanitizeAmazonProductTitle(record.title)
    if (title) return { status: 'found', title }
  }
  throw invalidResponseError()
}

function responseError(
  value: unknown,
  status: number,
): AmazonProductLookupErrorBody {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const error = (value as Record<string, unknown>).error
    if (error && typeof error === 'object' && !Array.isArray(error)) {
      const record = error as Record<string, unknown>
      if (
        typeof record.code === 'string'
        && typeof record.message === 'string'
      ) {
        return {
          code: record.code,
          message: record.message,
          retryable: record.retryable === true,
        }
      }
    }
  }
  return {
    code: status === 429 ? 'rate_limited' : 'lookup_request_failed',
    message: status.toString(),
    retryable: status === 429 || status >= 500,
  }
}

function invalidResponseError(): AmazonProductLookupRequestError {
  return clientFailure('invalid_amazon_product_lookup_response', 502)
}

function clientFailure(
  code: string,
  status: number,
): AmazonProductLookupRequestError {
  return new AmazonProductLookupRequestError({
    code,
    message: code,
    retryable: true,
  }, status)
}
