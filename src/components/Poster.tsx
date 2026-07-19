import { forwardRef } from 'react'
import type { Campaign } from '../lib/types'
import { DEFAULT_POSTER_SIZE, type PosterSize } from '../lib/posterSize'
import { AiPoster } from './posters/AiPoster'

interface Props {
  campaign: Campaign
  code: string | null // required only when the descriptor includes a QR band
  width?: number // rendered preview width in px (defaults to fit the editor column)
  posterSize?: PosterSize
}

// The poster is the AI-painted hero artwork on its descriptor-native output
// sheet, scaled down to the requested preview width. AiPoster shows the complete
// artwork uncropped and, when registered, composites a real QR <img> into a
// scaled branded footer below it. Use `forwardRef` so PosterExportButton can
// capture the full-res node.
const DEFAULT_PREVIEW_W = 440

export const Poster = forwardRef<HTMLDivElement, Props>(function Poster(
  { campaign, code, width = DEFAULT_PREVIEW_W, posterSize = DEFAULT_POSTER_SIZE },
  ref,
) {
  const scale = width / posterSize.sheet.width

  return (
    // Outer box occupies the SCALED footprint so layout flows normally; the inner
    // node renders at native size and is scaled via transform (kept for crisp QR).
    <div
      style={{
        width,
        height: posterSize.sheet.height * scale,
        overflow: 'hidden',
        borderRadius: 8,
        boxShadow: '0 8px 30px rgba(0,0,0,0.16)',
      }}
    >
      <div
        style={{
          width: posterSize.sheet.width,
          height: posterSize.sheet.height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <AiPoster ref={ref} campaign={campaign} code={code} posterSize={posterSize} />
      </div>
    </div>
  )
})
