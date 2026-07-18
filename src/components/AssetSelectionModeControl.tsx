import { Bot, SlidersHorizontal } from 'lucide-react'
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
  return (
    <div className={`asset-mode-control${compact ? ' is-compact' : ''}`}>
      <span>Asset selection</span>
      <div className="segmented-control" role="group" aria-label="Asset selection mode">
        <button
          type="button"
          className={value === 'editor' ? 'is-active' : ''}
          aria-pressed={value === 'editor'}
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
          disabled={disabled}
          onClick={() => onChange('yolo')}
        >
          <Bot size={13} aria-hidden="true" />
          Yolo
        </button>
      </div>
    </div>
  )
}
