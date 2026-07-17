import { Check, RotateCcw } from 'lucide-react'
import type { Campaign, Placement, PosterGeneration } from '../lib/types'
import { PosterExportButton } from './PosterExportButton'

interface Props {
  generations: PosterGeneration[]
  selectedGeneration: PosterGeneration | null
  currentGenerationId: string | null
  previewCampaign: Campaign
  placement: Placement | null
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
  previewCampaign,
  placement,
  loading,
  error,
  activating,
  onSelect,
  onActivate,
}: Props) {
  return (
    <section className="version-history" aria-labelledby="versions-heading">
      <div className="version-history-head">
        <h2 id="versions-heading">Versions</h2>
        <span className="muted">{generations.length} saved</span>
      </div>

      {loading ? (
        <p className="muted version-empty">Loading versions...</p>
      ) : error ? (
        <p className="error-text version-empty">{error}</p>
      ) : generations.length === 0 ? (
        <p className="muted version-empty">No completed version yet.</p>
      ) : (
        <div className="version-strip" aria-label="Poster versions">
          {generations.map((generation) => {
            const selected = selectedGeneration?.id === generation.id
            const current = currentGenerationId === generation.id
            return (
              <button
                key={generation.id}
                type="button"
                className={`version-tile${selected ? ' is-selected' : ''}`}
                aria-pressed={selected}
                onClick={() => onSelect(generation.id)}
              >
                <img
                  src={generation.hero_image_url ?? ''}
                  alt={`Version ${generation.version_number} poster thumbnail`}
                />
                <span className="version-tile-copy">
                  <strong>Version {generation.version_number}</strong>
                  <span>{formatVersionDate(generation.completed_at ?? generation.created_at)}</span>
                </span>
                {current && (
                  <span className="version-current">
                    <Check size={12} aria-hidden="true" /> Current
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {selectedGeneration && (
        <div className="version-details">
          <div className="version-details-head">
            <div>
              <strong>Version {selectedGeneration.version_number}</strong>
              <span className="muted">
                {selectedGeneration.generation_mode === 'website_refresh'
                  ? 'Website refreshed'
                  : 'Current brand snapshot'}
              </span>
            </div>
            <div className="version-actions">
              <button
                type="button"
                className="btn secondary sm"
                disabled={activating || currentGenerationId === selectedGeneration.id}
                onClick={() => onActivate(selectedGeneration.id)}
              >
                <RotateCcw size={15} aria-hidden="true" />
                {currentGenerationId === selectedGeneration.id
                  ? 'Current version'
                  : activating
                    ? 'Restoring...'
                    : 'Use this version'}
              </button>
              {placement && (
                <PosterExportButton
                  campaign={previewCampaign}
                  placement={placement}
                  label="Download this version"
                  versionNumber={selectedGeneration.version_number ?? undefined}
                />
              )}
            </div>
          </div>

          <dl className="version-facts">
            <VersionFact label="Instruction" value={selectedGeneration.instruction || 'Initial poster'} />
            <VersionFact label="Composition" value={selectedGeneration.poster_layout?.composition} />
            <VersionFact label="Mood" value={selectedGeneration.poster_layout?.mood} />
            <VersionFact label="Art style" value={selectedGeneration.poster_layout?.art_style} />
            <VersionFact label="Tone" value={selectedGeneration.style_profile?.tone} />
          </dl>

          {selectedGeneration.reference_images.length > 0 && (
            <div className="version-references">
              <span className="muted">Supporting images</span>
              <div>
                {selectedGeneration.reference_images.map((image) => (
                  <img key={image.key} src={image.url} alt={image.name} title={image.name} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function VersionFact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || '-'}</dd>
    </div>
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
