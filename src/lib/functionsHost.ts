// Where the public edge functions are served.
//
// This was a bare literal inside insforge.ts, which made the provider's function
// domain unchangeable without a code edit — and that domain is not stable. Deno
// Deploy Classic (`<appkey>.functions.insforge.app`) was sunset on 2026-07-20 and
// its replacement serves on `<appkey>.function2.insforge.app`, so every edge
// function 404'd with no way to repoint the SPA except a rebuild.
//
// `VITE_INSFORGE_FUNCTIONS_HOST` now takes precedence so the host can be moved by
// configuration. The derived default is unchanged, so existing deployments behave
// exactly as before until the override is set.
//
// NOTE: this host is baked into every minted QR code via buildViewUrl, so moving
// it does NOT repair posters already printed against the old host. See
// docs/decisions/2026-07-31-configurable-functions-host.md.

const FUNCTIONS_HOST_SUBDOMAIN = 'functions.insforge.app'

/**
 * Resolves the functions host from an explicit override, else derives it from the
 * API base URL. Pure so the precedence is testable without a browser or a build.
 * Returns '' when neither source yields a usable host — callers already treat an
 * empty host as "functions unavailable" rather than building a broken URL.
 */
export function resolveFunctionsHost({
  override,
  baseUrl,
}: {
  override?: string | null
  baseUrl?: string | null
}): string {
  const explicit = normalizeHostOverride(override)
  if (explicit) return explicit
  if (!baseUrl) return ''
  try {
    const appkey = new URL(baseUrl).host.split('.')[0]
    return appkey ? `https://${appkey}.${FUNCTIONS_HOST_SUBDOMAIN}` : ''
  } catch {
    return ''
  }
}

/**
 * Accepts a bare host ('x.function2.insforge.app') or a full origin, and returns
 * a scheme-qualified origin with no trailing slash. Anything that is not a valid
 * absolute HTTPS/HTTP origin is rejected rather than concatenated into a URL.
 */
function normalizeHostOverride(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return ''
  // Only a bare host may be promoted to https. Testing for '://' is not enough:
  // 'file:///etc/passwd' and 'javascript:alert(1)' carry a scheme without an
  // authority, so prepending https would have yielded the plausible-looking
  // 'https://file'. Any scheme-prefixed value must therefore stand on its own
  // and be accepted only if that scheme is HTTP(S).
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
  const candidate = hasScheme ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    if (!url.hostname) return ''
    return url.origin
  } catch {
    return ''
  }
}
