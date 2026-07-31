import { createClient } from '@insforge/sdk'
import { resolveFunctionsHost } from './functionsHost'
import {
  isSessionExpiredError,
  publishSessionExpired,
} from './sessionExpiry'

const INSFORGE_BASE_URL = import.meta.env.VITE_INSFORGE_URL

const sessionAwareFetch: typeof fetch = async (input, init) => {
  const response = await globalThis.fetch(input, init)
  try {
    const requestUrl = typeof input === 'string' || input instanceof URL
      ? input.toString()
      : input.url
    const pathname = new URL(requestUrl, INSFORGE_BASE_URL).pathname
    if (
      pathname === '/api/auth/refresh'
      && (response.status === 401 || response.status === 403)
      && isSessionExpiredError({
        error: response.status === 401
          ? 'AUTH_UNAUTHORIZED'
          : 'AUTH_TOKEN_EXPIRED',
        statusCode: response.status,
      })
    ) {
      publishSessionExpired()
    }
  } catch {
    // URL observation must not alter the original SDK response.
  }
  return response
}

// Single shared InsForge client for the whole SPA. The access token lives in
// memory; the refresh token is an httpOnly cookie the SDK uses on cold loads.
export const insforge = createClient({
  baseUrl: INSFORGE_BASE_URL,
  anonKey: import.meta.env.VITE_INSFORGE_ANON_KEY,
  fetch: sessionAwareFetch,
})

// Base host where the public edge functions are served. Overridable by config
// because the provider's function domain is not stable — see functionsHost.ts.
export const FUNCTIONS_HOST = resolveFunctionsHost({
  override: import.meta.env.VITE_INSFORGE_FUNCTIONS_HOST,
  baseUrl: INSFORGE_BASE_URL,
})
