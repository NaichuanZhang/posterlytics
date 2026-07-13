import { FUNCTIONS_HOST } from './insforge'

// The URL a placement's QR encodes — the public `view` function.
export function buildViewUrl(code: string): string {
  return `${FUNCTIONS_HOST}/view?code=${encodeURIComponent(code)}`
}
