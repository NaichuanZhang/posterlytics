import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  GripVertical,
  ImageOff,
  LoaderCircle,
  RefreshCw,
  Save,
  Sparkles,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useGenerationActivity } from '../activity/GenerationActivityProvider'
import { AppShell } from '../components/AppShell'
import { InlineNotice } from '../components/ui/Feedback'
import { Spinner } from '../components/ui/Spinner'
import {
  cancelGenerationAssetReview,
  confirmGenerationAssetSelection,
  fetchGenerationAssets,
  fetchGenerationForAssetReview,
  saveGenerationAssetSelection,
} from '../lib/generationApi'
import { TRACE_SOURCE_LABELS } from '../lib/generationTraces'
import type { GenerationAsset, PosterGeneration } from '../lib/types'

type SaveState = 'saved' | 'saving' | 'error'

export function GenerationAssetReviewPage() {
  const { campaignId, generationId } = useParams<{
    campaignId: string
    generationId: string
  }>()
  const navigate = useNavigate()
  const { refresh: refreshActivity } = useGenerationActivity()
  const [generation, setGeneration] = useState<PosterGeneration | null>(null)
  const [assets, setAssets] = useState<GenerationAsset[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [cancelPrompt, setCancelPrompt] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const initializedRef = useRef(false)
  const latestSelectionRef = useRef<string[]>([])
  const saveChainRef = useRef<Promise<void>>(Promise.resolve())
  const saveVersionRef = useRef(0)

  const load = useCallback(async (initial = false) => {
    if (!campaignId || !generationId) return
    if (initial) setLoading(true)
    try {
      const [nextGeneration, nextAssets] = await Promise.all([
        fetchGenerationForAssetReview(campaignId, generationId),
        fetchGenerationAssets(generationId),
      ])
      if (!nextGeneration) throw new Error('Poster generation not found.')
      setGeneration(nextGeneration)
      setAssets(nextAssets)
      if (
        !initializedRef.current
        && (
          nextAssets.length > 0
          || nextGeneration.status === 'reviewing'
          || nextGeneration.asset_selection_status === 'completed'
        )
      ) {
        const restored = nextAssets
          .filter((asset) => asset.included)
          .sort((a, b) =>
            (a.selection_rank ?? Number.MAX_SAFE_INTEGER)
            - (b.selection_rank ?? Number.MAX_SAFE_INTEGER)
          )
          .map((asset) => asset.id)
        initializedRef.current = true
        latestSelectionRef.current = restored
        setSelectedIds(restored)
      }
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (initial) setLoading(false)
    }
  }, [campaignId, generationId])

  useEffect(() => {
    void load(true)
  }, [load])

  useEffect(() => {
    if (
      !generation
      || generation.status === 'reviewing'
      || generation.asset_selection_status === 'completed'
      || generation.status === 'canceled'
      || generation.status === 'failed'
    ) {
      return
    }
    const timer = window.setInterval(() => void load(), 2000)
    return () => window.clearInterval(timer)
  }, [generation, load])

  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets],
  )
  const selectedAssets = selectedIds
    .map((id) => assetById.get(id))
    .filter((asset): asset is GenerationAsset => !!asset)
  const excludedAssets = assets.filter((asset) => !selectedIds.includes(asset.id))
  const reviewReady = generation?.status === 'reviewing'
    && generation.asset_selection_mode === 'editor'
    && generation.asset_selection_status === 'pending'

  function queueAutosave(nextIds: string[]) {
    if (!generationId || !reviewReady) return
    latestSelectionRef.current = nextIds
    setSelectedIds(nextIds)
    setSaveState('saving')
    setError(null)
    const version = ++saveVersionRef.current
    const save = saveChainRef.current
      .catch(() => {})
      .then(async () => {
        await saveGenerationAssetSelection(generationId, nextIds)
      })
    saveChainRef.current = save
    void save.then(() => {
      if (saveVersionRef.current === version) setSaveState('saved')
    }).catch(() => {
      if (saveVersionRef.current === version) {
        setSaveState('error')
      }
    })
  }

  function toggleAsset(asset: GenerationAsset) {
    if (!reviewReady || asset.availability !== 'available') return
    if (selectedIds.includes(asset.id)) {
      queueAutosave(selectedIds.filter((id) => id !== asset.id))
      return
    }
    if (selectedIds.length >= 6) {
      setError('A generation can use at most six images.')
      return
    }
    queueAutosave([...selectedIds, asset.id])
  }

  function moveAsset(assetId: string, direction: -1 | 1) {
    const currentIndex = selectedIds.indexOf(assetId)
    const targetIndex = currentIndex + direction
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= selectedIds.length) return
    const next = [...selectedIds]
    ;[next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]]
    queueAutosave(next)
  }

  function dropAsset(targetId: string) {
    if (!draggedId || draggedId === targetId) return
    const sourceIndex = selectedIds.indexOf(draggedId)
    const targetIndex = selectedIds.indexOf(targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const next = [...selectedIds]
    const [moved] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, moved)
    setDraggedId(null)
    queueAutosave(next)
  }

  async function confirmSelection() {
    if (!generationId || !reviewReady) return
    setConfirming(true)
    setError(null)
    try {
      await saveChainRef.current
    } catch {
      setSaveState('error')
      setConfirming(false)
      return
    }
    try {
      await confirmGenerationAssetSelection(generationId, latestSelectionRef.current)
      await refreshActivity()
      navigate(`/campaigns/${campaignId}`, { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setConfirming(false)
    }
  }

  async function cancelReview() {
    if (!generationId || !reviewReady) return
    setCanceling(true)
    setError(null)
    try {
      await saveChainRef.current.catch(() => {})
      await cancelGenerationAssetReview(generationId)
      await refreshActivity()
      navigate(`/campaigns/${campaignId}`, { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setCanceling(false)
    }
  }

  if (loading) {
    return (
      <AppShell breadcrumbs={[{ label: 'Campaigns', to: '/' }, { label: 'Asset review' }]}>
        <Spinner full />
      </AppShell>
    )
  }

  if (!generation || !campaignId || !generationId) {
    return (
      <AppShell breadcrumbs={[{ label: 'Campaigns', to: '/' }, { label: 'Asset review' }]}>
        <InlineNotice tone="error">{error || 'Poster generation not found.'}</InlineNotice>
      </AppShell>
    )
  }

  const preparing = ['created', 'analyzing'].includes(generation.status)
    || (
      generation.status !== 'reviewing'
      && generation.asset_selection_status === 'pending'
      && generation.status !== 'failed'
      && generation.status !== 'canceled'
    )

  return (
    <AppShell
      breadcrumbs={[
        { label: 'Campaigns', to: '/' },
        { label: 'Editor', to: `/campaigns/${campaignId}` },
        { label: 'Asset review' },
      ]}
      actions={(
        <Link to={`/campaigns/${campaignId}`} className="toolbar-button">
          <ArrowLeft size={15} aria-hidden="true" />
          Editor
        </Link>
      )}
    >
      <main className="asset-review-page">
        <header className="asset-review-header">
          <div>
            <span>Editor selection</span>
            <h1>Generation assets</h1>
          </div>
          {reviewReady && (
            <div className="asset-review-save" aria-live="polite">
              {saveState === 'saving' ? (
                <LoaderCircle size={14} className="is-spinning" aria-hidden="true" />
              ) : saveState === 'error' ? (
                <AlertCircle size={14} aria-hidden="true" />
              ) : (
                <Save size={14} aria-hidden="true" />
              )}
              {saveState === 'saving' ? 'Saving' : saveState === 'error' ? 'Save failed' : 'Saved'}
            </div>
          )}
        </header>

        {preparing ? (
          <section className="asset-preparing" aria-live="polite">
            <LoaderCircle size={22} className="is-spinning" aria-hidden="true" />
            <div>
              <strong>Preparing assets</strong>
              <span>{generation.status === 'analyzing' ? 'Reading website' : 'Validating images'}</span>
            </div>
          </section>
        ) : generation.asset_selection_mode !== 'editor' ? (
          <InlineNotice tone="warning">
            This generation uses Yolo asset selection and cannot be edited.
          </InlineNotice>
        ) : generation.asset_selection_status === 'completed' ? (
          <InlineNotice tone="success">
            <strong>Asset selection confirmed.</strong>
            <span>Poster generation is continuing.</span>
          </InlineNotice>
        ) : generation.status === 'canceled' ? (
          <InlineNotice tone="warning">This asset review was canceled.</InlineNotice>
        ) : generation.status === 'failed' ? (
          <InlineNotice tone="error">
            {generation.failure_message || 'Asset preparation failed.'}
          </InlineNotice>
        ) : (
          <>
            <section className="asset-selection-toolbar" aria-label="Asset selection summary">
              <div className="asset-selection-count">
                <strong>{selectedIds.length}/6</strong>
                <span>Included</span>
              </div>
              {selectedIds.length === 0 && (
                <InlineNotice tone="warning">
                  No images selected. Generation will use text context only.
                </InlineNotice>
              )}
            </section>

            <AssetSection
              title="Included"
              assets={selectedAssets}
              selectedIds={selectedIds}
              reviewReady={reviewReady}
              draggable
              draggedId={draggedId}
              onDragStart={setDraggedId}
              onDrop={dropAsset}
              onToggle={toggleAsset}
              onMove={moveAsset}
            />
            <AssetSection
              title="Excluded"
              assets={excludedAssets}
              selectedIds={selectedIds}
              reviewReady={reviewReady}
              draggedId={draggedId}
              onDragStart={setDraggedId}
              onDrop={dropAsset}
              onToggle={toggleAsset}
              onMove={moveAsset}
            />

            {saveState === 'error' && (
              <InlineNotice tone="error">
                <span>We couldn't save your image selection. Try again.</span>
                <button
                  type="button"
                  className="button button-secondary button-small asset-save-retry"
                  onClick={() => queueAutosave([...latestSelectionRef.current])}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  Retry save
                </button>
              </InlineNotice>
            )}
            {error && <InlineNotice tone="error">{error}</InlineNotice>}

            <footer className="asset-review-actions">
              {cancelPrompt ? (
                <div className="asset-cancel-confirm" role="group" aria-label="Confirm cancellation">
                  <span>Cancel this generation?</span>
                  <button
                    type="button"
                    className="button button-danger"
                    disabled={canceling}
                    onClick={() => void cancelReview()}
                  >
                    <X size={15} aria-hidden="true" />
                    {canceling ? 'Canceling' : 'Cancel generation'}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={canceling}
                    onClick={() => setCancelPrompt(false)}
                  >
                    Keep review
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setCancelPrompt(true)}
                >
                  <X size={15} aria-hidden="true" />
                  Cancel review
                </button>
              )}
              <button
                type="button"
                className="button button-primary"
                disabled={confirming || canceling || saveState === 'error'}
                onClick={() => void confirmSelection()}
              >
                {confirming
                  ? <LoaderCircle size={15} className="is-spinning" aria-hidden="true" />
                  : <Sparkles size={15} aria-hidden="true" />}
                {confirming ? 'Confirming' : 'Confirm and generate'}
              </button>
            </footer>
          </>
        )}
        {!preparing && !reviewReady && (
          <Link to={`/campaigns/${campaignId}`} className="button button-primary">
            Open editor
          </Link>
        )}
      </main>
    </AppShell>
  )
}

function AssetSection({
  title,
  assets,
  selectedIds,
  reviewReady,
  draggable = false,
  draggedId,
  onDragStart,
  onDrop,
  onToggle,
  onMove,
}: {
  title: string
  assets: GenerationAsset[]
  selectedIds: string[]
  reviewReady: boolean
  draggable?: boolean
  draggedId: string | null
  onDragStart: (id: string | null) => void
  onDrop: (id: string) => void
  onToggle: (asset: GenerationAsset) => void
  onMove: (id: string, direction: -1 | 1) => void
}) {
  return (
    <section className="asset-review-section" aria-labelledby={`assets-${title.toLowerCase()}`}>
      <div className="asset-review-section-heading">
        <h2 id={`assets-${title.toLowerCase()}`}>{title}</h2>
        <span>{assets.length}</span>
      </div>
      {assets.length === 0 ? (
        <p className="asset-review-empty">
          {title === 'Included' ? 'No images included.' : 'No excluded candidates.'}
        </p>
      ) : (
        <div className="asset-review-grid">
          {assets.map((asset) => {
            const selectedIndex = selectedIds.indexOf(asset.id)
            return (
              <AssetCard
                key={asset.id}
                asset={asset}
                selectedIndex={selectedIndex}
                selectedCount={selectedIds.length}
                reviewReady={reviewReady}
                draggable={draggable}
                dragging={draggedId === asset.id}
                onDragStart={onDragStart}
                onDrop={onDrop}
                onToggle={onToggle}
                onMove={onMove}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

function AssetCard({
  asset,
  selectedIndex,
  selectedCount,
  reviewReady,
  draggable,
  dragging,
  onDragStart,
  onDrop,
  onToggle,
  onMove,
}: {
  asset: GenerationAsset
  selectedIndex: number
  selectedCount: number
  reviewReady: boolean
  draggable: boolean
  dragging: boolean
  onDragStart: (id: string | null) => void
  onDrop: (id: string) => void
  onToggle: (asset: GenerationAsset) => void
  onMove: (id: string, direction: -1 | 1) => void
}) {
  const [previewFailed, setPreviewFailed] = useState(false)
  const included = selectedIndex >= 0

  function handleReorderKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    onMove(asset.id, event.key === 'ArrowUp' ? -1 : 1)
  }

  function handleDragStart(event: DragEvent<HTMLElement>) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', asset.id)
    onDragStart(asset.id)
  }

  return (
    <article
      className={`asset-card${included ? ' is-included' : ''}${dragging ? ' is-dragging' : ''}${asset.availability === 'unavailable' ? ' is-unavailable' : ''}`}
      draggable={draggable && reviewReady}
      onDragStart={handleDragStart}
      onDragEnd={() => onDragStart(null)}
      onDragOver={(event) => {
        if (draggable) event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop(asset.id)
      }}
    >
      <div className="asset-card-preview">
        {asset.url && !previewFailed ? (
          <img
            src={asset.url}
            alt={asset.filename || TRACE_SOURCE_LABELS[asset.source]}
            loading="lazy"
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <span>
            <ImageOff size={22} aria-hidden="true" />
            Preview unavailable
          </span>
        )}
        {included && <b>{selectedIndex + 1}</b>}
      </div>
      <div className="asset-card-body">
        <div className="asset-card-title">
          <span className={`trace-source-badge is-${asset.source}`}>
            {TRACE_SOURCE_LABELS[asset.source]}
          </span>
          <strong>{asset.filename || `Candidate ${asset.candidate_position}`}</strong>
        </div>
        <p>{asset.purpose}</p>
        {asset.availability === 'unavailable' && (
          <small>{asset.availability_reason || 'Image is unavailable.'}</small>
        )}
      </div>
      <div className="asset-card-controls">
        {included && (
          <>
            <button
              type="button"
              className="icon-button asset-reorder-handle"
              aria-label={`Reorder ${asset.filename || 'asset'}`}
              disabled={!reviewReady}
              onKeyDown={handleReorderKey}
            >
              <GripVertical size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Move asset up"
              disabled={!reviewReady || selectedIndex === 0}
              onClick={() => onMove(asset.id, -1)}
            >
              <ArrowUp size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Move asset down"
              disabled={!reviewReady || selectedIndex === selectedCount - 1}
              onClick={() => onMove(asset.id, 1)}
            >
              <ArrowDown size={14} aria-hidden="true" />
            </button>
          </>
        )}
        <button
          type="button"
          className={`asset-toggle${included ? ' is-included' : ''}`}
          aria-pressed={included}
          disabled={!reviewReady || asset.availability !== 'available'}
          onClick={() => onToggle(asset)}
        >
          {included ? <Check size={14} aria-hidden="true" /> : null}
          {included ? 'Included' : 'Include'}
        </button>
      </div>
    </article>
  )
}
