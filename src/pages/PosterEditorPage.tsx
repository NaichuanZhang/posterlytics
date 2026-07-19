import {
  BarChart3,
  Copy,
  Download,
  EyeOff,
  BadgeCheck,
  MapPin,
  PanelLeft,
  PanelRight,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useGenerationActivity } from '../activity/GenerationActivityProvider'
import { useAuth } from '../auth/AuthProvider'
import { AppShell } from '../components/AppShell'
import { AssetSelectionModeControl } from '../components/AssetSelectionModeControl'
import { DurableGenerationStatus } from '../components/DurableGenerationStatus'
import { GenerationDetailsSheet } from '../components/GenerationDetailsSheet'
import { GenerationInputsReview } from '../components/GenerationInputsReview'
import { GenerationReferences } from '../components/GenerationReferences'
import { PlatformHintField } from '../components/PlatformHintField'
import { PosterCanvas } from '../components/PosterCanvas'
import { PosterExportButton } from '../components/PosterExportButton'
import { PosterFormatSelect } from '../components/PosterFormatSelect'
import { PosterVersionHistory } from '../components/PosterVersionHistory'
import { InlineNotice } from '../components/ui/Feedback'
import { Spinner } from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { useCampaign } from '../hooks/useCampaign'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { usePlacements } from '../hooks/usePlacements'
import { usePosterGenerations } from '../hooks/usePosterGenerations'
import { useWorkspacePreferences } from '../hooks/useWorkspacePreferences'
import { useI18n } from '../i18n/I18nProvider'
import {
  activatePosterGeneration,
  enqueuePosterGeneration,
} from '../lib/generationApi'
import {
  activityForCampaign,
  isActiveGenerationJob,
  shouldAutoSelectGeneration,
} from '../lib/generationActivity'
import { overlayGeneration } from '../lib/generations'
import { deriveGenerationPreflight } from '../lib/generationTraces'
import { insforge } from '../lib/insforge'
import {
  getPosterSize,
  hasPosterQrBand,
  type PosterSizeSlug,
} from '../lib/posterSize'
import { normalizePlatformHint } from '../lib/platformHints'
import { deleteReferenceImages, materializeReferenceImages } from '../lib/referenceStorage'
import {
  normalizeReferenceContext,
  pendingReferencesReady,
  type PendingReference,
} from '../lib/references'
import type { PosterGeneration } from '../lib/types'
import { getUseCase } from '../lib/useCases'
import { buildViewUrl } from '../lib/viewUrl'

type BusyAction =
  | 'generate'
  | 'activate'
  | 'published'
  | 'draft'
  | 'delete'
  | 'format'
  | 'platform'
type MobileSection = 'versions' | 'create' | 'export'

