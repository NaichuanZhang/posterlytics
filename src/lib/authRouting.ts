export type AuthMode = 'signin' | 'signup'
export type SignInReason = 'session_expired'

const INTERNAL_ORIGIN = 'https://posterlytics.invalid'
const CSRF_COOKIE = 'insforge_csrf_token'

export function parseAuthMode(value: string | null | undefined): AuthMode {
  return value === 'signup' ? 'signup' : 'signin'
}

export function parseSignInReason(
  value: string | null | undefined,
): SignInReason | null {
  return value === 'session_expired' ? value : null
}

export function safeNextPath(
  value: string | null | undefined,
  fallback = '/',
): string {
  if (!value || value !== value.trim()) return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback

  try {
    const decoded = decodeURIComponent(value)
    if (
      decoded.startsWith('//')
      || decoded.includes('\\')
      || /[\u0000-\u001f\u007f]/.test(decoded)
    ) {
      return fallback
    }

    const target = new URL(value, INTERNAL_ORIGIN)
    if (target.origin !== INTERNAL_ORIGIN) return fallback
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return fallback
  }
}

export function signInPath(
  nextPath: string,
  mode: AuthMode = 'signin',
  reason?: SignInReason,
): string {
  const params = new URLSearchParams()
  if (mode === 'signup') params.set('mode', mode)
  params.set('next', safeNextPath(nextPath))
  if (reason) params.set('reason', reason)
  return `/signin?${params.toString()}`
}

export function hasAuthHydrationSignal(
  cookieHeader: string,
  search: string,
): boolean {
  const hasCsrfCookie = cookieHeader
    .split(';')
    .some((entry) => entry.trim().startsWith(`${CSRF_COOKIE}=`))
  if (hasCsrfCookie) return true

  return new URLSearchParams(search).has('insforge_code')
}

export function shouldLoadSessionApp(
  pathname: string,
  cookieHeader: string,
  search: string,
): boolean {
  return pathname !== '/' || hasAuthHydrationSignal(cookieHeader, search)
}
