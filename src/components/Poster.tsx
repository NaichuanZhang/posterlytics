import { forwardRef } from 'react'
import type { Campaign, PosterStyle } from '../lib/types'
import { buildViewUrl } from '../lib/landingUrl'
import { QrCode } from './QrCode'

interface Props {
  campaign: Campaign
  code: string // the placement code whose QR is embedded
}

// The poster = a full AI-illustrated image, with the REAL per-placement QR
// composited on top as a self-contained "chip" (opaque white card + caption).
// Image models can't render a scannable QR, so we overlay it — keeping
// per-placement tracking + clean PNG export.
//
// The image model ALWAYS emits a native 2:3 portrait regardless of the requested
// aspect ratio, so the display container is locked to a 2:3 aspect-ratio and made
// RESPONSIVE (fills its column up to a max width) — the full frame shows with NO
// side/edge cropping and never overflows its card. Each template's prompt
// reserves a calm blank zone for the chip; qrLeftPct/qrTopPct point the chip at
// that zone (as % of the frame). The chip is opaque + self-captioned so it reads
// cleanly even if the art drifts slightly from the reserved spot.
interface Dims {
  qrLeftPct: number // chip center, as % of width
  qrTopPct: number // chip center, as % of height
  qrScale: number // QR width as a fraction of container width
}
const POSTER_MAX_W = 440 // fits the editor's poster column without clipping
const POSTER_DIMS: Record<PosterStyle, Dims> = {
  // cozy prompt keeps a clean empty area CENTERED in the lower band.
  cozy_scrapbook: { qrLeftPct: 50, qrTopPct: 77, qrScale: 0.24 },
  // saas prompt keeps a clean empty area in the RIGHT-third of the dark CTA band.
  saas_glassmorphism: { qrLeftPct: 75, qrTopPct: 82, qrScale: 0.24 },
}

export const Poster = forwardRef<HTMLDivElement, Props>(function Poster({ campaign, code }, ref) {
  const img = campaign.hero_image_url
  const style: PosterStyle = campaign.poster_style === 'saas_glassmorphism' ? 'saas_glassmorphism' : 'cozy_scrapbook'
  const dims = POSTER_DIMS[style]
  const spec = campaign.poster_spec as { qr_label?: string } | null
  const caption = spec?.qr_label || 'Scan to Start'
  // QR pixel size scales with the rendered width (capped at POSTER_MAX_W).
  const qrSize = Math.round(POSTER_MAX_W * dims.qrScale)

  return (
    <div
      ref={ref}
      style={{
        width: '100%',
        maxWidth: POSTER_MAX_W,
        aspectRatio: '2 / 3',
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

      {/* Real QR chip, composited on the reserved calm zone. Self-contained
          (opaque card + caption) so it always reads as an intentional sticker. */}
      {img && (
        <div
          style={{
            position: 'absolute',
            left: `${dims.qrLeftPct}%`,
            top: `${dims.qrTopPct}%`,
            transform: 'translate(-50%, -50%)',
            background: '#ffffff',
            padding: 7,
            borderRadius: 12,
            boxShadow: '0 4px 16px rgba(31,27,22,0.30)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <QrCode value={buildViewUrl(code)} size={qrSize} dark="#1f1b16" light="#ffffff" />
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.02em',
              color: '#1f1b16',
              lineHeight: 1.1,
              maxWidth: qrSize + 8,
              textAlign: 'center',
            }}
          >
            {caption}
          </span>
        </div>
      )}
    </div>
  )
})
