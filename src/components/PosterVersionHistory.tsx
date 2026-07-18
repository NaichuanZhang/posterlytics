import { AlertTriangle, Check, History, ListTree, RotateCcw } from 'lucide-react'
import type { GenerationActivityItem, PosterGeneration } from '../lib/types'
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
  const activeGeneration = activeGenerations[0] ?? null
  const activeActivity = activeGeneration
    ? activities.find((item) => item.generation_id === activeGeneration.id) ?? null
    : null

  return (
    <section className="version-history" aria-labelledby="versions-heading">
      <div className="panel-heading">
        <div>
          <History size={16} aria-hidden="true" />
          <h2 id="versions-heading">Versions</h2>
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
            Generation details
          </button>
        </div>
      )}

      {loading ? (
        <div className="version-loading" aria-label="Loading versions" aria-busy="true">
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
        <p className="panel-empty">The first completed poster will appear here.</p>
      ) : (
        <div className="version-list" aria-label="Poster versions">
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
                    alt={`Version ${generation.version_number ?? ''} poster thumbnail`}
                  />
                ) : (
                  <span className="version-image-placeholder" aria-hidden="true" />
                )}
                <span className="version-row-copy">
                  <strong>Version {generation.version_number ?? '-'}</strong>
                  <time dateTime={generation.completed_at ?? generation.created_at}>
                    {formatVersionDate(generation.completed_at ?? generation.created_at)}
                  </time>
                  <span>{generation.generation_mode === 'website_refresh' ? 'Site refreshed' : 'Iteration'}</span>
                </span>
                {current && (
                  <span className="version-current" aria-label="Current version">
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
          <span>Selected</span>
          <strong>Version {selectedGeneration.version_number ?? '-'}</strong>
          <p>{selectedGeneration.instruction || 'Initial website-based poster'}</p>
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={activating || currentGenerationId === selectedGeneration.id}
            onClick={() => onActivate(selectedGeneration.id)}
          >
            {currentGenerationId === selectedGeneration.id ? (
              <>
                <Check size={14} aria-hidden="true" />
                Current version
              </>
            ) : (
              <>
                <RotateCcw size={14} aria-hidden="true" />
                {activating ? 'Restoring' : 'Use this version'}
              </>
            )}
          </button>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => onReview(selectedGeneration)}
          >
            <ListTree size={14} aria-hidden="true" />
            Generation details
          </button>
        </div>
      )}

      {failedGenerations.length > 0 && (
        <details className="failed-generation-list">
          <summary>
            <span>
              <AlertTriangle size={14} aria-hidden="true" />
              Incomplete attempts
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
                        ? 'Asset review canceled'
                        : failureStageLabel(generation.failure_stage)}
                    </strong>
                    <time dateTime={generation.failed_at ?? generation.updated_at}>
                      {formatVersionDate(generation.failed_at ?? generation.updated_at)}
                    </time>
                  </span>
                  <small>
                    {generation.failure_message || (
                      generation.status === 'canceled'
                        ? 'Canceled before poster generation.'
                        : 'Generation did not complete.'
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
                    Retry with same inputs
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

function failureStageLabel(stage: PosterGeneration['failure_stage']) {
  if (stage === 'analyze') return 'Analyze failed'
  if (stage === 'assets') return 'Asset selection failed'
  if (stage === 'designer') return 'Designer failed'
  if (stage === 'hero') return 'Image model failed'
  if (stage === 'complete') return 'Completion failed'
  return 'Generation failed'
}

function formatVersionDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}
