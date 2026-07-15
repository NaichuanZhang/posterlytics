import { createClient } from '@insforge/sdk'

// Single shared InsForge client for the whole SPA. The access token lives in
// memory; the refresh token is an httpOnly cookie the SDK uses on cold loads.
export const insforge = createClient({
  baseUrl: import.meta.env.VITE_INSFORGE_URL,
  anonKey: import.meta.env.VITE_INSFORGE_ANON_KEY,
})

// Base host where the public edge functions are served.
// Derived from the API base: <appkey>.<region>.insforge.app -> <appkey>.functions.insforge.app
export const FUNCTIONS_HOST = (() => {
  try {
    const appkey = new URL(import.meta.env.VITE_INSFORGE_URL).host.split('.')[0]
    return `https://${appkey}.functions.insforge.app`
  } catch {
    return ''
  }
})()
