import { forwardRef } from 'react'
import type { Campaign } from '../lib/types'
import { buildViewUrl } from '../lib/landingUrl'
import { QrCode } from './QrCode'

interface Props {
  campaign: Campaign
  code: string // the placement code whose QR is embedded
}

// The hybrid product ad poster: real brand visual (or AI hero fallback) as the
// backdrop + a crisp HTML/CSS overlay (hook, one-liner, top-3 features, CTA, QR)
// styled in the product's design language. Captured to PNG by PosterExportButton.
export const Poster = forwardRef<HTMLDivElement, Props>(function Poster({ campaign, code }, ref) {
  const sp = campaign.style_profile
  const pc = campaign.poster_copy
  const ba = campaign.brand_assets

  const primary = sp?.palette.primary ?? '#4f46e5'
  const bg = sp?.palette.bg ?? '#ffffff'
  const text = sp?.palette.text ?? '#111827'
  const accent = sp?.palette.accent ?? primary
  const headingFont = sp?.fonts.heading ?? 'Georgia, serif'
  const bodyFont = sp?.fonts.body ?? 'system-ui, sans-serif'

  const visual = ba?.primary_image_url || ba?.images?.[0]?.url || campaign.hero_image_url || ''
  const logo = ba?.logo_url || ''
  const hook = pc?.hook || campaign.product_name
  const oneLiner = pc?.what_it_does || campaign.tagline || ''
  const features = (pc?.features ?? []).slice(0, 3)
  const cta = pc?.cta || campaign.cta_text || 'Learn more'

  return (
    <div
      ref={ref}
      style={{
        width: 540,
        height: 675, // 4:5
        background: bg,
        color: text,
        fontFamily: bodyFont,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Visual band (top ~55%) */}
      <div style={{ position: 'relative', height: '54%', background: '#e5e7eb', overflow: 'hidden' }}>
        {visual ? (
          <img
            src={visual}
            crossOrigin="anonymous"
            alt={campaign.product_name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              background: `linear-gradient(135deg, ${primary}, ${accent})`,
            }}
          />
        )}
        {/* Logo chip */}
        {logo && (
          <div
            style={{
              position: 'absolute',
              top: 20,
              left: 20,
              background: 'rgba(255,255,255,0.92)',
              borderRadius: 10,
              padding: '6px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <img src={logo} crossOrigin="anonymous" alt="logo" style={{ height: 24 }} />
          </div>
        )}
      </div>

      {/* Copy band */}
      <div style={{ padding: '26px 30px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: primary,
            marginBottom: 8,
          }}
        >
          {campaign.product_name}
        </div>
        <h1 style={{ fontFamily: headingFont, fontSize: 36, lineHeight: 1.08, margin: '0 0 8px' }}>
          {hook}
        </h1>
        {oneLiner && (
          <p style={{ fontSize: 16, opacity: 0.78, margin: '0 0 14px', lineHeight: 1.35 }}>{oneLiner}</p>
        )}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 7 }}>
          {features.map((f, i) => (
            <li key={i} style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 15 }}>
              <span
                style={{
                  flex: '0 0 20px',
                  height: 20,
                  borderRadius: '50%',
                  background: accent,
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                ✓
              </span>
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <div style={{ flex: 1 }} />

        {/* CTA + QR footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div
            style={{
              background: primary,
              color: '#fff',
              fontFamily: headingFont,
              fontWeight: 700,
              fontSize: 18,
              padding: '14px 22px',
              borderRadius: 12,
            }}
          >
            {cta} →
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ background: '#fff', padding: 6, borderRadius: 10, display: 'inline-block' }}>
              <QrCode value={buildViewUrl(code)} size={92} />
            </div>
            <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>Scan to learn more</div>
          </div>
        </div>
      </div>
    </div>
  )
})
