import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Globe2,
  ListOrdered,
} from 'lucide-react'
import { useState } from 'react'
import {
  TRACE_SOURCE_LABEL_KEYS,
  type GenerationPreflight,
} from '../lib/generationTraces'
import { translateEnumLabel } from '../lib/i18n'
import { useI18n } from '../i18n/I18nProvider'

export function GenerationInputsReview({
  preflight,
  disabled = false,
}: {
  preflight: GenerationPreflight
  disabled?: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <div className="generation-preflight">
      {preflight.selectedDiffersFromParent && (
        <div className="generation-parent-warning" role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>
            {t(
              'The canvas selection is not the current version. Regeneration will use Version {number}.',
              { number: preflight.parent?.version_number ?? '-' },
            )}
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
        {t('Review inputs')}
        {open
          ? <ChevronUp size={13} aria-hidden="true" />
          : <ChevronDown size={13} aria-hidden="true" />}
      </button>

      {open && (
        <div className="generation-preflight-body">
          <dl className="generation-preflight-summary">
            <div>
              <dt>{t('Instruction')}</dt>
              <dd>{preflight.instruction}</dd>
            </div>
            <div>
              <dt>{t('Actual parent')}</dt>
              <dd>
                {preflight.parent
                  ? t('Version {number}', {
                    number: preflight.parent.version_number ?? '-',
                  })
                  : t('No parent - first version')}
              </dd>
            </div>
          </dl>

          <div className="generation-preflight-heading">
            <span>{t('Expected image model order')}</span>
            <strong>{preflight.assets.length}</strong>
          </div>
          {preflight.assets.length === 0 ? (
            <p className="panel-empty">{t('No image inputs are known yet.')}</p>
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
                    {asset.runtime
                      ? t('Runtime')
                      : translateEnumLabel(t, TRACE_SOURCE_LABEL_KEYS, asset.source)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="generation-preflight-footnote">
            {t('Expected only. Fetch, format, count, and byte limits determine the recorded request.')}
          </p>
        </div>
      )}
    </div>
  )
}
