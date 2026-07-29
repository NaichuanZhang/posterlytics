import { Plus, X } from 'lucide-react'
import { useI18n } from '../i18n/I18nProvider'
import { MAX_SOURCE_URLS } from '../lib/sourceUrls'

interface Props {
  id: string
  /** The raw, un-normalized rows the creator is editing (may contain blanks). */
  values: string[]
  disabled?: boolean
  onChange: (values: string[]) => void
  /** Fired when the FIRST (captured) URL loses focus — e.g. for an Amazon lookup. */
  onPrimaryBlur?: () => void
}

/**
 * 1-3 source URLs, framed as an optional best-effort helper. Only the first is
 * ever fetched or captured; the rest become declared textual context.
 */
export function SourceUrlsField({
  id,
  values,
  disabled = false,
  onChange,
  onPrimaryBlur,
}: Props) {
  const { t } = useI18n()
  const rows = values.length > 0 ? values : ['']

  function updateRow(index: number, next: string) {
    const copy = rows.slice()
    copy[index] = next
    onChange(copy)
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, rowIndex) => rowIndex !== index))
  }

  const primaryPlaceholder = 'https://yourproduct.com'

  return (
    <div className="field field-wide source-urls-field">
      <span className="field-label" id={`${id}-label`}>
        {t('Source URLs')} <span className="optional-label">{t('Optional')}</span>
      </span>
      <p className="hint" id={`${id}-hint`}>
        {t('We read the first URL for brand and product context. Extra URLs are used as text only.')}
      </p>
      <ul className="source-urls-list" aria-labelledby={`${id}-label`}>
        {rows.map((value, index) => (
          <li key={index} className="source-urls-row">
            <input
              id={index === 0 ? id : `${id}-${index}`}
              className="input"
              type="url"
              inputMode="url"
              disabled={disabled}
              aria-label={index === 0
                ? t('Primary source URL')
                : t('Additional source URL {number}', { number: index })}
              aria-describedby={`${id}-hint`}
              placeholder={index === 0
                ? primaryPlaceholder
                : t('https://another-page.example')}
              value={value}
              onChange={(event) => updateRow(index, event.target.value)}
              onBlur={index === 0 ? onPrimaryBlur : undefined}
            />
            {rows.length > 1 && (
              <button
                type="button"
                className="icon-button"
                disabled={disabled}
                aria-label={t('Remove source URL {number}', { number: index + 1 })}
                onClick={() => removeRow(index)}
              >
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {rows.length < MAX_SOURCE_URLS && (
        <button
          type="button"
          className="button button-secondary button-small"
          disabled={disabled}
          onClick={() => onChange([...rows, ''])}
        >
          <Plus size={15} aria-hidden="true" />
          {t('Add another source URL')}
        </button>
      )}
    </div>
  )
}
