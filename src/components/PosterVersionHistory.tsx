import { AlertTriangle, Check, History, ListTree, RotateCcw } from 'lucide-react'
import type { GenerationActivityItem, PosterGeneration } from '../lib/types'
import { useI18n } from '../i18n/I18nProvider'
import type { Translate } from '../lib/i18n'
import { DurableGenerationStatus } from './DurableGenerationStatus'
import { Skeleton } from './ui/Feedback'

interface Props {
  generations: PosterGeneration[]
  activeGenerations: PosterGeneration[]
  failedGenerations: PosterGeneration[]
  activities: GenerationActivityItem[]
  selectedGeneration: PosterGeneration | null
  currentGenerationId: string | null
  loading: boolean
  error: string | null
  activating: boolean
  onSelect: (generationId: string) => void
  onActivate: (generationId: string) => void
  onReview: (generation: PosterGeneration) => void
  onRetry: (activity: GenerationActivityItem) => void
}

export function PosterVersionHistory({
  generations,
  activeGenerations,
  failedGenerations,
  activities,
  selectedGeneration,
  currentGenerationId,
  loading,
  error,
  activating,
  onSelect,
  onActivate,
  onReview,
  onRetry,
}: Props) {
  const { formatDate, t } = useI18n()
  const activeGeneration = activeGenerations[0] ?? null
  const activeActivity = activeGeneration
    ? activities.find((item) => item.generation_id === activeGeneration.id) ?? null
    : null

  return (
    <section className="version-history" aria-labelledby="versions-heading">
      <div className="panel-heading">
        <div>
          <History size={16} aria-hidden="true" />
          <h2 id="versions-heading">{t('Versions')}</h2>
        </div>
        <span>{generations.length}</span>
      </div>

      {activeGeneration && activeActivity && (
        <div className="active-version-row">
          <DurableGenerationStatus item={activeActivity} />
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => onReview(activeGeneration)}
          >
            <ListTree size={14} aria-hidden="true" />
            {t('Generation details')}
          </button>
        </div>
      )}

      {loading ? (
        <div className="version-loading" aria-label={t('Loading versions')} aria-busy="true">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index}>
              <Skeleton className="version-skeleton-image" />
              <span>
                <Skeleton className="skeleton-line" />
                <Skeleton className="skeleton-line skeleton-line-short" />
              </span>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="panel-error" role="alert">{error}</p>
      ) : generations.length === 0 ? (
        <p className="panel-empty">{t('The first completed poster will appear here.')}</p>
      ) : (
        <div className="version-list" aria-label={t('Poster versions')}>
          {generations.map((generation) => {
            const selected = selectedGeneration?.id === generation.id
            const current = currentGenerationId === generation.id
            return (
              <button
                key={generation.id}
                type="button"
                className={`version-row${selected ? ' is-selected' : ''}`}
                aria-pressed={selected}
                onClick={() => onSelect(generation.id)}
              >
                {generation.hero_image_url ? (
                  <img
                    src={generation.hero_image_url}
                    alt={t('Version {number} poster thumbnail', {
                      number: generation.version_number ?? '',
                    })}
                  />
                ) : (
                  <span className="version-image-placeholder" aria-hidden="true" />
                )}
                <span className="version-row-copy">
                  <strong>{t('Version {number}', {
                    number: generation.version_number ?? '-',
                  })}</strong>
                  <time dateTime={generation.completed_at ?? generation.created_at}>
                    {formatDate(generation.completed_at ?? generation.created_at, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </time>
                  <span>
                    {generation.generation_mode === 'website_refresh'
                      ? t('Site refreshed')
                      : t('Iteration')}
                  </span>
                </span>
                {current && (
                  <span className="version-current" aria-label={t('Current version')}>
                    <Check size={12} aria-hidden="true" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {selectedGeneration && (
        <div className="selected-version">
          <span>{t('Selected')}</span>
          <strong>{t('Version {number}', {
            number: selectedGeneration.version_number ?? '-',
          })}</strong>
          <p>{selectedGeneration.instruction || t('Initial website-based poster')}</p>
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={activating || currentGenerationId === selectedGeneration.id}
            onClick={() => onActivate(selectedGeneration.id)}
          >
            {currentGenerationId === selectedGeneration.id ? (
              <>
                <Check size={14} aria-hidden="true" />
                {t('Current version')}
              </>
            ) : (
              <>
                <RotateCcw size={14} aria-hidden="true" />
                {activating ? t('Restoring') : t('Use this version')}
              </>
            )}
          </button>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => onReview(selectedGeneration)}
          >
            <ListTree size={14} aria-hidden="true" />
            {t('Generation details')}
          </button>
        </div>
      )}

      {failedGenerations.length > 0 && (
        <details className="failed-generation-list">
          <summary>
            <span>
              <AlertTriangle size={14} aria-hidden="true" />
              {t('Incomplete attempts')}
            </span>
            <strong>{failedGenerations.length}</strong>
          </summary>
          <div>
            {failedGenerations.map((generation) => (
              <div className="failed-generation-entry" key={generation.id}>
                <button
                  type="button"
                  className="failed-generation-row"
                  onClick={() => onReview(generation)}
                >
                  <span>
                    <strong>
                      {generation.status === 'canceled'
                        ? t('Asset review canceled')
                        : failureStageLabel(generation.failure_stage, t)}
                    </strong>
                    <time dateTime={generation.failed_at ?? generation.updated_at}>
                      {formatDate(generation.failed_at ?? generation.updated_at, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </time>
                  </span>
                  <small>
                    {generation.failure_message || (
                      generation.status === 'canceled'
                        ? t('Canceled before poster generation.')
                        : t('Generation did not complete.')
                    )}
                  </small>
                  <ListTree size={14} aria-hidden="true" />
                </button>
                {activities.find((item) => item.generation_id === generation.id)?.status === 'failed' && (
                  <button
                    type="button"
                    className="failed-generation-retry"
                    onClick={() => {
                      const activity = activities.find(
                        (item) => item.generation_id === generation.id,
                      )
                      if (activity) onRetry(activity)
                    }}
                  >
                    <RotateCcw size={13} aria-hidden="true" />
                    {t('Retry with same inputs')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}

function failureStageLabel(
  stage: PosterGeneration['failure_stage'],
  t: Translate,
) {
  if (stage === 'analyze') return t('Analyze failed')
  if (stage === 'assets') return t('Asset selection failed')
  if (stage === 'designer') return t('Designer failed')
  if (stage === 'hero') return t('Image model failed')
  if (stage === 'complete') return t('Completion failed')
  return t('Generation failed')
}
