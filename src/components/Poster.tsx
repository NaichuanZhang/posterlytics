import { forwardRef } from 'react'
import type { Campaign, PosterStyle } from '../lib/types'
import { buildViewUrl } from '../lib/landingUrl'
import { QrCode } from './QrCode'

interface Props {
  campaign: Campaign
  code: string // the placement code whose QR is embedded
}

// The poster = a full AI-illustrated image, with the REAL per-placement QR
// overlaid on the calm reserved zone the image model left blank. Image models
// can't render a scannable QR, so we composite it here — keeping per-placement
// tracking + clean PNG export. The model emits a native 2:3 portrait; each
// template's container and QR position are tuned to where its prompt reserved
// the blank "Scan to Start" panel.
//   - cozy_scrapbook: 9:16 container (crops the 2:3 art), QR ~80% down.
//   - saas_glassmorphism: full 2:3 container, QR in the lower CTA band ~89% down.
interface Dims {
  width: number
  height: number
  qrTopPct: number
  qrScale: number // QR width as a fraction of container width
}
const POSTER_DIMS: Record<PosterStyle, Dims> = {
  cozy_scrapbook: { width: 432, height: 768, qrTopPct: 80, qrScale: 0.2 },
  saas_glassmorphism: { width: 512, height: 768, qrTopPct: 89, qrScale: 0.16 },
}

export const Poster = forwardRef<HTMLDivElement, Props>(function Poster({ campaign, code }, ref) {
  const img = campaign.hero_image_url
  const style: PosterStyle = campaign.poster_style === 'saas_glassmorphism' ? 'saas_glassmorphism' : 'cozy_scrapbook'
  const dims = POSTER_DIMS[style]
  const POSTER_W = dims.width
  const POSTER_H = dims.height
  const QR_TOP_PCT = dims.qrTopPct

  return (
    <div
      ref={ref}
      style={{
        width: POSTER_W,
        height: POSTER_H,
        position: 'relative',
        overflow: 'hidden',
        background: '#f4eee3',
        borderRadius: 6,
      }}
    >
      {img ? (
        <img
          src={img}
          crossOrigin="anonymous"
          alt={`${campaign.product_name} poster`}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'grid',
            placeItems: 'center',
            color: '#8b8479',
            fontSize: 14,
            textAlign: 'center',
            padding: 24,
          }}
        >
          Poster image is still generating…
        </div>
      )}

      {/* Real QR, overlaid on the reserved calm zone (centered, ~62% down). */}
      {img && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: `${QR_TOP_PCT}%`,
            transform: 'translate(-50%, -50%)',
            background: '#ffffff',
            padding: 6,
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(31,27,22,0.25)',
            lineHeight: 0,
          }}
        >
          <QrCode value={buildViewUrl(code)} size={POSTER_W * dims.qrScale} dark="#1f1b16" light="#ffffff" />
        </div>
      )}
    </div>
  )
})
