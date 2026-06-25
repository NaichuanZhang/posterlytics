import { forwardRef } from 'react'
import type { Campaign, PosterStyle } from '../../lib/types'
import { buildViewUrl } from '../../lib/landingUrl'
import { posterColors } from '../../lib/posterColors'
import { QrCode } from '../QrCode'

interface Props {
  campaign: Campaign
  code: string
  // Optional same-origin data-URL src for the hero image. PosterExportButton
  // pre-fetches the cross-origin hero to a data URL and passes it here so the
  // export canvas is never tainted by CORS. Falls back to hero_image_url.
  imageSrcOverride?: string
}

// AI-image poster: the model-generated illustration shown full-bleed at native
// 1080×1620 (2:3), with the REAL per-placement QR in a DEDICATED branded band
// pinned to the bottom edge. The image model can't render a scannable QR, so we
// composite ours — and rather than hunt for wherever the diffusion model left a
// calm gap, hero.ts prompts the model to keep the bottom ~18% a plain footer
// strip and we overlay a deterministic band exactly there (QR left, CTA right).
//
// The QR card is ALWAYS white with dark modules, independent of brand palette,
// so it stays scannable on any background. The band is dark (posterColors.ink)
// with a thin vivid brand-accent hairline on top for identity.
const NATIVE_W = 1080
const NATIVE_H = 1620

// Band geometry (native px). BAND_H ≈ 18.5% of NATIVE_H, matching the bottom
// strip hero.ts reserves in the prompt so the band covers no real artwork.
const BAND_H = 300
const BAND_PAD_X = 64
const BAND_GAP = 44
const QR_PX = 200
const QR_CARD_PAD = 18
const QR_CARD_RADIUS = 20
const HAIRLINE = 3
const CTA_TITLE_PX = 52
const CTA_SUB_PX = 30

export const AiPoster = forwardRef<HTMLDivElement, Props>(function AiPoster(
  { campaign, code, imageSrcOverride },
  ref,
) {
  const img = imageSrcOverride ?? campaign.hero_image_url
  const style: PosterStyle = campaign.poster_style === 'saas_glassmorphism' ? 'saas_glassmorphism' : 'cozy_scrapbook'
  const spec = campaign.poster_spec as { qr_label?: string } | null
  const caption = spec?.qr_label || 'Scan to start'

  // Dark, neutral band with a vivid brand accent hairline. The accent is derived
  // by posterColors (handles monochrome brands by falling back to a tasteful
  // default), so identity shows even when the brand palette is grayscale.
  const pc = posterColors(campaign.style_profile)
  const bandBg = pc.ink
  const bandAccent = pc.accent
  const bandText = '#ffffff'
  const bandTextDim = 'rgba(255,255,255,0.72)'

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        width: NATIVE_W,
        height: NATIVE_H,
        overflow: 'hidden',
        background: bandBg,
        isolation: 'isolate',
      }}
      data-poster-style={style}
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

      {/* Dedicated bottom band — the QR's deterministic home. QR card on the left
          (always white for contrast), CTA copy on the right. */}
      {img && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: BAND_H,
            background: bandBg,
            borderTop: `${HAIRLINE}px solid ${bandAccent}`,
            boxShadow: '0 -24px 48px rgba(0,0,0,0.28)',
            display: 'flex',
            alignItems: 'center',
            padding: `0 ${BAND_PAD_X}px`,
            gap: BAND_GAP,
            boxSizing: 'border-box',
            zIndex: 2,
          }}
        >
          {/* White QR card — light quiet-zone frame keeps the code scannable
              regardless of the band/brand color. */}
          <div
            style={{
              background: '#ffffff',
              padding: QR_CARD_PAD,
              borderRadius: QR_CARD_RADIUS,
              boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
              flex: '0 0 auto',
              display: 'flex',
            }}
          >
            <QrCode value={buildViewUrl(code)} size={QR_PX} dark="#0b0c0b" light="#ffffff" />
          </div>

          {/* CTA copy. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <span
              style={{
                fontSize: CTA_TITLE_PX,
                fontWeight: 800,
                lineHeight: 1.05,
                letterSpacing: '-0.01em',
                color: bandText,
              }}
            >
              {caption}
            </span>
            <span style={{ fontSize: CTA_SUB_PX, fontWeight: 500, lineHeight: 1.2, color: bandTextDim }}>
              Point your camera here
            </span>
          </div>
        </div>
      )}
    </div>
  )
})
