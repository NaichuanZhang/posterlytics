import { forwardRef } from 'react'
import type { Campaign, PosterStyle, QrZone } from '../../lib/types'
import { buildViewUrl } from '../../lib/landingUrl'
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
// 1080×1620 (2:3), with the REAL per-placement QR overlaid as a self-contained
// opaque white card + caption over a soft scrim. The image model can't render a
// scannable QR, so we composite ours on the calm zone its prompt reserves blank.
//
// The QR snaps to `campaign.qr_zone` — the box a vision pass (in functions/hero.ts)
// found the diffusion model actually left empty. When no/invalid box is stored, we
// fall back to a per-style ANCHORS guess (matching where hero.ts asks for space):
//   - saas_glassmorphism: lower-RIGHT of the dark CTA band
//   - cozy_scrapbook: CENTER of the lower band
const NATIVE_W = 1080
const NATIVE_H = 1620
const QR_FALLBACK_PX = 144 // matches the HTML templates
const QR_MIN = 104
const QR_MAX = 220
const CHIP_PAD = 14
const CAPTION_H = 40 // approx caption row reserved below the QR inside the card

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

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

// Accept a stored box only if it's finite, in-bounds, and not degenerate.
function validZone(z: QrZone | null | undefined): QrZone | null {
  if (!z) return null
  const { x, y, w, h } = z
  const finite = [x, y, w, h].every((n) => typeof n === 'number' && isFinite(n))
  if (!finite) return null
  if (w < 0.06 || h < 0.03) return null
  if (x < 0 || y < 0 || x + w > 1.0001 || y + h > 1.0001) return null
  return z
}

export const AiPoster = forwardRef<HTMLDivElement, Props>(function AiPoster(
  { campaign, code, imageSrcOverride },
  ref,
) {
  const img = imageSrcOverride ?? campaign.hero_image_url
  const style: PosterStyle = campaign.poster_style === 'saas_glassmorphism' ? 'saas_glassmorphism' : 'cozy_scrapbook'
  const a = ANCHORS[style]
  const spec = campaign.poster_spec as { qr_label?: string } | null
  const caption = spec?.qr_label || 'Scan to Start'

  // Position from the detected box center (the reliable signal); size the QR from
  // box WIDTH (gap height is often short for the SaaS CTA band), clamped. The
  // opaque card + scrim absorb any minor overflow. Fall back to ANCHORS otherwise.
  const zone = validZone(campaign.qr_zone)
  let leftPct: number
  let topPct: number
  let qrPx: number
  if (zone) {
    const boxWpx = zone.w * NATIVE_W
    qrPx = Math.round(Math.max(QR_MIN, Math.min(QR_MAX, boxWpx - CHIP_PAD * 2)))
    // Detected gaps sometimes sit at the very edge (e.g. SaaS y≈0.9); clamp the
    // chip center so the whole opaque card stays on-canvas (no clipped caption).
    const halfW = qrPx / 2 + CHIP_PAD
    const halfH = qrPx / 2 + CHIP_PAD + CAPTION_H
    const cx = clamp((zone.x + zone.w / 2) * NATIVE_W, halfW, NATIVE_W - halfW)
    const cy = clamp((zone.y + zone.h / 2) * NATIVE_H, halfH, NATIVE_H - halfH)
    leftPct = (cx / NATIVE_W) * 100
    topPct = (cy / NATIVE_H) * 100
  } else {
    leftPct = a.leftPct
    topPct = a.topPct
    qrPx = QR_FALLBACK_PX
  }

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

      {/* Soft scrim behind the QR card — absorbs any residual misalignment so the
          card reads as intentional even when it slightly overlaps drawn art. */}
      {img && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: `${leftPct}%`,
            top: `${topPct}%`,
            transform: 'translate(-50%, -50%)',
            width: qrPx * 2.2,
            height: qrPx * 2.2,
            borderRadius: '50%',
            background:
              'radial-gradient(closest-side, rgba(0,0,0,0.42), rgba(0,0,0,0.18) 55%, rgba(0,0,0,0) 72%)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      )}

      {/* Real QR chip — fully opaque card + caption, on the reserved/detected zone. */}
      {img && (
        <div
          style={{
            position: 'absolute',
            left: `${leftPct}%`,
            top: `${topPct}%`,
            transform: 'translate(-50%, -50%)',
            background: a.chipBg,
            padding: CHIP_PAD,
            borderRadius: 18,
            boxShadow: '0 18px 60px rgba(0,0,0,0.45)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            zIndex: 2,
          }}
        >
          <QrCode value={buildViewUrl(code)} size={qrPx} dark={a.qrDark} light="#ffffff" />
          <span
            style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: '0.01em',
              color: a.captionColor,
              lineHeight: 1.1,
              maxWidth: qrPx + 24,
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
