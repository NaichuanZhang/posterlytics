import {
  BarChart3,
  Copy,
  EyeOff,
  MapPin,
  PanelLeft,
  PanelRight,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppShell } from '../components/AppShell'
import {
  GenerationStageProgress,
  type GenerationStageItem,
} from '../components/GenerationStageProgress'
import { GenerationReferences } from '../components/GenerationReferences'
import { PosterCanvas } from '../components/PosterCanvas'
import { PosterExportButton } from '../components/PosterExportButton'
import { PosterVersionHistory } from '../components/PosterVersionHistory'
import { InlineNotice } from '../components/ui/Feedback'
import { Spinner } from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { useCampaign } from '../hooks/useCampaign'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { usePlacements } from '../hooks/usePlacements'
import { usePosterGenerations } from '../hooks/usePosterGenerations'
import { useWorkspacePreferences } from '../hooks/useWorkspacePreferences'
import {
  activatePosterGeneration,
  createPosterGeneration,
  failPosterGeneration,
  invokeGenerationFunction,
} from '../lib/generationApi'
import { overlayGeneration } from '../lib/generations'
import { insforge } from '../lib/insforge'
import { deleteReferenceImages, materializeReferenceImages } from '../lib/referenceStorage'
import {
  normalizeReferenceContext,
  pendingReferencesReady,
  type PendingReference,
} from '../lib/references'
import type { PosterGenerationStage } from '../lib/types'
import { buildViewUrl } from '../lib/viewUrl'

type BusyAction = 'generate' | 'activate' | 'published' | 'draft' | 'delete'
type MobileSection = 'versions' | 'create' | 'export'

const INITIAL_STAGES: GenerationStageItem[] = [
  { key: 'analyze', label: 'Analyze', status: 'pending' },
  { key: 'designer', label: 'Design', status: 'pending' },
  { key: 'hero', label: 'Paint', status: 'pending' },
]

