import { forwardRef } from 'react'
import type { Campaign } from '../lib/types'
import { buildViewUrl } from '../lib/landingUrl'
import { QrCode } from './QrCode'

interface Props {
  campaign: Campaign
  code: string // the placement code whose QR is embedded
}

// The poster = a full AI-illustrated cozy-scrapbook image (9:16), with the REAL
// per-placement QR overlaid on the calm reserved zone the image model left blank
// (the conversion row's center panel, ~80% down). Image models can't render a
// scannable QR, so we composite it here — keeping per-placement tracking + clean
// PNG export. QR_TOP_PCT is tuned to the prompt's reserved "Scan to Start" panel.
const POSTER_W = 432 // 9:16 preview at 432×768
const POSTER_H = 768
const QR_TOP_PCT = 80 // center of the reserved "Scan to Start" panel

export const Poster = forwardRef<HTMLDivElement, Props>(function Poster({ campaign, code }, ref) {
  const img = campaign.hero_image_url

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
          <QrCode value={buildViewUrl(code)} size={POSTER_W * 0.2} dark="#1f1b16" light="#ffffff" />
        </div>
      )}
    </div>
  )
})
