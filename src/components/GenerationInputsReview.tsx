import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Globe2,
  ListOrdered,
} from 'lucide-react'
import { useState } from 'react'
import {
  TRACE_SOURCE_LABELS,
  type GenerationPreflight,
} from '../lib/generationTraces'

export function GenerationInputsReview({
  preflight,
  disabled = false,
}: {
  preflight: GenerationPreflight
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="generation-preflight">
      {preflight.selectedDiffersFromParent && (
        <div className="generation-parent-warning" role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>
            The canvas selection is not the current version. Regeneration will use{' '}
            <strong>Version {preflight.parent?.version_number ?? '-'}</strong>.
          </span>
        </div>
      )}
      <button
        type="button"
        className="button button-secondary button-small generation-preflight-toggle"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ListOrdered size={14} aria-hidden="true" />
        Review inputs
        {open
          ? <ChevronUp size={13} aria-hidden="true" />
          : <ChevronDown size={13} aria-hidden="true" />}
      </button>

      {open && (
        <div className="generation-preflight-body">
          <dl className="generation-preflight-summary">
            <div>
              <dt>Instruction</dt>
              <dd>{preflight.instruction}</dd>
            </div>
            <div>
              <dt>Actual parent</dt>
              <dd>
                {preflight.parent
                  ? `Version ${preflight.parent.version_number ?? '-'}`
                  : 'No parent - first version'}
              </dd>
            </div>
          </dl>

          <div className="generation-preflight-heading">
            <span>Expected image model order</span>
            <strong>{preflight.assets.length}</strong>
          </div>
          {preflight.assets.length === 0 ? (
            <p className="panel-empty">No image inputs are known yet.</p>
          ) : (
            <ol className="generation-preflight-list">
              {preflight.assets.map((asset) => (
                <li key={asset.id} className={asset.runtime ? 'is-runtime' : ''}>
                  <span className="generation-input-position">{asset.expected_position}</span>
                  <span className="generation-input-copy">
                    <strong>{asset.label}</strong>
                    <span>{asset.purpose}</span>
                    {asset.filename && <small>{asset.filename}</small>}
                  </span>
                  <span className="generation-input-source">
                    {asset.runtime && <Globe2 size={11} aria-hidden="true" />}
                    {asset.runtime ? 'Runtime' : TRACE_SOURCE_LABELS[asset.source]}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="generation-preflight-footnote">
            Expected only. Fetch, format, count, and byte limits determine the recorded request.
          </p>
        </div>
      )}
    </div>
  )
}
