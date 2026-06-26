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

// AI-image poster: the model-generated illustration in the TOP ~81.5% of the
// native 1080×1620 (2:3) frame, with the REAL per-placement QR in a DEDICATED
// branded band that owns the bottom ~18.5% as its OWN row (no overlap). The image
// model can't render a scannable QR, so we composite ours.
//
// The band is a genuine letterbox row, not an overlay: the image is cropped to
// the image row with `objectPosition:'top'` (sheds the BOTTOM of the art, where
// stray CTA/footer pixels land), and the band sits in normal flow below it. This
// makes the old "band seam clips drawn art" failure structurally impossible —
// the band never sits on top of any artwork. hero.ts prompts the model to finish
// all content by ~74% down and leave the bottom ~26% as empty margin so a clean
// strip of the poster's own background sits above the band (smooth transition,
// the crop line never slices a headline or a drawn control).
//
// The QR card is ALWAYS white with dark modules, independent of brand palette,
// so it stays scannable on any background. The band is dark (posterColors.ink)
// with a thin vivid brand-accent hairline on top for identity.
const NATIVE_W = 1080
const NATIVE_H = 1620

// Band geometry (native px). BAND_H ≈ 18.5% of NATIVE_H; the image row takes the
// remaining height so the two stack without overlapping.
const BAND_H = 300
const IMG_H = NATIVE_H - BAND_H // 1320 — the cropped image row
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
        width: NATIVE_W,
        height: NATIVE_H,
        overflow: 'hidden',
        background: bandBg,
        display: 'flex',
        flexDirection: 'column',
      }}
      data-poster-style={style}
    >
      {/* Image row — the top ~81.5%. Cropped from the TOP (objectPosition:'top')
          so the discarded slice is the bottom of the art, never the headline. */}
      <div style={{ width: '100%', height: IMG_H, overflow: 'hidden', flex: '0 0 auto' }}>
        {img ? (
          <img
            src={img}
            crossOrigin="anonymous"
            alt={`${campaign.product_name} poster`}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' }}
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
      </div>

      {/* Dedicated bottom band — its OWN row below the image, never overlapping
          art. QR card on the left (always white for contrast), CTA copy right. */}
      {img && (
        <div
          style={{
            width: '100%',
            height: BAND_H,
            flex: '0 0 auto',
            background: bandBg,
            borderTop: `${HAIRLINE}px solid ${bandAccent}`,
            boxShadow: '0 -24px 48px rgba(0,0,0,0.28)',
            display: 'flex',
            alignItems: 'center',
            padding: `0 ${BAND_PAD_X}px`,
            gap: BAND_GAP,
            boxSizing: 'border-box',
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
