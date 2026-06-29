import { forwardRef } from 'react'
import type { Campaign } from '../lib/types'
import { AiPoster } from './posters/AiPoster'

interface Props {
  campaign: Campaign
  code: string // the placement code whose QR is embedded
  width?: number // rendered preview width in px (defaults to fit the editor column)
}

// The poster is the AI-painted hero image rendered at a native 1080×1620 (2:3),
// then scaled down to the requested preview width. AiPoster letterboxes the model
// image into the top region and composites a real, fixed-size QR <img> into a
// branded bottom band — so the QR is crisp and always scannable regardless of what
// the model drew. Use `forwardRef` so PosterExportButton can capture the full-res node.
const NATIVE_W = 1080
const NATIVE_H = 1620
const DEFAULT_PREVIEW_W = 440

export const Poster = forwardRef<HTMLDivElement, Props>(function Poster({ campaign, code, width = DEFAULT_PREVIEW_W }, ref) {
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
        <AiPoster ref={ref} campaign={campaign} code={code} />
      </div>
    </div>
  )
})
