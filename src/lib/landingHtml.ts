// Generated-landing placeholder handling, SPA side. Mirrors the pure helpers in
// functions/_shared.ts (Deno bundle can't be imported here). The functions side
// owns sanitize + live injection for serving; this copy provides INERT injection
// for the editor preview (so previewing never fires a real scan/convert) and is
// the unit-tested reference for the placeholder contract.

export const CTA_PLACEHOLDER = '{{CTA_HREF}}'
export const BEACON_PLACEHOLDER = '{{SCAN_BEACON}}'

// Render stored landing HTML safely for PREVIEW: the tracked CTA becomes inert
// ('#') and the geo-beacon placeholder is removed, so the iframe shows the real
// design without logging a scan or allowing navigation to /convert.
export function inertLandingHtml(html: string | null | undefined): string {
  if (!html) return ''
  let out = html.split(CTA_PLACEHOLDER).join('#')
  out = out.split(`<!--${BEACON_PLACEHOLDER}-->`).join('')
  out = out.split(BEACON_PLACEHOLDER).join('')
  return out
}

// True if the HTML still carries the CTA placeholder (i.e. it's a generated
// landing produced by our agent, not arbitrary content).
export function hasCtaPlaceholder(html: string | null | undefined): boolean {
  return !!html && html.includes(CTA_PLACEHOLDER)
}
