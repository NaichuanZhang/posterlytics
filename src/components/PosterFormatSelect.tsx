import { useI18n } from '../i18n/I18nProvider'
import {
  POSTER_SIZES,
  getPosterSize,
  getSelectablePosterSizes,
  hasPosterQrBand,
  type PosterSizeSlug,
} from '../lib/posterSize'

interface Props {
  id: string
  value: PosterSizeSlug
  disabled?: boolean
  allowedFormats?: readonly PosterSizeSlug[]
  onChange: (value: PosterSizeSlug) => void
}

export function PosterFormatSelect({
  id,
  value,
  disabled = false,
  allowedFormats,
  onChange,
}: Props) {
  const { t } = useI18n()
  const posterSize = getPosterSize(value)
  const selectableSizes = allowedFormats
    ? getSelectablePosterSizes(allowedFormats, value)
    : POSTER_SIZES
  const caveatId = `${id}-tracking-caveat`
  const isArtworkOnly = !hasPosterQrBand(posterSize)

  return (
    <div className="field">
      <label htmlFor={id}>{t('Poster format')}</label>
      <select
        id={id}
        className="input"
        value={value}
        disabled={disabled}
        aria-describedby={isArtworkOnly ? caveatId : undefined}
        onChange={(event) => onChange(getPosterSize(event.target.value).slug)}
      >
        {selectableSizes.map((size) => (
          <option key={size.slug} value={size.slug}>
            {t(size.label)}
          </option>
        ))}
      </select>
      {isArtworkOnly && (
        <p className="hint" id={caveatId}>
          {t('Artwork-only export. No QR code or placement tracking is included.')}
        </p>
      )}
    </div>
  )
}
