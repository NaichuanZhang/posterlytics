import { Bot, SlidersHorizontal } from 'lucide-react'
import { useId } from 'react'
import type { AssetSelectionMode } from '../lib/types'

const EDITOR_DESCRIPTION = 'Review, include, exclude, and reorder images before generation.'
const YOLO_DESCRIPTION = 'Let AI select and order images automatically, with no manual review step.'

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
  const editorDescriptionId = useId()
  const yoloDescriptionId = useId()

  return (
    <div className={`asset-mode-control${compact ? ' is-compact' : ''}`}>
      <span>Asset selection</span>
      <div className="segmented-control" role="group" aria-label="Asset selection mode">
        <button
          type="button"
          className={value === 'editor' ? 'is-active' : ''}
          aria-pressed={value === 'editor'}
          aria-describedby={editorDescriptionId}
          data-tooltip={EDITOR_DESCRIPTION}
          disabled={disabled}
          onClick={() => onChange('editor')}
        >
          <SlidersHorizontal size={13} aria-hidden="true" />
          Editor
        </button>
        <button
          type="button"
          className={value === 'yolo' ? 'is-active' : ''}
          aria-pressed={value === 'yolo'}
          aria-describedby={yoloDescriptionId}
          data-tooltip={YOLO_DESCRIPTION}
          disabled={disabled}
          onClick={() => onChange('yolo')}
        >
          <Bot size={13} aria-hidden="true" />
          Yolo
        </button>
      </div>
      <span id={editorDescriptionId} className="sr-only">{EDITOR_DESCRIPTION}</span>
      <span id={yoloDescriptionId} className="sr-only">{YOLO_DESCRIPTION}</span>
    </div>
  )
}
