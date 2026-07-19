import { useI18n } from '../i18n/I18nProvider'
import type { TranslationKey } from '../i18n/messages'
import type { LayoutBand, PosterLayout, PosterLayoutZone } from '../lib/types'
import { parseColor } from '../lib/colorUtils'
import { BAND_GEOMETRY, getBandHeight, groupZonesByBand } from '../lib/layoutPreview'
import {
  DEFAULT_POSTER_SIZE,
  getPosterQrBandGeometry,
  hasPosterQrBand,
  scaleQrBandValue,
  type PosterSize,
} from '../lib/posterSize'

interface Props {
  layout: PosterLayout
  width?: number // rendered preview width in px
  posterSize?: PosterSize
}

// A deterministic WIREFRAME of a designer-mode poster layout, rendered straight
// from the `poster_layout` JSON the `designer` agent produced — shown while the AI
// image is still painting (or in the editor before/if the paint is missing). It is
// explicitly NOT the final poster: the same registered sheet as AiPoster, with
// palette-tinted blocks per zone showing the role + exact content text, sized by
// emphasis, in the correct band. Scaled-band formats include the footer
// placeholder; bandless formats use the complete sheet for artwork.
const DEFAULT_PREVIEW_W = 440
const BAND_LABEL_KEYS: Record<LayoutBand, TranslationKey> = {
  top: 'TOP',
  upper: 'UPPER',
  mid: 'MIDDLE',
  lower: 'LOWER',
}

export function LayoutPreview({
  layout,
  width = DEFAULT_PREVIEW_W,
  posterSize = DEFAULT_POSTER_SIZE,
}: Props) {
  const { t } = useI18n()
  const p = layout.palette_roles
  const scale = width / posterSize.sheet.width
  const groups = groupZonesByBand(layout)
  const zonesByBand = Object.fromEntries(groups.map((g) => [g.band, g.zones])) as Record<string, PosterLayoutZone[]>
  const qrBand = getPosterQrBandGeometry(posterSize)

  return (
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
          background: p.bg,
          color: p.text,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: qrBand.sheetMarginY,
          paddingBottom: qrBand.sheetMarginY,
          boxSizing: 'border-box',
          position: 'relative',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {/* "this is a preview" chip so it's never mistaken for the final render. */}
        <div
          style={{
            position: 'absolute',
            top: 42,
            right: 42,
            zIndex: 2,
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: '0.04em',
            padding: '8px 16px',
            borderRadius: 999,
          }}
        >
          {t('PREVIEW · bespoke layout')}
        </div>

        {/* Full artwork wireframe: the four content bands own the whole frame. */}
        <div
          style={{
            width: posterSize.artwork.width,
            height: posterSize.artwork.height,
            flex: '0 0 auto',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            border: '1px dashed rgba(128,128,128,0.35)',
            boxSizing: 'border-box',
          }}
        >
          {BAND_GEOMETRY.map((row) => (
            <ContentBand
              key={row.band}
              label={t(BAND_LABEL_KEYS[row.band])}
              height={getBandHeight(row, posterSize)}
              zones={zonesByBand[row.band] ?? []}
              palette={p}
            />
          ))}
        </div>

        {/* QR footer placeholder — composited by AiPoster outside the artwork. */}
        {hasPosterQrBand(posterSize) && (
          <FooterPlaceholder accent={p.accent} posterSize={posterSize} />
        )}
      </div>
    </div>
  )
}

type Palette = PosterLayout['palette_roles']

function ContentBand({
  label,
  height,
  zones,
  palette,
}: {
  label: string
  height: number
  zones: PosterLayoutZone[]
  palette: Palette
}) {
  return (
    <div
      style={{
        height,
        flex: '0 0 auto',
        boxSizing: 'border-box',
        padding: '14px 40px',
        borderBottom: '1px dashed rgba(128,128,128,0.28)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 8,
          left: 12,
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: '0.12em',
          color: 'rgba(128,128,128,0.65)',
        }}
      >
        {label}
      </span>
      {/* Zones in a band stack as a row when they fit (feature grids), else wrap. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' }}>
        {zones.length > 0 ? (
          zones.map((z, i) => <ZoneBlock key={i} zone={z} palette={palette} count={zones.length} />)
        ) : (
          <span style={{ fontSize: 26, color: 'rgba(128,128,128,0.5)', fontStyle: 'italic' }}>—</span>
        )}
      </div>
    </div>
  )
}

function ZoneBlock({ zone, palette, count }: { zone: PosterLayoutZone; palette: Palette; count: number }) {
  const high = zone.emphasis === 'high'
  const low = zone.emphasis === 'low'
  const align = zone.align ?? 'left'
  // Tint the block from the brand palette: surface if defined, else a faint accent
  // wash. High-emphasis zones lean on the primary; low ones stay quiet.
  const tint = palette.surface || rgba(high ? palette.primary : palette.accent, low ? 0.06 : 0.12)
  const contentSize = high ? 56 : low ? 26 : 36

  return (
    <div
      style={{
        flex: count > 1 ? '1 1 220px' : '1 1 100%',
        boxSizing: 'border-box',
        background: tint,
        border: `2px solid ${rgba(palette.primary, 0.22)}`,
        borderRadius: 12,
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        textAlign: align,
        alignItems: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
      }}
    >
      <span
        style={{
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: rgba(palette.primary, 0.85),
          background: rgba(palette.primary, 0.1),
          padding: '3px 10px',
          borderRadius: 999,
        }}
      >
        {zone.role}
      </span>
      {zone.content && (
        <span style={{ fontSize: contentSize, fontWeight: high ? 800 : 600, lineHeight: 1.1, color: palette.text }}>
          {zone.content}
        </span>
      )}
    </div>
  )
}

function FooterPlaceholder({ accent, posterSize }: { accent: string; posterSize: PosterSize }) {
  const { t } = useI18n()
  const qrBand = getPosterQrBandGeometry(posterSize)
  const scaled = (value: number) => scaleQrBandValue(posterSize, value)
  return (
    <div
      style={{
        width: posterSize.artwork.width,
        height: qrBand.footerHeight,
        flex: '0 0 auto',
        marginTop: qrBand.gap,
        boxSizing: 'border-box',
        background: '#0b0c0b',
        borderTop: `${scaled(3)}px solid ${accent}`,
        display: 'flex',
        alignItems: 'center',
        gap: scaled(28),
        padding: `0 ${scaled(56)}px`,
      }}
    >
      <div
        style={{
          width: scaled(120),
          height: scaled(120),
          borderRadius: scaled(14),
          background: '#fff',
          color: '#0b0c0b',
          display: 'grid',
          placeItems: 'center',
          fontSize: scaled(52),
          flex: '0 0 auto',
        }}
      >
        ▦
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: scaled(6) }}>
        <span style={{ fontSize: scaled(40), fontWeight: 800, color: '#fff' }}>
          {t('QR footer')}
        </span>
        <span style={{ fontSize: scaled(26), color: 'rgba(255,255,255,0.72)' }}>
          {t('added automatically — below the artwork')}
        </span>
      </div>
    </div>
  )
}

// Build an rgba() string from a hex (or any parseColor-able) color at the given
// alpha. Falls back to a neutral gray when the color can't be parsed.
function rgba(color: string, alpha: number): string {
  const rgb = parseColor(color)
  if (!rgb) return `rgba(128,128,128,${alpha})`
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}