export function PosterEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { notify } = useToast()
  const { campaign, loading, reload, remove } = useCampaign(id)
  const {
    generations,
    loading: generationsLoading,
    error: generationsError,
    reload: reloadGenerations,
  } = usePosterGenerations(id)
  const { placements, ensureDefault } = usePlacements(id, user?.id)
  const { preferences, updatePreferences } = useWorkspacePreferences()
  const isMobileWorkspace = useMediaQuery('(max-width: 899px)')
  const isVersionsDrawer = useMediaQuery('(min-width: 900px) and (max-width: 1199px)')

  const [busy, setBusy] = useState<BusyAction | null>(null)
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null)
  const [selectedGenerationId, setSelectedGenerationId] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const [pendingReferences, setPendingReferences] = useState<PendingReference[]>([])
  const [refreshWebsite, setRefreshWebsite] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [stages, setStages] = useState<GenerationStageItem[]>(INITIAL_STAGES)
  const [showStages, setShowStages] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [versionsDrawerOpen, setVersionsDrawerOpen] = useState(false)
  const [mobileSection, setMobileSection] = useState<MobileSection>('create')

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
    placements.find((placement) => placement.id === selectedPlacementId)
    ?? placements[0]
    ?? null
  const selectedGeneration =
    generations.find((generation) => generation.id === selectedGenerationId) ?? null
  const previewCampaign = useMemo(
    () => campaign ? overlayGeneration(campaign, selectedGeneration) : null,
    [campaign, selectedGeneration],
  )

  if (loading) {
    return (
      <AppShell mode="workspace" breadcrumbs={[{ label: 'Campaigns', to: '/' }, { label: 'Loading' }]}>
        <Spinner full />
      </AppShell>
    )
  }
  if (!campaign || !previewCampaign) {
    return (
      <AppShell breadcrumbs={[{ label: 'Campaigns', to: '/' }, { label: 'Not found' }]}>
        <InlineNotice tone="error">Campaign not found.</InlineNotice>
      </AppShell>
    )
  }

  const campaignId = campaign.id
  const campaignScenario = campaign.scenario
  const previewCode = selectedPlacement?.code ?? null
  const published = campaign.status === 'published'
  const firstVersion = !campaign.current_generation_id
  const effectiveRefreshWebsite = firstVersion || refreshWebsite
  const generating = busy === 'generate'
  const showDesktopVersions = !isMobileWorkspace && (
    isVersionsDrawer ? versionsDrawerOpen : preferences.versionsPanelOpen
  )

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
    if (!pendingReferencesReady(pendingReferences)) {
      setGenerationError('Remove any image URL that could not load, or wait for its preview to finish.')
      return
    }

    setBusy('generate')
    setGenerationError(null)
    setShowStages(true)
    setStages(INITIAL_STAGES.map((stage) => ({
      ...stage,
      status: stage.key === 'analyze' && !effectiveRefreshWebsite ? 'skipped' : 'pending',
    })))

    let uploaded = [] as Awaited<ReturnType<typeof materializeReferenceImages>>
    let generationId: string | null = null
    let failureStage: PosterGenerationStage = effectiveRefreshWebsite ? 'analyze' : 'designer'

    try {
      uploaded = await materializeReferenceImages(user.id, campaignId, pendingReferences)
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
      setPendingReferences([])
      setRefreshWebsite(false)
      setShowStages(false)
      notify('New poster version created.', 'success')
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
      const message = cause instanceof Error ? cause.message : String(cause)
      setGenerationError(message)
      notify('Poster generation did not complete.', 'error')
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
      notify('Current poster version updated.', 'success')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setGenerationError(message)
      notify('The selected version could not be restored.', 'error')
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
      notify(status === 'published' ? 'Campaign published.' : 'Campaign moved to draft.', 'success')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setGenerationError(message)
      notify('Campaign status could not be updated.', 'error')
    } finally {
      setBusy(null)
    }
  }

  function copyLink() {
    if (!selectedPlacement) return
    void navigator.clipboard?.writeText(buildViewUrl(selectedPlacement.code))
    notify('Tracked link copied.', 'success')
  }

  async function deleteCampaign() {
    setBusy('delete')
    try {
      await remove()
      notify('Campaign deleted.', 'success')
      navigate('/')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setGenerationError(message)
      setConfirmingDelete(false)
      setBusy(null)
      notify('Campaign could not be deleted.', 'error')
    }
  }

  function toggleVersions() {
    if (isMobileWorkspace) {
      setMobileSection('versions')
    } else if (isVersionsDrawer) {
      setVersionsDrawerOpen((open) => !open)
    } else {
      updatePreferences({ versionsPanelOpen: !preferences.versionsPanelOpen })
    }
  }

  const versionPanel = (
    <PosterVersionHistory
      generations={generations}
      selectedGeneration={selectedGeneration}
      currentGenerationId={campaign.current_generation_id}
      loading={generationsLoading}
      error={generationsError}
      activating={busy === 'activate'}
      onSelect={setSelectedGenerationId}
      onActivate={(generationId) => void useVersion(generationId)}
    />
  )

  const createInspector = (
    <section className="inspector-section" aria-labelledby="create-version-heading">
      <div className="panel-heading">
        <div>
          <Sparkles size={16} aria-hidden="true" />
          <h2 id="create-version-heading">Create next version</h2>
        </div>
      </div>
      <GenerationReferences
        context={instruction}
        onContextChange={setInstruction}
        existingImages={[]}
        onRemoveExisting={() => {}}
        pendingReferences={pendingReferences}
        onPendingReferencesChange={setPendingReferences}
        disabled={generating}
        contextLabel="What should change?"
        contextPlaceholder="Make the headline larger, replace the product image, or adjust the mood."
        contextHint="Everything else stays consistent."
      />
      <label className="check-control">
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
        className="button button-primary inspector-primary"
        disabled={!!busy || !pendingReferencesReady(pendingReferences)}
        onClick={() => void generateVersion()}
      >
        <Sparkles size={15} aria-hidden="true" />
        {generating ? 'Generating' : 'Generate version'}
      </button>
      {showStages && <GenerationStageProgress stages={stages} />}
      {generationError && <InlineNotice tone="error">{generationError}</InlineNotice>}
    </section>
  )

  const exportInspector = (
    <section className="inspector-section" aria-labelledby="export-heading">
      <div className="panel-heading">
        <div>
          <MapPin size={16} aria-hidden="true" />
          <h2 id="export-heading">Placement & export</h2>
        </div>
      </div>
      {placements.length === 0 ? (
        <p className="panel-empty">Preparing the primary placement.</p>
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
          {selectedGeneration && (
            <p className="selection-note">Exporting version {selectedGeneration.version_number ?? '-'}</p>
          )}
          <div className="inspector-actions">
            {selectedPlacement && (
              <PosterExportButton
                campaign={previewCampaign}
                placement={selectedPlacement}
                label="Download poster"
                versionNumber={selectedGeneration?.version_number ?? undefined}
              />
            )}
            <button type="button" className="button button-secondary button-small" onClick={copyLink}>
              <Copy size={15} aria-hidden="true" />
              Copy tracked link
            </button>
            <Link to={`/campaigns/${campaign.id}/placements`} className="button button-secondary button-small">
              <MapPin size={15} aria-hidden="true" />
              Manage placements
            </Link>
            <Link to={`/campaigns/${campaign.id}/analytics`} className="button button-secondary button-small">
              <BarChart3 size={15} aria-hidden="true" />
              View analytics
            </Link>
          </div>
        </>
      )}
    </section>
  )

  const versionsActive = isMobileWorkspace
    ? mobileSection === 'versions'
    : isVersionsDrawer
      ? versionsDrawerOpen
      : preferences.versionsPanelOpen

  return (
    <AppShell
      mode="workspace"
      breadcrumbs={[
        { label: 'Campaigns', to: '/' },
        { label: campaign.product_name },
      ]}
      campaign={campaign}
      activeSection="poster"
      actions={(
        <>
          <button
            type="button"
            className={`toolbar-icon${versionsActive ? ' is-active' : ''}`}
            aria-label="Toggle versions panel"
            aria-pressed={versionsActive}
            data-tooltip="Versions"
            onClick={toggleVersions}
          >
            <PanelLeft size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`toolbar-icon inspector-toggle${preferences.inspectorPanelOpen ? ' is-active' : ''}`}
            aria-label="Toggle inspector"
            aria-pressed={preferences.inspectorPanelOpen}
            data-tooltip="Inspector"
            onClick={() => updatePreferences({ inspectorPanelOpen: !preferences.inspectorPanelOpen })}
          >
            <PanelRight size={17} aria-hidden="true" />
          </button>
          <span className="toolbar-divider" />
          <button
            type="button"
            className={published ? 'toolbar-button' : 'toolbar-button toolbar-button-primary'}
            disabled={!!busy}
            onClick={() => void setStatus(published ? 'draft' : 'published')}
          >
            {published ? <EyeOff size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
            <span>{published ? 'Unpublish' : 'Publish'}</span>
          </button>
          <div className="toolbar-confirm-wrap">
            <button
              type="button"
              className="toolbar-icon toolbar-icon-danger"
              aria-label="Delete campaign"
              data-tooltip="Delete campaign"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
            {confirmingDelete && (
              <div className="toolbar-confirmation" role="alertdialog" aria-label="Confirm campaign deletion">
                <strong>Delete this campaign?</strong>
                <span>All versions and placements will be removed.</span>
                <div>
                  <button
                    type="button"
                    className="button button-danger button-small"
                    disabled={!!busy}
                    onClick={() => void deleteCampaign()}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    {busy === 'delete' ? 'Deleting' : 'Delete'}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Cancel deletion"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    >
      <div
        className={[
          'editor-workspace',
          showDesktopVersions ? 'has-versions' : 'no-versions',
          preferences.inspectorPanelOpen ? 'has-inspector' : 'no-inspector',
        ].join(' ')}
      >
        {showDesktopVersions && (
          <>
            {isVersionsDrawer && (
              <button
                type="button"
                className="drawer-backdrop"
                aria-label="Close versions panel"
                onClick={() => setVersionsDrawerOpen(false)}
              />
            )}
            <aside className={`versions-panel${isVersionsDrawer ? ' is-drawer' : ''}`}>
              {isVersionsDrawer && (
                <button
                  type="button"
                  className="panel-close"
                  aria-label="Close versions panel"
                  onClick={() => setVersionsDrawerOpen(false)}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              )}
              {versionPanel}
            </aside>
          </>
        )}

        <section className="editor-canvas-column">
          {!published && (
            <div className="draft-banner">
              <span>Draft</span>
              Scans open an unpublished page until this campaign is published.
            </div>
          )}
          <PosterCanvas
            campaign={previewCampaign}
            code={previewCode}
            zoom={preferences.zoom}
            versionLabel={selectedGeneration
              ? `Version ${selectedGeneration.version_number ?? '-'}`
              : 'Current poster'}
            onZoomChange={(zoom) => updatePreferences({ zoom })}
          />

          {isMobileWorkspace && (
            <div className="mobile-workspace-panels">
              <div className="segmented-control mobile-workspace-tabs" aria-label="Editor sections">
                {([
                  ['versions', 'Versions'],
                  ['create', 'Create'],
                  ['export', 'Export'],
                ] as Array<[MobileSection, string]>).map(([section, label]) => (
                  <button
                    key={section}
                    type="button"
                    className={mobileSection === section ? 'is-active' : ''}
                    aria-pressed={mobileSection === section}
                    onClick={() => setMobileSection(section)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mobile-panel-content">
                {mobileSection === 'versions' && versionPanel}
                {mobileSection === 'create' && createInspector}
                {mobileSection === 'export' && exportInspector}
              </div>
            </div>
          )}
        </section>

        {!isMobileWorkspace && preferences.inspectorPanelOpen && (
          <aside className="editor-inspector">
            {createInspector}
            {exportInspector}
          </aside>
        )}
      </div>
    </AppShell>
  )
}
