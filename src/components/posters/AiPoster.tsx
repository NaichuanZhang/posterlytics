import { forwardRef, useLayoutEffect, useRef, useState } from 'react'
import type { Campaign, EventPosterSpec } from '../../lib/types'
import { buildViewUrl } from '../../lib/viewUrl'
import { posterColors } from '../../lib/posterColors'
import { campaignDisplayName } from '../../lib/campaignDisplayName'
import { parseColor, toHex } from '../../lib/colorUtils'
import {
  getBottomEdgeStripHeight,
  sampledFooterPalette,
  sampleEdgeColor,
} from '../../lib/posterEdgeColor'
import {
  DEFAULT_POSTER_SIZE,
  getPosterQrBandGeometry,
  hasPosterQrBand,
  scaleQrBandValue,
  type PosterSize,
} from '../../lib/posterSize'
import { QrCode } from '../QrCode'
import { useI18n } from '../../i18n/I18nProvider'

interface Props {
  campaign: Campaign
  code: string | null
  imageAlt: string
  // Optional same-origin data-URL src for the hero image. PosterExportButton
  // pre-fetches the cross-origin hero to a data URL and passes it here so the
  // export canvas is never tainted by CORS. Falls back to hero_image_url.
  imageSrcOverride?: string
  compositedFooterAriaHidden?: boolean
  onRenderReady?: (result: PosterRenderReady) => void
  posterSize?: PosterSize
  // Terminal state of the latest generation, used only to word the empty-canvas
  // placeholder. Optional and defaulting to the in-progress copy so the export
  // and preview call sites are unaffected — an export must never paint
  // "canceled" into a poster.
  placeholderStatus?: PosterPlaceholderStatus
}

export type PosterPlaceholderStatus = 'generating' | 'canceled' | 'failed'

export type PosterFooterColorSource = 'sampled' | 'fallback' | 'not-applicable'

export interface PosterRenderReady {
  readonly imageSrc: string | null
  readonly footerColor: string
  readonly footerColorSource: PosterFooterColorSource
}

interface ImageRenderState {
  readonly imageSrc: string
  readonly sampledColor: string | null
  readonly status: Exclude<PosterFooterColorSource, 'not-applicable'>
}

