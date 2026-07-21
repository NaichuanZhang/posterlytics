import { FUNCTIONS_HOST, insforge } from './insforge'

export interface CapturePreviewError {
  code: string
  message: string
  retryable: boolean
}

export interface CapturePreview {
  sourceUrl: string
  styleBoardDataUrl: string | null
  logoUrl: string | null
  imageUrls: string[]
  colors: string[]
  fonts: string[]
}

export interface CapturePreviewResponse {
  preview: CapturePreview
  error: CapturePreviewError | null
}

export class CapturePreviewRequestError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly status: number

  constructor(error: CapturePreviewError, status: number) {
    super(error.message)
    this.name = 'CapturePreviewRequestError'
    this.code = error.code
    this.retryable = error.retryable
    this.status = status
  }
}

export async function captureWebsitePreview({
  url,
  colorScheme,
  signal,
}: {
  url: string
  colorScheme: 'light' | 'dark'
  signal?: AbortSignal
}): Promise<CapturePreviewResponse> {
  if (!FUNCTIONS_HOST) {
    throw clientFailure('functions_unavailable', 503)
  }

  // SDK 1.3.1 rawFetch uses the same token manager as auth/functions, adds
  // the current bearer, refreshes it on expiry, and forwards this signal.
  const response = await insforge.getHttpClient().rawFetch(
    `${FUNCTIONS_HOST}/capture-preview`,
    {
      method: 'POST',
      signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        use_case: 'website_product',
        color_scheme: colorScheme,
      }),
    },
  )
  const payload = await response.json().catch(() => null) as unknown
  if (!response.ok) {
    throw new CapturePreviewRequestError(
      responseError(payload, response.status),
      response.status,
    )
  }

  return normalizeCapturePreviewResponse(payload)
}

function normalizeCapturePreviewResponse(value: unknown): CapturePreviewResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidResponseError()
  }
  const record = value as Record<string, unknown>
  if (!record.preview || typeof record.preview !== 'object' || Array.isArray(record.preview)) {
    throw invalidResponseError()
  }
  const preview = record.preview as Record<string, unknown>
  if (typeof preview.sourceUrl !== 'string') {
    throw invalidResponseError()
  }

  return {
    preview: {
      sourceUrl: preview.sourceUrl,
      styleBoardDataUrl: optionalString(preview.styleBoardDataUrl),
      logoUrl: optionalString(preview.logoUrl),
      imageUrls: stringArray(preview.imageUrls),
      colors: stringArray(preview.colors),
      fonts: stringArray(preview.fonts),
    },
    error: normalizeError(record.error),
  }
}

function responseError(value: unknown, status: number): CapturePreviewError {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const error = normalizeError((value as Record<string, unknown>).error)
    if (error) return error
  }
  return {
    code: 'capture_preview_request_failed',
    message: status.toString(),
    retryable: status >= 500,
  }
}

function normalizeError(value: unknown): CapturePreviewError | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const error = value as Record<string, unknown>
  if (typeof error.code !== 'string' || typeof error.message !== 'string') return null
  return {
    code: error.code,
    message: error.message,
    retryable: error.retryable === true,
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function invalidResponseError(): CapturePreviewRequestError {
  return clientFailure('invalid_capture_preview_response', 502)
}

export function toCapturePreviewError(cause: unknown): CapturePreviewError {
  if (cause instanceof CapturePreviewRequestError) {
    return {
      code: cause.code,
      message: cause.message,
      retryable: cause.retryable,
    }
  }
  return {
    code: 'capture_preview_request_failed',
    message: cause instanceof Error ? cause.message : '',
    retryable: true,
  }
}

function clientFailure(
  code: string,
  status: number,
): CapturePreviewRequestError {
  return new CapturePreviewRequestError({
    code,
    message: code,
    retryable: true,
  }, status)
}
