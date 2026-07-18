import { useI18n } from '../i18n/I18nProvider'
import {
  POSTER_SIZES,
  getPosterSize,
  type PosterSizeSlug,
} from '../lib/posterSize'

interface Props {
  id: string
  value: PosterSizeSlug
  disabled?: boolean
  onChange: (value: PosterSizeSlug) => void
}

export function PosterFormatSelect({
  id,
  value,
  disabled = false,
  onChange,
}: Props) {
  const { t } = useI18n()

  return (
    <div className="field">
      <label htmlFor={id}>{t('Poster format')}</label>
      <select
        id={id}
        className="input"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(getPosterSize(event.target.value).slug)}
      >
        {POSTER_SIZES.map((size) => (
          <option key={size.slug} value={size.slug}>
            {t(size.label)}
          </option>
        ))}
      </select>
    </div>
  )
}