// Output sheet: the COMPLETE model-generated illustration in the descriptor's
// artwork frame (object-fit: contain, never cropped, stretched, or covered).
// Scaled-band formats add the REAL per-placement QR below the artwork; bandless
// formats fill the sheet with artwork and render no footer.
//
// The matte matches the analyzed brand background so the artwork (which the
// prompt asks to fill edge-to-edge with that same bg) reads as one surface;
// monochrome/unparsable palettes fall back to the neutral paper color.
//
// When present, the QR card is always white with dark modules, independent of
// brand palette, so it stays scannable on any background.
export const AiPoster = forwardRef<HTMLDivElement, Props>(function AiPoster(
  {
    campaign,
    code,
    imageAlt,
    imageSrcOverride,
    compositedFooterAriaHidden = false,
    onRenderReady,
    posterSize = DEFAULT_POSTER_SIZE,
    placeholderStatus = 'generating',
  },
  ref,
) {
  const { t } = useI18n()
  const campaignName = campaignDisplayName(campaign, t('Untitled campaign'))
  const img = imageSrcOverride ?? campaign.hero_image_url
  const [imageRender, setImageRender] = useState<ImageRenderState | null>(null)
  const settledImageSrc = useRef<string | null>(null)
  const heroImageRef = useRef<HTMLImageElement>(null)
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

  const pc = posterColors(campaign.style_profile)
  // Matte = the analyzed brand background when parseable, else the paper color.
  const brandBg = parseColor(campaign.style_profile?.palette?.bg)
  const matte = brandBg ? toHex(brandBg) : pc.paper
  const includesQrBand = hasPosterQrBand(posterSize)
  const qrBand = getPosterQrBandGeometry(posterSize)
  const scaled = (value: number) => scaleQrBandValue(posterSize, value)
  const shouldSampleFooter = !!img && includesQrBand && !!code
  const currentImageRender = shouldSampleFooter && imageRender?.imageSrc === img
    ? imageRender
    : null
  const sampledColor = currentImageRender?.status === 'sampled'
    ? currentImageRender.sampledColor
    : null
  const sampledPalette = sampledColor
    ? sampledFooterPalette(sampledColor, pc.accent)
    : null

  // The null/pending/error branch is the byte-exact pre-sampling contract.
  const footerBg = sampledPalette?.background ?? pc.ink
  const footerAccent = sampledPalette?.accent ?? pc.accent
  const footerText = sampledPalette?.text ?? '#ffffff'
  const footerTextDim = sampledPalette?.secondaryText ?? 'rgba(255,255,255,0.72)'
  const footerColorSource: PosterFooterColorSource = sampledPalette
    ? 'sampled'
    : 'fallback'
  const renderStatus = shouldSampleFooter
    ? currentImageRender?.status ?? 'pending'
    : 'not-applicable'

  // This intentionally tracks only source and eligibility; handleImageLoad
  // claims each source once, so other render changes must not retrigger it.
  useLayoutEffect(() => {
    if (settledImageSrc.current !== img) {
      settledImageSrc.current = null
    }
    if (
      shouldSampleFooter
      && img
      && settledImageSrc.current !== img
      && heroImageRef.current?.complete
    ) {
      handleImageLoad(heroImageRef.current)
    }
  }, [img, shouldSampleFooter])

  useLayoutEffect(() => {
    if (renderStatus === 'pending') return
    onRenderReady?.({
      imageSrc: img,
      footerColor: footerBg,
      footerColorSource: renderStatus === 'not-applicable'
        ? 'not-applicable'
        : footerColorSource,
    })
  }, [footerBg, footerColorSource, img, onRenderReady, renderStatus])

  function handleImageLoad(image: HTMLImageElement) {
    const imageSrc = claimImageSource()
    if (!imageSrc) return

    let color: string | null = null
    try {
      color = readBottomEdgeColor(image)
    } catch {
      // SecurityError (tainted canvas), decode, and canvas failures all retain
      // the established palette fallback.
    }
    settleImageRender({
      imageSrc,
      sampledColor: color,
      status: color ? 'sampled' : 'fallback',
    })
  }

  function handleImageError() {
    const imageSrc = claimImageSource()
    if (!imageSrc) return
    settleImageRender({
      imageSrc,
      sampledColor: null,
      status: 'fallback',
    })
  }

  function claimImageSource(): string | null {
    if (!img || !shouldSampleFooter || settledImageSrc.current === img) {
      return null
    }
    settledImageSrc.current = img
    return img
  }

  function settleImageRender(next: ImageRenderState) {
    setImageRender((current) => (
      current?.imageSrc === next.imageSrc
      && current.sampledColor === next.sampledColor
      && current.status === next.status
        ? current
        : next
    ))
  }

  return (
    <div
      ref={ref}
      data-poster-size={posterSize.slug}
      data-qr-band={posterSize.qrBand.mode}
      data-poster-render-status={renderStatus}
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
            ref={heroImageRef}
            key={img}
            src={img}
            crossOrigin="anonymous"
            data-poster-hero
            alt={imageAlt}
            onLoad={(event) => handleImageLoad(event.currentTarget)}
            onError={handleImageError}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <div
            // Announce the placeholder so a screen-reader user hears when the
            // state changes (e.g. running -> canceled) instead of being left
            // with a stale sentence. Export/preview clones pass the default
            // 'generating' status and are aria-hidden by their own wrappers.
            role="status"
            aria-live="polite"
            data-poster-placeholder={placeholderStatus}
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
            {placeholderStatus === 'canceled'
              ? t('{name} generation was canceled', { name: campaignName })
              : placeholderStatus === 'failed'
                ? t("{name} generation didn't complete", { name: campaignName })
                : t('{name} poster is still generating', { name: campaignName })}
          </div>
        )}
      </div>

      {/* QR footer — its own row BELOW the artwork (aligned to the artwork
          width), never overlapping art. White QR card left, CTA copy right. */}
      {img && includesQrBand && code && (
        <div
          data-poster-footer
          data-footer-color={footerBg}
          data-footer-color-source={footerColorSource}
          aria-hidden={compositedFooterAriaHidden || undefined}
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
            data-poster-qr-chip
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
          <div
            style={{
              display: 'flex',
              flex: '1 1 0',
              flexDirection: 'column',
              gap: scaled(isEvent ? 5 : 8),
              minWidth: 0,
            }}
          >
            <span
              data-poster-footer-primary
              style={{
                display: 'block',
                width: '100%',
                minWidth: 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
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
              <span
                data-poster-footer-secondary
                style={{
                  display: 'block',
                  width: '100%',
                  minWidth: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontSize: scaled(26),
                  fontWeight: 500,
                  lineHeight: 1.2,
                  color: footerTextDim,
                }}
              >
                Point your camera here
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

function readBottomEdgeColor(image: HTMLImageElement): string | null {
  const { naturalWidth, naturalHeight } = image
  const stripHeight = getBottomEdgeStripHeight(naturalHeight)
  if (naturalWidth <= 0 || stripHeight <= 0) return null

  const canvas = document.createElement('canvas')
  canvas.width = naturalWidth
  canvas.height = stripHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null

  context.imageSmoothingEnabled = false
  context.drawImage(
    image,
    0,
    naturalHeight - stripHeight,
    naturalWidth,
    stripHeight,
    0,
    0,
    naturalWidth,
    stripHeight,
  )
  return sampleEdgeColor(context.getImageData(0, 0, naturalWidth, stripHeight))
}
