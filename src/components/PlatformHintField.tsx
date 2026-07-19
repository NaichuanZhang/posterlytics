import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import {
  MAX_PLATFORM_HINT_LENGTH,
  PLATFORM_HINT_OPTIONS,
  isPlatformHintPreset,
} from '../lib/platformHints'

const OTHER_VALUE = '__other__'

interface Props {
  id: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}

export function PlatformHintField({
  id,
  value,
  disabled = false,
  onChange,
}: Props) {
  const { t } = useI18n()
  const normalized = value.trim()
  const [customMode, setCustomMode] = useState(
    !!normalized && !isPlatformHintPreset(normalized),
  )
  const customInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (customInputRef.current === document.activeElement) return
    if (normalized) {
      setCustomMode(!isPlatformHintPreset(normalized))
    }
  }, [normalized])

  const selectedValue = customMode
    ? OTHER_VALUE
    : normalized
    ? isPlatformHintPreset(normalized)
      ? normalized
      : OTHER_VALUE
    : ''
  const hintId = `${id}-hint`
  const otherId = `${id}-other`

  return (
    <div className="field platform-hint-field">
      <label htmlFor={id}>
        {t('Target platform')} <span className="optional-label">{t('Optional')}</span>
      </label>
      <select
        id={id}
        className="input"
        value={selectedValue}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(event) => {
          const next = event.target.value
          setCustomMode(next === OTHER_VALUE)
          onChange(next === OTHER_VALUE ? '' : next)
        }}
      >
        <option value="">{t('No platform hint')}</option>
        {PLATFORM_HINT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {t(option.label)}
          </option>
        ))}
        <option value={OTHER_VALUE}>{t('Other platform')}</option>
      </select>
      {selectedValue === OTHER_VALUE && (
        <input
          ref={customInputRef}
          id={otherId}
          className="input"
          value={value}
          disabled={disabled}
          maxLength={MAX_PLATFORM_HINT_LENGTH}
          aria-label={t('Enter another platform')}
          aria-describedby={hintId}
          placeholder={t('Enter another platform')}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            if (isPlatformHintPreset(normalized)) setCustomMode(false)
          }}
        />
      )}
      <p className="hint" id={hintId}>
        {t('Used as creative context for the next generated version.')}
      </p>
    </div>
  )
}
