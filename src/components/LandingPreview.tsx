import { useMemo } from 'react'
import type { Campaign } from '../lib/types'
import { inertLandingHtml } from '../lib/landingHtml'

interface Props {
  campaign: Campaign
  width?: number // rendered preview width in px (defaults to fit the editor column)
}

// The generated landing page is a full HTML document (campaign.landing_html). We
// preview it in a sandboxed <iframe srcDoc> rendered at a fixed native width and
// scaled down with transform — the same outer-footprint / inner-native idiom as
// Poster.tsx (a landing is variable-height, so we give it a tall native canvas
// and let the iframe scroll within the scaled frame).
//
// CRITICAL: we render the INERT form — the tracked CTA becomes '#' and the geo
// beacon is stripped — so previewing never logs a scan or navigates to /convert.
const NATIVE_W = 680 // matches view.ts .wrap max-width
const NATIVE_H = 1180 // tall canvas; the iframe scrolls if the page is longer
const DEFAULT_PREVIEW_W = 440

export function LandingPreview({ campaign, width = DEFAULT_PREVIEW_W }: Props) {
  const srcDoc = useMemo(() => inertLandingHtml(campaign.landing_html), [campaign.landing_html])
  const scale = width / NATIVE_W

  if (!campaign.landing_html) {
    return (
      <div
        style={{
          width,
          height: NATIVE_H * scale,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 8,
          border: '1px dashed var(--border, rgba(0,0,0,0.18))',
          background: 'var(--panel-2)',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <p className="muted" style={{ fontSize: '0.88rem', maxWidth: 240 }}>
          Landing page not generated yet.
          <br />
          Use <strong>Regenerate landing</strong> to create an on-brand page from your site's design.
        </p>
      </div>
    )
  }

  return (
    <div
      style={{
        width,
        height: NATIVE_H * scale,
        overflow: 'hidden',
        borderRadius: 8,
        boxShadow: '0 8px 30px rgba(0,0,0,0.16)',
        background: '#fff',
      }}
    >
      <iframe
        title="Landing page preview"
        srcDoc={srcDoc}
        // Sandbox WITHOUT allow-scripts: the inert HTML carries no JS, and this
        // hard-blocks any script even if one slipped through sanitization.
        sandbox=""
        scrolling="no"
        style={{
          width: NATIVE_W,
          height: NATIVE_H,
          border: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none', // preview is non-interactive
        }}
      />
    </div>
  )
}
