import { forwardRef } from 'react'
import type { Campaign, EventPosterSpec } from '../../lib/types'
import { buildViewUrl } from '../../lib/viewUrl'
import { posterColors } from '../../lib/posterColors'
import { parseColor, toHex } from '../../lib/colorUtils'
import {
  DEFAULT_POSTER_SIZE,
  getPosterQrBandGeometry,
  scaleQrBandValue,
  type PosterSize,
} from '../../lib/posterSize'
import { QrCode } from '../QrCode'
import { useI18n } from '../../i18n/I18nProvider'

interface Props {
  campaign: Campaign
  code: string
  // Optional same-origin data-URL src for the hero image. PosterExportButton
  // pre-fetches the cross-origin hero to a data URL and passes it here so the
  // export canvas is never tainted by CORS. Falls back to hero_image_url.
  imageSrcOverride?: string
  posterSize?: PosterSize
}

// Output sheet: the COMPLETE model-generated illustration centered on the
// descriptor's canvas (matte-framed, object-fit: contain, never cropped,
// stretched, or covered), with the REAL per-placement QR in a scaled branded
// footer row BELOW the artwork. The image model can't render a scannable QR, so
// we composite ours outside the art and never hide a painted pixel.
//
// The matte matches the analyzed brand background so the artwork (which the
// prompt asks to fill edge-to-edge with that same bg) reads as one surface;
// monochrome/unparsable palettes fall back to the neutral paper color.
//
// The QR card is ALWAYS white with dark modules, independent of brand palette,
// so it stays scannable on any background. The footer is dark (posterColors.ink)
// with a thin vivid brand-accent hairline on top for identity.
export const AiPoster = forwardRef<HTMLDivElement, Props>(function AiPoster(
  { campaign, code, imageSrcOverride, posterSize = DEFAULT_POSTER_SIZE },
  ref,
) {
  const { t } = useI18n()
  const img = imageSrcOverride ?? campaign.hero_image_url
  const isEvent = campaign.scenario === 'event'
  // For events the poster_spec is an EventPosterSpec; its logistics lines were
  // computed deterministically by analyze (formatEventLines) so they're accurate.
  const evSpec = isEvent ? (campaign.poster_spec as Partial<EventPosterSpec> | null) : null
  const spec = campaign.poster_spec as { qr_label?: string } | null
  const caption = isEvent ? evSpec?.rsvp_label || 'Scan to RSVP' : spec?.qr_label || 'Scan to start'
  // Event logistics rendered as REAL text (never AI-painted): "Sat, Jul 4" /
  // "6:30 PM PDT" / "The Grand Hall · San Francisco". Filtered so blank lines drop.
  const eventLines = isEvent
    ? [
        [evSpec?.date_line, evSpec?.time_line].filter(Boolean).join('  ·  '),
        evSpec?.location_line,
        evSpec?.host_line,
      ].filter((s): s is string => !!s && s.trim().length > 0)
    : []

  // Dark, neutral footer with a vivid brand accent hairline. The accent is
  // derived by posterColors (handles monochrome brands by falling back to a
  // tasteful default), so identity shows even when the brand is grayscale.
  const pc = posterColors(campaign.style_profile)
  // Matte = the analyzed brand background when parseable, else the paper color.
  const brandBg = parseColor(campaign.style_profile?.palette?.bg)
  const matte = brandBg ? toHex(brandBg) : pc.paper
  const footerBg = pc.ink
  const footerAccent = pc.accent
  const footerText = '#ffffff'
  const footerTextDim = 'rgba(255,255,255,0.72)'
  const qrBand = getPosterQrBandGeometry(posterSize)
  const scaled = (value: number) => scaleQrBandValue(posterSize, value)

  return (
    <div
      ref={ref}
      style={{
        width: posterSize.sheet.width,
        height: posterSize.sheet.height,
        overflow: 'hidden',
        background: matte,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: qrBand.sheetMarginY,
        paddingBottom: qrBand.sheetMarginY,
        boxSizing: 'border-box',
      }}
    >
      {/* Complete registered artwork frame, contained and never cropped. */}
      <div
        style={{
          width: posterSize.artwork.width,
          height: posterSize.artwork.height,
          flex: '0 0 auto',
          overflow: 'hidden',
        }}
      >
        {img ? (
          <img
            src={img}
            crossOrigin="anonymous"
            alt={t('{name} poster', { name: campaign.product_name })}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
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
              boxSizing: 'border-box',
            }}
          >
            {t('{name} poster is still generating', { name: campaign.product_name })}
          </div>
        )}
      </div>

      {/* QR footer — its own row BELOW the artwork (aligned to the artwork
          width), never overlapping art. White QR card left, CTA copy right. */}
      {img && (
        <div
          style={{
            width: posterSize.artwork.width,
            height: qrBand.footerHeight,
            flex: '0 0 auto',
            marginTop: qrBand.gap,
            background: footerBg,
            borderTop: `${scaled(3)}px solid ${footerAccent}`,
            display: 'flex',
            alignItems: 'center',
            padding: `0 ${scaled(56)}px`,
            gap: scaled(40),
            boxSizing: 'border-box',
          }}
        >
          {/* White QR card — light quiet-zone frame keeps the code scannable
              regardless of the footer/brand color. */}
          <div
              style={{
                background: '#ffffff',
                padding: scaled(14),
                borderRadius: scaled(16),
              flex: '0 0 auto',
              display: 'flex',
            }}
          >
            <QrCode value={buildViewUrl(code)} size={qrBand.qrSize} dark="#0b0c0b" light="#ffffff" />
          </div>

          {/* Footer copy. For events: RSVP label + the real date/time/location/host
              lines (accurate, composited — never AI-painted). For products: the
              CTA caption + a "point your camera" nudge. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: scaled(isEvent ? 5 : 8), minWidth: 0 }}>
            <span
              style={{
                fontSize: scaled(isEvent ? 36 : 44),
                fontWeight: 800,
                lineHeight: 1.05,
                letterSpacing: '-0.01em',
                color: footerText,
              }}
            >
              {caption}
            </span>
            {isEvent ? (
              eventLines.map((line, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: scaled(i === 0 ? 27 : 24),
                    fontWeight: i === 0 ? 700 : 500,
                    lineHeight: 1.25,
                    color: i === 0 ? footerText : footerTextDim,
                  }}
                >
                  {line}
                </span>
              ))
            ) : (
              <span style={{ fontSize: scaled(26), fontWeight: 500, lineHeight: 1.2, color: footerTextDim }}>
                Point your camera here
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
})
