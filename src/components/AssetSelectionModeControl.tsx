import { Bot, SlidersHorizontal } from 'lucide-react'
import { useId } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import type { AssetSelectionMode } from '../lib/types'

export function AssetSelectionModeControl({
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  value: AssetSelectionMode
  onChange: (mode: AssetSelectionMode) => void
  disabled?: boolean
  compact?: boolean
}) {
  const { t } = useI18n()
  const editorDescriptionId = useId()
  const yoloDescriptionId = useId()
  const editorDescription = t('Review, include, exclude, and reorder images before generation.')
  const yoloDescription = t('Let AI select and order images automatically, with no manual review step.')

  return (
    <div className={`asset-mode-control${compact ? ' is-compact' : ''}`}>
      <span>{t('Asset selection')}</span>
      <div className="segmented-control" role="group" aria-label={t('Asset selection mode')}>
        <button
          type="button"
          className={value === 'editor' ? 'is-active' : ''}
          aria-pressed={value === 'editor'}
          aria-describedby={editorDescriptionId}
          data-tooltip={editorDescription}
          disabled={disabled}
          onClick={() => onChange('editor')}
        >
          <SlidersHorizontal size={13} aria-hidden="true" />
          {t('Editor')}
        </button>
        <button
          type="button"
          className={value === 'yolo' ? 'is-active' : ''}
          aria-pressed={value === 'yolo'}
          aria-describedby={yoloDescriptionId}
          data-tooltip={yoloDescription}
          disabled={disabled}
          onClick={() => onChange('yolo')}
        >
          <Bot size={13} aria-hidden="true" />
          {t('Automatic')}
        </button>
      </div>
      <span id={editorDescriptionId} className="sr-only">{editorDescription}</span>
      <span id={yoloDescriptionId} className="sr-only">{yoloDescription}</span>
    </div>
  )
}
