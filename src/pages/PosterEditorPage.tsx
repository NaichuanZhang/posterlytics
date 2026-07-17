import {
  BarChart3,
  Copy,
  EyeOff,
  MapPin,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import {
  GenerationStageProgress,
  type GenerationStageItem,
} from '../components/GenerationStageProgress'
import { GenerationReferences } from '../components/GenerationReferences'
import { Layout } from '../components/Layout'
import { LayoutPreview } from '../components/LayoutPreview'
import { Poster } from '../components/Poster'
import { PosterExportButton } from '../components/PosterExportButton'
import { PosterVersionHistory } from '../components/PosterVersionHistory'
import { Spinner } from '../components/ui/Spinner'
import { useCampaign } from '../hooks/useCampaign'
import { useElementWidth } from '../hooks/useElementWidth'
import { usePlacements } from '../hooks/usePlacements'
import { usePosterGenerations } from '../hooks/usePosterGenerations'
import {
  activatePosterGeneration,
  createPosterGeneration,
  failPosterGeneration,
  invokeGenerationFunction,
} from '../lib/generationApi'
import { overlayGeneration } from '../lib/generations'
import { insforge } from '../lib/insforge'
import { deleteReferenceImages, uploadReferenceImages } from '../lib/referenceStorage'
import { normalizeReferenceContext } from '../lib/references'
import type { PosterGenerationStage } from '../lib/types'
import { buildViewUrl } from '../lib/viewUrl'

type BusyAction = 'generate' | 'activate' | 'published' | 'draft' | 'delete'

const INITIAL_STAGES: GenerationStageItem[] = [
  { key: 'analyze', label: 'Analyze', status: 'pending' },
  { key: 'designer', label: 'Design', status: 'pending' },
  { key: 'hero', label: 'Paint', status: 'pending' },
]

export function PosterEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { campaign, loading, reload, remove } = useCampaign(id)
  const {
    generations,
    loading: generationsLoading,
    error: generationsError,
    reload: reloadGenerations,
  } = usePosterGenerations(id)
  const { placements, ensureDefault } = usePlacements(id, user?.id)

  const [busy, setBusy] = useState<BusyAction | null>(null)
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null)
  const [selectedGenerationId, setSelectedGenerationId] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const [referenceFiles, setReferenceFiles] = useState<File[]>([])
  const [refreshWebsite, setRefreshWebsite] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [stages, setStages] = useState<GenerationStageItem[]>(INITIAL_STAGES)
  const [showStages, setShowStages] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    if (user?.id) void ensureDefault()
  }, [user?.id, ensureDefault])

  useEffect(() => {
    if (placements.length === 0) {
      setSelectedPlacementId(null)
      return
    }
    if (!placements.some((placement) => placement.id === selectedPlacementId)) {
      setSelectedPlacementId(placements[0].id)
    }
  }, [placements, selectedPlacementId])

  useEffect(() => {
    if (!campaign || generations.length === 0) return
    setSelectedGenerationId((selected) => {
      if (selected && generations.some((generation) => generation.id === selected)) return selected
      return campaign.current_generation_id ?? generations[0].id
    })
  }, [campaign, generations])

  const selectedPlacement =
    placements.find((placement) => placement.id === selectedPlacementId) ??
    placements[0] ??
    null
  const selectedGeneration =
    generations.find((generation) => generation.id === selectedGenerationId) ?? null
  const previewCampaign = useMemo(
    () => campaign ? overlayGeneration(campaign, selectedGeneration) : null,
    [campaign, selectedGeneration],
  )

  if (loading) return <Layout><Spinner full /></Layout>
  if (!campaign || !previewCampaign) {
    return <Layout><p className="muted">Campaign not found.</p></Layout>
  }

  const campaignId = campaign.id
  const campaignScenario = campaign.scenario
  const previewCode = selectedPlacement?.code ?? null
  const published = campaign.status === 'published'
  const firstVersion = !campaign.current_generation_id
  const effectiveRefreshWebsite = firstVersion || refreshWebsite
  const generating = busy === 'generate'

  function patchStage(
    key: GenerationStageItem['key'],
    status: GenerationStageItem['status'],
  ) {
    setStages((current) =>
      current.map((stage) => stage.key === key ? { ...stage, status } : stage)
    )
  }

  async function generateVersion() {
    if (!user || generating) return

    setBusy('generate')
    setGenerationError(null)
    setShowStages(true)
    setStages(INITIAL_STAGES.map((stage) => ({
      ...stage,
      status: stage.key === 'analyze' && !effectiveRefreshWebsite ? 'skipped' : 'pending',
    })))

    let uploaded = [] as Awaited<ReturnType<typeof uploadReferenceImages>>
    let generationId: string | null = null
    let failureStage: PosterGenerationStage = effectiveRefreshWebsite ? 'analyze' : 'designer'

    try {
      uploaded = await uploadReferenceImages(user.id, campaignId, referenceFiles)
      const generation = await createPosterGeneration({
        campaignId,
        instruction: normalizeReferenceContext(instruction),
        referenceImages: uploaded,
        refreshWebsite: effectiveRefreshWebsite,
      })
      generationId = generation.id

      if (effectiveRefreshWebsite) {
        patchStage('analyze', 'running')
        await invokeGenerationFunction('analyze', campaignId, generation.id)
        patchStage('analyze', 'done')
      }

      if (campaignScenario === 'event') {
        patchStage('designer', 'skipped')
      } else {
        failureStage = 'designer'
        patchStage('designer', 'running')
        await invokeGenerationFunction('designer', campaignId, generation.id)
        patchStage('designer', 'done')
      }

      failureStage = 'hero'
      patchStage('hero', 'running')
      await invokeGenerationFunction('hero', campaignId, generation.id)
      patchStage('hero', 'done')

      setSelectedGenerationId(generation.id)
      await Promise.all([reload(), reloadGenerations()])
      setInstruction('')
      setReferenceFiles([])
      setRefreshWebsite(false)
      setShowStages(false)
    } catch (cause) {
      if (generationId) {
        await failPosterGeneration(generationId, failureStage, cause)
      } else if (uploaded.length > 0) {
        await deleteReferenceImages(uploaded)
      }
      const key = failureStage === 'analyze'
        ? 'analyze'
        : failureStage === 'designer'
          ? 'designer'
          : 'hero'
      patchStage(key, 'error')
      setGenerationError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  async function useVersion(generationId: string) {
    setBusy('activate')
    setGenerationError(null)
    try {
      await activatePosterGeneration(generationId)
      setSelectedGenerationId(generationId)
      await Promise.all([reload(), reloadGenerations()])
    } catch (cause) {
      setGenerationError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  async function setStatus(status: 'published' | 'draft') {
    setBusy(status)
    try {
      const { error } = await insforge.database
        .from('campaigns')
        .update({ status })
        .eq('id', campaignId)
      if (error) throw new Error(error.message)
      await reload()
    } catch (cause) {
      setGenerationError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  function copyLink() {
    if (!selectedPlacement) return
    void navigator.clipboard?.writeText(buildViewUrl(selectedPlacement.code))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  async function deleteCampaign() {
    setBusy('delete')
    try {
      await remove()
      navigate('/')
    } catch (cause) {
      setGenerationError(cause instanceof Error ? cause.message : String(cause))
      setConfirmingDelete(false)
      setBusy(null)
    }
  }

  return (
    <Layout>
      <div className="poster-editor">
        <header className="ed-head">
          <div className="row between" style={{ marginBottom: 4 }}>
            <h1 className="page-title">{campaign.product_name}</h1>
            <span className={`badge ${campaign.status}`}>{campaign.status}</span>
          </div>
          <p className="page-sub" style={{ margin: 0 }}>
            <Link to="/">&larr; All campaigns</Link>
          </p>
        </header>

        {!published && (
          <div className="ed-banner card">
            <div className="row between ed-banner-row">
              <span>
                <strong>Draft, not live.</strong>{' '}
                <span className="muted">Scanning a placement shows the unpublished page.</span>
              </span>
              <button className="btn sm" onClick={() => void setStatus('published')} disabled={!!busy}>
                <Send size={15} aria-hidden="true" />
                {busy === 'published' ? 'Publishing...' : 'Publish'}
              </button>
            </div>
          </div>
        )}

        <section className="ed-canvas">
          <PreviewCell
            label={selectedGeneration
              ? `Version ${selectedGeneration.version_number}`
              : 'Current poster'}
          >
            {(width) =>
              !previewCampaign.hero_image_url && previewCampaign.poster_layout ? (
                <LayoutPreview layout={previewCampaign.poster_layout} width={width} />
              ) : previewCode ? (
                <Poster campaign={previewCampaign} code={previewCode} width={width} />
              ) : (
                <p className="muted preview-message">Preparing your placement...</p>
              )
            }
          </PreviewCell>
        </section>

        <div className="ed-versions">
          <PosterVersionHistory
            generations={generations}
            selectedGeneration={selectedGeneration}
            currentGenerationId={campaign.current_generation_id}
            previewCampaign={previewCampaign}
            placement={selectedPlacement}
            loading={generationsLoading}
            error={generationsError}
            activating={busy === 'activate'}
            onSelect={setSelectedGenerationId}
            onActivate={(generationId) => void useVersion(generationId)}
          />
        </div>

        <aside className="ed-rail">
          <div className="card generation-composer">
            <div className="composer-title">
              <Sparkles size={18} aria-hidden="true" />
              <h2>Create next version</h2>
            </div>
            <GenerationReferences
              context={instruction}
              onContextChange={setInstruction}
              existingImages={[]}
              onRemoveExisting={() => {}}
              pendingFiles={referenceFiles}
              onPendingFilesChange={setReferenceFiles}
              disabled={generating}
              contextLabel="What should change?"
              contextPlaceholder="Make the headline larger, swap the product image, or adjust the mood."
              contextHint="Everything else will be preserved."
            />
            <label className="generation-refresh">
              <input
                type="checkbox"
                checked={effectiveRefreshWebsite}
                disabled={generating || firstVersion}
                onChange={(event) => setRefreshWebsite(event.target.checked)}
              />
              <span>Re-read website before generating</span>
            </label>
            <button
              type="button"
              className="btn composer-submit"
              disabled={!!busy}
              onClick={() => void generateVersion()}
            >
              <Sparkles size={16} aria-hidden="true" />
              {generating ? 'Generating...' : 'Generate new version'}
            </button>
            {showStages && <GenerationStageProgress stages={stages} />}
            {generationError && (
              <p className="composer-error" role="alert">{generationError}</p>
            )}
          </div>

          <div className="card">
            <h3>Placements & tracking</h3>
            {placements.length === 0 ? (
              <p className="muted">Preparing your placement...</p>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="placement-select">Placement</label>
                  <select
                    id="placement-select"
                    className="input"
                    value={selectedPlacement?.id ?? ''}
                    onChange={(event) => setSelectedPlacementId(event.target.value)}
                  >
                    {placements.map((placement) => (
                      <option key={placement.id} value={placement.id}>{placement.label}</option>
                    ))}
                  </select>
                </div>
                <div className="editor-action-list">
                  {selectedPlacement && (
                    <PosterExportButton
                      campaign={previewCampaign}
                      placement={selectedPlacement}
                      label="Download poster"
                      versionNumber={selectedGeneration?.version_number ?? undefined}
                    />
                  )}
                  <button className="btn secondary sm" onClick={copyLink}>
                    <Copy size={15} aria-hidden="true" />
                    {copied ? 'Copied' : 'Copy link'}
                  </button>
                  <Link to={`/campaigns/${campaign.id}/placements`} className="btn secondary sm">
                    <MapPin size={15} aria-hidden="true" />
                    Placements
                  </Link>
                  <Link to={`/campaigns/${campaign.id}/analytics`} className="btn secondary sm">
                    <BarChart3 size={15} aria-hidden="true" />
                    Analytics
                  </Link>
                </div>
              </>
            )}
          </div>

          <div className="card">
            <h3>{published ? 'Live' : 'Publish'}</h3>
            {published ? (
              <button className="btn danger sm" onClick={() => void setStatus('draft')} disabled={!!busy}>
                <EyeOff size={15} aria-hidden="true" />
                {busy === 'draft' ? 'Unpublishing...' : 'Unpublish'}
              </button>
            ) : (
              <button className="btn sm" onClick={() => void setStatus('published')} disabled={!!busy}>
                <Send size={15} aria-hidden="true" />
                {busy === 'published' ? 'Publishing...' : 'Publish campaign'}
              </button>
            )}

            <div className="danger-zone">
              {confirmingDelete ? (
                <>
                  <p className="muted">Delete this campaign and all saved versions permanently?</p>
                  <div className="editor-action-list">
                    <button className="btn danger sm" onClick={() => void deleteCampaign()} disabled={!!busy}>
                      <Trash2 size={15} aria-hidden="true" />
                      {busy === 'delete' ? 'Deleting...' : 'Confirm delete'}
                    </button>
                    <button className="btn ghost sm" onClick={() => setConfirmingDelete(false)} disabled={!!busy}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <button className="btn danger sm" onClick={() => setConfirmingDelete(true)} disabled={!!busy}>
                  <Trash2 size={15} aria-hidden="true" />
                  Delete campaign
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>
    </Layout>
  )
}

function PreviewCell({
  label,
  children,
}: {
  label: string
  children: (width: number) => React.ReactNode
}) {
  const [ref, width] = useElementWidth()
  const fitted = width > 0 ? Math.max(160, Math.floor(width) - 2) : 0
  return (
    <div ref={ref} className="card ed-preview">
      <span className="muted preview-label">{label}</span>
      {fitted > 0 ? children(fitted) : null}
    </div>
  )
}
