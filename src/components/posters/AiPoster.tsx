import { forwardRef } from 'react'
import type { Campaign, PosterStyle } from '../../lib/types'
import { buildViewUrl } from '../../lib/landingUrl'
import { QrCode } from '../QrCode'

interface Props {
  campaign: Campaign
  code: string
}

// AI-image poster: the model-generated illustration (campaign.hero_image_url) shown
// full-bleed at native 1080×1620 (2:3), with the REAL per-placement QR overlaid as a
// self-contained opaque white chip + caption. The image model can't render a
// scannable QR, so we composite ours on the calm zone its prompt reserves blank.
//
// QR size matches the HTML templates exactly (144px within the 1080-wide frame), and
// the anchor matches where functions/hero.ts leaves space for each style:
//   - saas_glassmorphism: lower-RIGHT of the dark CTA band (buildSaasPrompt)
//   - cozy_scrapbook: CENTERED in the lower band (buildCozyPrompt)
const NATIVE_W = 1080
const NATIVE_H = 1620
const QR_PX = 144 // same as the templates

interface Anchor {
  leftPct: number
  topPct: number
  chipBg: string
  qrDark: string
  captionColor: string
}
const ANCHORS: Record<PosterStyle, Anchor> = {
  saas_glassmorphism: { leftPct: 75, topPct: 82, chipBg: '#ffffff', qrDark: '#0b0c0b', captionColor: '#0b0c0b' },
  cozy_scrapbook: { leftPct: 50, topPct: 77, chipBg: '#ffffff', qrDark: '#3a2f25', captionColor: '#3a2f25' },
}

export const AiPoster = forwardRef<HTMLDivElement, Props>(function AiPoster({ campaign, code }, ref) {
  const img = campaign.hero_image_url
  const style: PosterStyle = campaign.poster_style === 'saas_glassmorphism' ? 'saas_glassmorphism' : 'cozy_scrapbook'
  const a = ANCHORS[style]
  const spec = campaign.poster_spec as { qr_label?: string } | null
  const caption = spec?.qr_label || 'Scan to Start'

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        width: NATIVE_W,
        height: NATIVE_H,
        overflow: 'hidden',
        background: '#0b0c0b',
        isolation: 'isolate',
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
            fontSize: 34,
            textAlign: 'center',
            padding: 80,
          }}
        >
          AI poster is still generating…
        </div>
      )}

      {/* Real QR chip — opaque card + caption, on the reserved blank zone. */}
      {img && (
        <div
          style={{
            position: 'absolute',
            left: `${a.leftPct}%`,
            top: `${a.topPct}%`,
            transform: 'translate(-50%, -50%)',
            background: a.chipBg,
            padding: 14,
            borderRadius: 18,
            boxShadow: '0 18px 60px rgba(0,0,0,0.45)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <QrCode value={buildViewUrl(code)} size={QR_PX} dark={a.qrDark} light="#ffffff" />
          <span
            style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: '0.01em',
              color: a.captionColor,
              lineHeight: 1.1,
              maxWidth: QR_PX + 24,
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
