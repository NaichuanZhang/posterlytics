import { forwardRef } from 'react'
import type { Campaign, PosterStyle } from '../lib/types'
import { SaasPoster } from './posters/SaasPoster'
import { CozyPoster } from './posters/CozyPoster'

interface Props {
  campaign: Campaign
  code: string // the placement code whose QR is embedded
  width?: number // rendered preview width in px (defaults to fit the editor column)
}

// The poster is rendered DETERMINISTICALLY as HTML/CSS at a native 1080×1620 (2:3),
// then scaled down to the requested preview width. Because the whole poster is real
// DOM, the QR is a real fixed-size <img> placeholder at a known anchor — it always
// fits, never mismatches an AI-drawn placeholder, and PNG export stays crisp. The
// chosen template (auto-selected by the analyzer) and the brand accent color drive
// the look. Use `forwardRef` so PosterExportButton can capture the full-res node.
const NATIVE_W = 1080
const NATIVE_H = 1620
const DEFAULT_PREVIEW_W = 440

export const Poster = forwardRef<HTMLDivElement, Props>(function Poster({ campaign, code, width = DEFAULT_PREVIEW_W }, ref) {
  const style: PosterStyle = campaign.poster_style === 'saas_glassmorphism' ? 'saas_glassmorphism' : 'cozy_scrapbook'
  const scale = width / NATIVE_W

  return (
    // Outer box occupies the SCALED footprint so layout flows normally; the inner
    // node renders at native size and is scaled via transform (kept for crisp QR).
    <div
      style={{
        width,
        height: NATIVE_H * scale,
        overflow: 'hidden',
        borderRadius: 8,
        boxShadow: '0 8px 30px rgba(0,0,0,0.16)',
      }}
    >
      <div
        style={{
          width: NATIVE_W,
          height: NATIVE_H,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {style === 'saas_glassmorphism' ? (
          <SaasPoster ref={ref} campaign={campaign} code={code} />
        ) : (
          <CozyPoster ref={ref} campaign={campaign} code={code} />
        )}
      </div>
    </div>
  )
})
