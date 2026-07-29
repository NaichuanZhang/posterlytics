import { FileText, Image } from 'lucide-react'
import { useI18n } from '../i18n/I18nProvider'
import type { CreationOutputKind } from '../lib/useCases'

interface Props {
  idPrefix: string
  value: CreationOutputKind
  disabled?: boolean
  onChange: (value: CreationOutputKind) => void
}

const OPTIONS: ReadonlyArray<{
  value: CreationOutputKind
  labelKey: 'Single poster' | 'Multi-page post'
  icon: typeof Image
}> = [
  { value: 'poster', labelKey: 'Single poster', icon: Image },
  { value: 'post', labelKey: 'Multi-page post', icon: FileText },
]

/**
 * The output-kind control is the ONLY discriminator between a tracked poster and
 * a RedNote post; their persisted evidence is otherwise identical. Rendered as a
 * segmented radio group so the choice is explicit rather than inferred.
 */
export function OutputKindControl({
  idPrefix,
  value,
  disabled = false,
  onChange,
}: Props) {
  const { t } = useI18n()
  const descriptionId = `${idPrefix}-description`

  return (
    <div className="field output-kind-control">
      <span className="field-label" id={`${idPrefix}-label`}>
        {t('Output')}
      </span>
      <div
        className="segmented-control"
        role="radiogroup"
        aria-labelledby={`${idPrefix}-label`}
        aria-describedby={descriptionId}
      >
        {OPTIONS.map((option) => {
          const Icon = option.icon
          const selected = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              className={`segmented-option${selected ? ' is-selected' : ''}`}
              onClick={() => onChange(option.value)}
            >
              <Icon size={16} aria-hidden="true" />
              {t(option.labelKey)}
            </button>
          )
        })}
      </div>
      <p className="hint" id={descriptionId}>
        {value === 'post'
          ? t('A multi-page 3:4 RedNote post built from your draft copy. No QR tracking.')
          : t('A single tracked poster in the format you choose below.')}
      </p>
    </div>
  )
}