export function PosterEditorPage() {
  const { locale, t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { notify } = useToast()
  const {
    items: generationActivity,
    refresh: refreshActivity,
    retry: retryActivity,
  } = useGenerationActivity()
  const { campaign, loading, reload, remove } = useCampaign(id)
  const {
    generations,
    activeGenerations,
    failedGenerations,
    loading: generationsLoading,
    error: generationsError,
    reload: reloadGenerations,
  } = usePosterGenerations(id)
  const campaignTrackingEnabled = campaign
    ? getUseCase(campaign.use_case).trackingEnabled
    : false
  const { placements, ensureDefault } = usePlacements(
    id,
    user?.id,
    campaignTrackingEnabled,
  )
  const { preferences, updatePreferences } = useWorkspacePreferences()
  const isMobileWorkspace = useMediaQuery('(max-width: 899px)')
  const isVersionsDrawer = useMediaQuery('(min-width: 900px) and (max-width: 1199px)')

  const [busy, setBusy] = useState<BusyAction | null>(null)
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null)
  const [selectedGenerationId, setSelectedGenerationId] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const [platformHint, setPlatformHint] = useState('')
  const [pendingReferences, setPendingReferences] = useState<PendingReference[]>([])
  const [refreshWebsite, setRefreshWebsite] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [versionsDrawerOpen, setVersionsDrawerOpen] = useState(false)
  const [mobileSection, setMobileSection] = useState<MobileSection>('create')
  const [detailsGeneration, setDetailsGeneration] = useState<PosterGeneration | null>(null)
  const deliberateSelectionRef = useRef(false)
  const activitySnapshotRef = useRef<string | null>(null)
  const trackedJobRef = useRef<string | null>(null)

  useEffect(() => {
    if (user?.id && campaignTrackingEnabled) void ensureDefault()
  }, [campaignTrackingEnabled, user?.id, ensureDefault])

  useEffect(() => {
    setPlatformHint(campaign?.platform_hint ?? '')
  }, [campaign?.id, campaign?.platform_hint])

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

  const campaignActivity = id ? activityForCampaign(generationActivity, id) : null
  const latestCampaignActivity = id
    ? generationActivity.find((item) => item.campaign_id === id) ?? null
    : null

  useEffect(() => {
    if (!latestCampaignActivity) return
    const snapshot = [
      latestCampaignActivity.job_id,
      latestCampaignActivity.status,
      latestCampaignActivity.stage,
      latestCampaignActivity.updated_at,
    ].join(':')
    const previousSnapshot = activitySnapshotRef.current
    activitySnapshotRef.current = snapshot

    if (isActiveGenerationJob(latestCampaignActivity)) {
      trackedJobRef.current = latestCampaignActivity.job_id
    }
    if (previousSnapshot === null || previousSnapshot === snapshot) return

    void Promise.all([reload(), reloadGenerations()]).then(() => {
      if (
        latestCampaignActivity.status === 'succeeded'
        && trackedJobRef.current === latestCampaignActivity.job_id
        && shouldAutoSelectGeneration({
          completedGenerationId: latestCampaignActivity.generation_id,
          selectedGenerationId,
          selectionWasDeliberate: deliberateSelectionRef.current,
        })
      ) {
        setSelectedGenerationId(latestCampaignActivity.generation_id)
      }
      if (!isActiveGenerationJob(latestCampaignActivity)) {
        trackedJobRef.current = null
      }
    })
  }, [
    latestCampaignActivity?.generation_id,
    latestCampaignActivity?.job_id,
    latestCampaignActivity?.stage,
    latestCampaignActivity?.status,
    latestCampaignActivity?.updated_at,
    reload,
    reloadGenerations,
    selectedGenerationId,
  ])

  const selectedPlacement =
    placements.find((placement) => placement.id === selectedPlacementId)
    ?? placements[0]
    ?? null
  const selectedGeneration =
    generations.find((generation) => generation.id === selectedGenerationId) ?? null
  const currentGeneration = campaign?.current_generation_id
    ? generations.find((generation) => generation.id === campaign.current_generation_id) ?? null
    : null
  const previewGeneration = selectedGeneration ?? currentGeneration
  const previewCampaign = useMemo(
    () => campaign ? overlayGeneration(campaign, previewGeneration) : null,
    [campaign, previewGeneration],
  )

  if (loading || generationsLoading) {
    return (
      <AppShell mode="workspace" breadcrumbs={[
        { label: t('Campaigns'), to: '/' },
        { label: t('Loading') },
      ]}>
        <Spinner full />
      </AppShell>
    )
  }
  if (!campaign || !previewCampaign) {
    return (
      <AppShell breadcrumbs={[
        { label: t('Campaigns'), to: '/' },
        { label: t('Not found') },
      ]}>
        <InlineNotice tone="error">{t('Campaign not found.')}</InlineNotice>
      </AppShell>
    )
  }
  const campaignId = campaign.id
  const campaignPlatformHint = campaign.platform_hint
  const previewCode = campaignTrackingEnabled
    ? selectedPlacement?.code ?? null
    : null
  const previewPosterSize = getPosterSize(
    previewGeneration
      ? previewGeneration.poster_format
      : campaign.current_generation_id
        ? undefined
        : campaign.poster_format,
  )
  const targetPosterSize = getPosterSize(campaign.poster_format)
  const previewIncludesQrBand = hasPosterQrBand(previewPosterSize)
  const published = campaign.status === 'published'
  const firstVersion = !campaign.current_generation_id
  const campaignUseCase = getUseCase(campaign.use_case)
  const amazonReferenceMode = campaignUseCase.id === 'amazon_listing'
  const socialReferenceMode = campaignUseCase.id === 'social_cover'
  const effectiveRefreshWebsite = socialReferenceMode || firstVersion || refreshWebsite
  const uploadingInputs = busy === 'generate'
  const generating = !!campaignActivity
  const generationInputsDisabled = uploadingInputs || generating
  const generationPreflight = deriveGenerationPreflight({
    campaign,
    currentGeneration,
    selectedGeneration,
    instruction,
    pendingReferences,
    refreshWebsite: effectiveRefreshWebsite,
    locale,
  })
  const showDesktopVersions = !isMobileWorkspace && (
    isVersionsDrawer ? versionsDrawerOpen : preferences.versionsPanelOpen
  )
  const minimumReferenceImages = Math.max(
    campaignUseCase.inputFields.referenceImages.minimumCount,
    campaignUseCase.inputFields.referenceImages.requirement === 'required' ? 1 : 0,
  )
  const referenceMinimumMet = pendingReferences.length >= minimumReferenceImages
  const useCaseReferenceProps = amazonReferenceMode
    ? {
        contextLabel: t('Listing copy and creative direction'),
        contextPlaceholder: t('Paste updated listing copy, approved claims, or describe what should change.'),
        contextHint: t('Seller-provided copy is the primary copy source.'),
        referenceImagesLabel: t('Product and brand images'),
        referenceImagesHint: t('Seller-provided images are the primary visual source.'),
      }
    : socialReferenceMode
      ? {
          contextLabel: t('Creative direction'),
          contextPlaceholder: t('Describe the mood, visual hook, audience, and what should change.'),
          contextHint: t('The supplied references are re-analyzed for every new version.'),
          referenceImagesLabel: t('Creative references'),
          referenceImagesHint: t('Add at least one fresh reference for this version.'),
        }
    : {
        contextLabel: t('What should change?'),
        contextPlaceholder: t('Make the headline larger, replace the product image, or adjust the mood.'),
        contextHint: t('Everything else stays consistent.'),
      }

  async function generateVersion() {
    if (!user || generating || uploadingInputs) return
    if (!referenceMinimumMet) {
      setGenerationError(t('Add at least {count} images.', {
        count: minimumReferenceImages,
      }))
      return
    }
    if (!pendingReferencesReady(pendingReferences)) {
      setGenerationError(t('Remove any image URL that could not load, or wait for its preview to finish.'))
      return
    }

    setBusy('generate')
    setGenerationError(null)

    let uploaded = [] as Awaited<ReturnType<typeof materializeReferenceImages>>

    try {
      if (campaignUseCase.inputFields.platformHint !== 'hidden') {
        const platformHintChanged = await persistPlatformHintTarget()
        if (platformHintChanged) await reload()
      }
      uploaded = await materializeReferenceImages(
        user.id,
        campaignId,
        pendingReferences,
        locale,
      )
      const result = await enqueuePosterGeneration({
        campaignId,
        instruction: normalizeReferenceContext(instruction),
        referenceImages: uploaded,
        refreshWebsite: effectiveRefreshWebsite,
        assetSelectionMode: preferences.assetSelectionMode,
        locale,
      })
      deliberateSelectionRef.current = false
      trackedJobRef.current = result.job.id
      await Promise.all([refreshActivity(), reloadGenerations()])
      setInstruction('')
      setPendingReferences([])
      setRefreshWebsite(false)
      if (result.generation.asset_selection_mode === 'editor') {
        navigate(
          `/campaigns/${campaignId}/generations/${result.generation.id}/assets`,
        )
      } else {
        notify(t('Generation started. Safe to leave Posterlytics.'), 'success')
      }
    } catch (cause) {
      if (uploaded.length > 0) await deleteReferenceImages(uploaded)
      const message = cause instanceof Error ? cause.message : String(cause)
      setGenerationError(message)
      notify(t('Generation could not be queued.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function useVersion(generationId: string) {
    deliberateSelectionRef.current = true
    setBusy('activate')
    setGenerationError(null)
    try {
      await activatePosterGeneration(generationId, locale)
      setSelectedGenerationId(generationId)
      await Promise.all([reload(), reloadGenerations()])
      notify(t('Current poster version updated.'), 'success')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setGenerationError(message)
      notify(t('The selected version could not be restored.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function updatePosterFormat(posterFormat: PosterSizeSlug) {
    if (posterFormat === targetPosterSize.slug) return

    setBusy('format')
    setGenerationError(null)
    try {
      const { error } = await insforge.database
        .from('campaigns')
        .update({ poster_format: posterFormat })
        .eq('id', campaignId)
      if (error) throw new Error(error.message)
      await reload()
      notify(t('Poster format updated for the next version.'), 'success')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setGenerationError(message)
      notify(t('Poster format could not be updated.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function persistPlatformHintTarget(): Promise<boolean> {
    const normalized = normalizePlatformHint(platformHint)
    if (normalized === campaignPlatformHint) return false

    const { error } = await insforge.database
      .from('campaigns')
      .update({ platform_hint: normalized })
      .eq('id', campaignId)
    if (error) throw new Error(error.message)
    return true
  }

  async function updatePlatformHint() {
    if (normalizePlatformHint(platformHint) === campaignPlatformHint) return

    setBusy('platform')
    setGenerationError(null)
    try {
      await persistPlatformHintTarget()
      await reload()
      notify(t('Target platform updated for the next version.'), 'success')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setGenerationError(message)
      notify(t('Target platform could not be updated.'), 'error')
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
      notify(
        status === 'published' ? t('Campaign published.') : t('Campaign moved to draft.'),
        'success',
      )
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setGenerationError(message)
      notify(t('Campaign status could not be updated.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  function copyLink() {
    if (!selectedPlacement) return
    void navigator.clipboard?.writeText(buildViewUrl(selectedPlacement.code))
    notify(t('Tracked link copied.'), 'success')
  }

  async function deleteCampaign() {
    setBusy('delete')
    try {
      await remove()
      notify(t('Campaign deleted.'), 'success')
      navigate('/')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setGenerationError(message)
      setConfirmingDelete(false)
      setBusy(null)
      notify(t('Campaign could not be deleted.'), 'error')
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

  function selectVersion(generationId: string) {
    deliberateSelectionRef.current = true
    setSelectedGenerationId(generationId)
  }

  async function retryGeneration(activity: Parameters<typeof retryActivity>[0]) {
    setGenerationError(null)
    deliberateSelectionRef.current = false
    try {
      await retryActivity(activity)
      await Promise.all([refreshActivity(), reloadGenerations()])
    } catch (cause) {
      setGenerationError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const versionPanel = (
    <PosterVersionHistory
      generations={generations}
      activeGenerations={activeGenerations}
      failedGenerations={failedGenerations}
      activities={generationActivity.filter((item) => item.campaign_id === campaignId)}
      selectedGeneration={selectedGeneration}
      currentGenerationId={campaign.current_generation_id}
      loading={generationsLoading}
      error={generationsError}
      activating={busy === 'activate'}
      onSelect={selectVersion}
      onActivate={(generationId) => void useVersion(generationId)}
      onReview={setDetailsGeneration}
      onRetry={(activity) => void retryGeneration(activity)}
    />
  )

  const createInspector = (
    <section className="inspector-section" aria-labelledby="create-version-heading">
      <div className="panel-heading">
        <div>
          <Sparkles size={16} aria-hidden="true" />
          <h2 id="create-version-heading">{t('Create next version')}</h2>
        </div>
      </div>
      <PosterFormatSelect
        id="next-poster-format"
        value={targetPosterSize.slug}
        disabled={generationInputsDisabled || !!busy}
        allowedFormats={campaignUseCase.allowedPosterFormats}
        onChange={(posterFormat) => void updatePosterFormat(posterFormat)}
      />
      {campaignUseCase.inputFields.platformHint !== 'hidden' && (
        <>
          <PlatformHintField
            key={campaignId}
            id="next-platform-hint"
            value={platformHint}
            disabled={generationInputsDisabled || !!busy}
            onChange={setPlatformHint}
          />
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={
              generationInputsDisabled
              || !!busy
              || normalizePlatformHint(platformHint) === campaign.platform_hint
            }
            onClick={() => void updatePlatformHint()}
          >
            {t('Save platform hint')}
          </button>
        </>
      )}
      <GenerationReferences
        context={instruction}
        onContextChange={setInstruction}
        existingImages={[]}
        onRemoveExisting={() => {}}
        pendingReferences={pendingReferences}
        onPendingReferencesChange={setPendingReferences}
        disabled={generationInputsDisabled}
        contextRequirement={campaignUseCase.inputFields.referenceContext}
        referenceImagesRequirement={campaignUseCase.inputFields.referenceImages.requirement}
        referenceImagesMinimumCount={campaignUseCase.inputFields.referenceImages.minimumCount}
        {...useCaseReferenceProps}
      />
      {amazonReferenceMode && (
        <InlineNotice>
          <strong>{t('Amazon seller reference mode')}</strong>
          <span>
            {t('Amazon listings cannot be read reliably. Add listing copy and product or brand images under Generation references; Posterlytics will use those references instead of scraping the listing.')}
          </span>
        </InlineNotice>
      )}
      <AssetSelectionModeControl
        value={preferences.assetSelectionMode}
        disabled={generationInputsDisabled}
        compact
        onChange={(assetSelectionMode) => updatePreferences({ assetSelectionMode })}
      />
      {!socialReferenceMode && (
        <label className="check-control">
          <input
            type="checkbox"
            checked={effectiveRefreshWebsite}
            disabled={generationInputsDisabled || firstVersion}
            onChange={(event) => setRefreshWebsite(event.target.checked)}
          />
          <span>{t('Re-read website before generating')}</span>
        </label>
      )}
      <GenerationInputsReview
        preflight={generationPreflight}
        disabled={generationInputsDisabled}
      />
      <button
        type="button"
        className="button button-primary inspector-primary"
        disabled={
          generationInputsDisabled
          || !!busy
          || !referenceMinimumMet
          || !pendingReferencesReady(pendingReferences)
        }
        onClick={() => void generateVersion()}
      >
        <Sparkles size={15} aria-hidden="true" />
        {uploadingInputs
          ? t('Uploading inputs')
          : generating
            ? t('Generation started')
            : t('Generate version')}
      </button>
      {generationError && <InlineNotice tone="error">{generationError}</InlineNotice>}
    </section>
  )

  const exportInspector = (
    <section className="inspector-section" aria-labelledby="export-heading">
      <div className="panel-heading">
        <div>
          {campaignTrackingEnabled
            ? <MapPin size={16} aria-hidden="true" />
            : <Download size={16} aria-hidden="true" />}
          <h2 id="export-heading">
            {campaignTrackingEnabled ? t('Placement & export') : t('Export artwork')}
          </h2>
        </div>
      </div>
      {campaignTrackingEnabled && previewIncludesQrBand && placements.length === 0 ? (
        <p className="panel-empty">{t('Preparing the primary placement.')}</p>
      ) : (
        <>
          {campaignTrackingEnabled && previewIncludesQrBand && (
            <div className="field">
              <label htmlFor="placement-select">{t('Placement')}</label>
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
          )}
          {selectedGeneration && (
            <p className="selection-note">
              {t('Exporting version {number}', {
                number: selectedGeneration.version_number ?? '-',
              })}
            </p>
          )}
          {(!campaignTrackingEnabled || !previewIncludesQrBand) && (
            <p className="selection-note">
              {t('Artwork-only export. No QR code or placement tracking is included.')}
            </p>
          )}
          <div className="inspector-actions">
            {(!campaignTrackingEnabled || !previewIncludesQrBand || selectedPlacement) && (
              <PosterExportButton
                campaign={previewCampaign}
                placement={
                  campaignTrackingEnabled && previewIncludesQrBand
                    ? selectedPlacement
                    : undefined
                }
                versionNumber={selectedGeneration?.version_number ?? undefined}
                posterSize={previewPosterSize}
              />
            )}
            {campaignTrackingEnabled && previewIncludesQrBand && selectedPlacement && (
              <button type="button" className="button button-secondary button-small" onClick={copyLink}>
                <Copy size={15} aria-hidden="true" />
                {t('Copy tracked link')}
              </button>
            )}
            {campaignTrackingEnabled && (
              <>
                <Link to={`/campaigns/${campaign.id}/placements`} className="button button-secondary button-small">
                  <MapPin size={15} aria-hidden="true" />
                  {t('Manage placements')}
                </Link>
                <Link to={`/campaigns/${campaign.id}/analytics`} className="button button-secondary button-small">
                  <BarChart3 size={15} aria-hidden="true" />
                  {t('View analytics')}
                </Link>
              </>
            )}
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
        { label: t('Campaigns'), to: '/' },
        { label: campaign.product_name },
      ]}
      campaign={campaign}
      activeSection="poster"
      actions={(
        <>
          <button
            type="button"
            className={`toolbar-icon${versionsActive ? ' is-active' : ''}`}
            aria-label={t('Toggle versions panel')}
            aria-pressed={versionsActive}
            data-tooltip={t('Versions')}
            onClick={toggleVersions}
          >
            <PanelLeft size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`toolbar-icon inspector-toggle${preferences.inspectorPanelOpen ? ' is-active' : ''}`}
            aria-label={t('Toggle inspector')}
            aria-pressed={preferences.inspectorPanelOpen}
            data-tooltip={t('Inspector')}
            onClick={() => updatePreferences({ inspectorPanelOpen: !preferences.inspectorPanelOpen })}
          >
            <PanelRight size={17} aria-hidden="true" />
          </button>
          {campaignTrackingEnabled && (
            <>
              <span className="toolbar-divider" />
              <button
                type="button"
                className={published ? 'toolbar-button' : 'toolbar-button toolbar-button-primary'}
                disabled={!!busy}
                onClick={() => void setStatus(published ? 'draft' : 'published')}
              >
                {published ? <EyeOff size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
                <span>{published ? t('Unpublish') : t('Publish')}</span>
              </button>
            </>
          )}
          <div className="toolbar-confirm-wrap">
            <button
              type="button"
              className="toolbar-icon toolbar-icon-danger"
              aria-label={t('Delete campaign')}
              data-tooltip={t('Delete campaign')}
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
            {confirmingDelete && (
              <div
                className="toolbar-confirmation"
                role="alertdialog"
                aria-label={t('Confirm campaign deletion')}
              >
                <strong>{t('Delete this campaign?')}</strong>
                <span>
                  {campaignTrackingEnabled
                    ? t('All versions and placements will be removed.')
                    : t('All artwork versions will be removed.')}
                </span>
                <div>
                  <button
                    type="button"
                    className="button button-danger button-small"
                    disabled={!!busy}
                    onClick={() => void deleteCampaign()}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    {busy === 'delete' ? t('Deleting') : t('Delete')}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('Cancel deletion')}
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
                aria-label={t('Close versions panel')}
                onClick={() => setVersionsDrawerOpen(false)}
              />
            )}
            <aside className={`versions-panel${isVersionsDrawer ? ' is-drawer' : ''}`}>
              {isVersionsDrawer && (
                <button
                  type="button"
                  className="panel-close"
                  aria-label={t('Close versions panel')}
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
          {campaignTrackingEnabled && !published && (
            <div className="draft-banner">
              <span>{t('Draft')}</span>
              {t('Scans open an unpublished page until this campaign is published.')}
            </div>
          )}
          {campaignActivity && (
            <div className="editor-generation-status">
              <DurableGenerationStatus item={campaignActivity} safeToLeave />
              {campaignActivity.status === 'awaiting_review' ? (
                <Link
                  className="button button-primary button-small"
                  to={`/campaigns/${campaignId}/generations/${campaignActivity.generation_id}/assets`}
                >
                  <BadgeCheck size={14} aria-hidden="true" />
                  {t('Review assets')}
                </Link>
              ) : activeGenerations[0] && (
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => setDetailsGeneration(activeGenerations[0])}
                >
                  {t('Generation details')}
                </button>
              )}
            </div>
          )}
          <PosterCanvas
            campaign={previewCampaign}
            code={previewCode}
            zoom={preferences.zoom}
            posterSize={previewPosterSize}
            versionLabel={selectedGeneration
              ? t('Version {number}', { number: selectedGeneration.version_number ?? '-' })
              : t('Current poster')}
            onZoomChange={(zoom) => updatePreferences({ zoom })}
          />

          {isMobileWorkspace && (
            <div className="mobile-workspace-panels">
              <div
                className="segmented-control mobile-workspace-tabs"
                aria-label={t('Editor sections')}
              >
                {([
                  ['versions', t('Versions')],
                  ['create', t('Create')],
                  ['export', t('Export')],
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
      {detailsGeneration && (
        <GenerationDetailsSheet
          generation={
            [...generations, ...activeGenerations, ...failedGenerations]
              .find((generation) => generation.id === detailsGeneration.id)
            ?? detailsGeneration
          }
          generations={[...generations, ...activeGenerations, ...failedGenerations]}
          onClose={() => setDetailsGeneration(null)}
        />
      )}
    </AppShell>
  )
}
