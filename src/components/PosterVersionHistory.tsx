import { Check, History, RotateCcw } from 'lucide-react'
import type { PosterGeneration } from '../lib/types'
import { Skeleton } from './ui/Feedback'

interface Props {
  generations: PosterGeneration[]
  selectedGeneration: PosterGeneration | null
  currentGenerationId: string | null
  loading: boolean
  error: string | null
  activating: boolean
  onSelect: (generationId: string) => void
  onActivate: (generationId: string) => void
}

export function PosterVersionHistory({
  generations,
  selectedGeneration,
  currentGenerationId,
  loading,
  error,
  activating,
  onSelect,
  onActivate,
}: Props) {
  return (
    <section className="version-history" aria-labelledby="versions-heading">
      <div className="panel-heading">
        <div>
          <History size={16} aria-hidden="true" />
          <h2 id="versions-heading">Versions</h2>
        </div>
        <span>{generations.length}</span>
      </div>

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
        </div>
      )}
    </section>
  )
}

function formatVersionDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}
