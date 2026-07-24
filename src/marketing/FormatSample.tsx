import type { CSSProperties } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { getPosterSize, type PosterSizeSlug } from '../lib/posterSize'
import { getFormatSampleGeometry } from './formatSampleGeometry'

interface FormatSampleStyle extends CSSProperties {
  '--format-sample-sheet-ratio': string
  '--format-sample-artwork-width': string
  '--format-sample-artwork-height': string
  '--format-sample-matte-x': string
  '--format-sample-margin-y': string
  '--format-sample-gap': string
  '--format-sample-footer-height': string
  '--format-sample-qr-size': string
}

function percent(value: number): string {
  return `${value}%`
}

export function FormatSample({ format }: { format: PosterSizeSlug }) {
  const { t } = useI18n()
  const size = getPosterSize(format)
  const geometry = getFormatSampleGeometry(format)
  const style: FormatSampleStyle = {
    '--format-sample-sheet-ratio': geometry.sheetAspectRatio,
    '--format-sample-artwork-width': percent(geometry.artworkWidthPct),
    '--format-sample-artwork-height': percent(geometry.artworkHeightPct),
    '--format-sample-matte-x': percent(geometry.matteXPct),
    '--format-sample-margin-y': percent(geometry.marginYPct),
    '--format-sample-gap': percent(geometry.gapPct),
    '--format-sample-footer-height': percent(geometry.footerHeightPct),
    '--format-sample-qr-size': percent(geometry.qrSizePct),
  }

  return (
    <figure
      className="format-study-item"
      data-format-study-item
      data-format={format}
      style={style}
    >
      <div
        className="format-sample-sheet"
        data-format-sample-sheet
        data-poster-size={format}
        data-orientation={geometry.orientation}
        data-qr-band={geometry.qrBandMode}
        aria-hidden="true"
      >
        <div className="format-sample-artwork">
          <div className="format-sample-brand">
            <span>{t('Posterlytics House')}</span>
            <strong>{t('PH / 01')}</strong>
          </div>
          <div className="format-sample-copy">
            <span>{t('Citrus 01')}</span>
            <strong>{t('Make room for bright.')}</strong>
            <p>{t('Fictional citrus tonic')}</p>
          </div>
          <div className="format-sample-product">
            <span className="format-sample-citrus format-sample-citrus-one" />
            <span className="format-sample-citrus format-sample-citrus-two" />
            <span className="format-sample-leaf format-sample-leaf-one" />
            <span className="format-sample-leaf format-sample-leaf-two" />
            <div className="format-sample-can">
              <span>{t('PH / 01')}</span>
              <strong>{t('Citrus 01')}</strong>
            </div>
          </div>
          <div className="format-sample-registration" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>

        {geometry.qrBandMode === 'scaled' && (
          <div className="format-sample-footer">
            <img
              className="format-sample-qr"
              src="/marketing/qr/field.png"
              alt=""
              loading="lazy"
              decoding="async"
            />
            <div className="format-sample-footer-copy">
              <strong>{t('Scan for Citrus 01')}</strong>
              <span>{t('Posterlytics House')}</span>
            </div>
          </div>
        )}
      </div>
      <figcaption className="format-sample-caption">
        <strong>{t(size.label)}</strong>
        <span>{t('Posterlytics House / Citrus 01')}</span>
      </figcaption>
    </figure>
  )
}
