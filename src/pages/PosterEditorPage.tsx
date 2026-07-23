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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useGenerationActivity } from '../activity/GenerationActivityProvider'
import { useAuth } from '../auth/AuthProvider'
import { AppShell } from '../components/AppShell'
import { AssetSelectionModeControl } from '../components/AssetSelectionModeControl'
import { DurableGenerationStatus } from '../components/DurableGenerationStatus'
import { DraftPersistenceStatus } from '../components/DraftPersistenceStatus'
import { GenerationDetailsSheet } from '../components/GenerationDetailsSheet'
import { GenerationInputsReview } from '../components/GenerationInputsReview'
import { GenerationReferences } from '../components/GenerationReferences'
import { PlatformHintField } from '../components/PlatformHintField'
import { PosterCanvas } from '../components/PosterCanvas'
import { PosterExportButton } from '../components/PosterExportButton'
import { PosterFormatSelect } from '../components/PosterFormatSelect'
import { PosterTranscript } from '../components/PosterTranscript'
import { PosterVersionHistory } from '../components/PosterVersionHistory'
import { InlineNotice } from '../components/ui/Feedback'
import { Spinner } from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { useCampaign } from '../hooks/useCampaign'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { usePlacements } from '../hooks/usePlacements'
import { usePosterGenerations } from '../hooks/usePosterGenerations'
import { useWorkspacePreferences } from '../hooks/useWorkspacePreferences'
import { useDebouncedLocalDraft } from '../hooks/useDebouncedLocalDraft'
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
import { derivePosterTranscript } from '../lib/posterTranscript'
import {
  clampRedNotePageIndex,
  resolveRedNoteRenderState,
} from '../lib/redNoteRender'
import { getDeviceColorScheme } from '../lib/colorScheme'
import { deleteReferenceImages, materializeReferenceImages } from '../lib/referenceStorage'
import {
  normalizeReferenceContext,
  pendingReferencesReady,
  type PendingReference,
} from '../lib/references'
import type { PosterGeneration } from '../lib/types'
import { getUseCase, isReferenceOnlyUseCaseId } from '../lib/useCases'
import { buildViewUrl } from '../lib/viewUrl'
import {
  buildPosterEditorDraftData,
  isPosterEditorDraftDirty,
  loadPosterEditorDraft,
  posterEditorDraftKey,
  restorePosterEditorDraft,
  serializePosterEditorDraft,
} from '../lib/posterEditorDraft'
import {
  canonicalLocalDraftContent,
  rehydrateLocalDraftReferences,
  type LocalDraftFileReference,
} from '../lib/localDraft'

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
  const [redNotePageSelection, setRedNotePageSelection] = useState({
    generationKey: null as string | null,
    pageIndex: 0,
  })
  const [instruction, setInstruction] = useState('')
  const [platformHint, setPlatformHint] = useState('')
  const [platformHintBaseline, setPlatformHintBaseline] =
    useState<string | null>(null)
  const [pendingReferences, setPendingReferences] = useState<PendingReference[]>([])
  const [restoredFileReferences, setRestoredFileReferences] =
    useState<LocalDraftFileReference[]>([])
  const [refreshWebsite, setRefreshWebsite] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [versionsDrawerOpen, setVersionsDrawerOpen] = useState(false)
  const [mobileSection, setMobileSection] = useState<MobileSection>('create')
  const [detailsGeneration, setDetailsGeneration] = useState<PosterGeneration | null>(null)
  const deliberateSelectionRef = useRef(false)
  const activitySnapshotRef = useRef<string | null>(null)
  const trackedJobRef = useRef<string | null>(null)
  const restoredEditorKeyRef = useRef<string | null>(null)
  const pendingReferencesRef = useRef(pendingReferences)
  const [draftReady, setDraftReady] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState(false)
  const [initialPersistedCanonical, setInitialPersistedCanonical] =
    useState<string | null>(null)
  pendingReferencesRef.current = pendingReferences

  useEffect(() => {
    if (user?.id && campaignTrackingEnabled) void ensureDefault()
  }, [campaignTrackingEnabled, user?.id, ensureDefault])

  useEffect(() => {
    setDraftReady(false)
    restoredEditorKeyRef.current = null
  }, [id])

  useEffect(() => {
    if (!user || !campaign || campaign.id !== id) return
    const restorationKey = posterEditorDraftKey(user.id, campaign.id)
    if (restoredEditorKeyRef.current === restorationKey) return
    restoredEditorKeyRef.current = restorationKey
    setDraftReady(false)

    const localDraft = loadPosterEditorDraft(user.id, campaign.id)
    if (localDraft) {
      const restored = restorePosterEditorDraft(
        localDraft.data,
        campaign.platform_hint,
      )
      const restoredReferences = rehydrateLocalDraftReferences(
        restored.references,
      )
      setInstruction(restored.instruction)
      setPlatformHint(restored.platformHint)
      setPlatformHintBaseline(restored.platformHintBaseline)
      setRefreshWebsite(restored.refreshWebsite)
      setPendingReferences(restoredReferences.pendingReferences)
      setRestoredFileReferences(restoredReferences.unrestorableFiles)
      setInitialPersistedCanonical(
        canonicalLocalDraftContent(localDraft.data),
      )
      setRestoredDraft(true)
    } else {
      setInstruction('')
      setPlatformHint(campaign.platform_hint ?? '')
      setPlatformHintBaseline(campaign.platform_hint)
      setRefreshWebsite(false)
      setPendingReferences([])
      setRestoredFileReferences([])
      setInitialPersistedCanonical(null)
      setRestoredDraft(false)
    }
    setDraftReady(true)
  }, [campaign, id, user])

  const editorDraftData = useMemo(() => buildPosterEditorDraftData({
    campaignId: id ?? '',
    instruction,
    platformHint,
    platformHintBaseline,
    refreshWebsite,
    pendingReferences,
    unrestorableFiles: restoredFileReferences,
  }), [
    id,
    instruction,
    pendingReferences,
    platformHint,
    platformHintBaseline,
    refreshWebsite,
    restoredFileReferences,
  ])
  const editorDraftHasContent = isPosterEditorDraftDirty(editorDraftData)
  // useCampaign retains the previous record while an editor route is loading.
  const editorDraftReady = draftReady && campaign?.id === id
  const serializeLocalEditorDraft = useCallback((
    value: typeof editorDraftData,
    nowMs: number,
  ) => {
    if (!user) throw new Error()
    return serializePosterEditorDraft(user.id, value, nowMs)
  }, [user])
  const editorDraftPersistence = useDebouncedLocalDraft({
    storageKey: user && id ? posterEditorDraftKey(user.id, id) : null,
    value: editorDraftData,
    ready: editorDraftReady,
    dirty: editorDraftHasContent,
    initialPersistedCanonical,
    guardBeforeUnload: editorDraftHasContent || busy === 'generate',
    serialize: serializeLocalEditorDraft,
  })

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
  const previewRedNoteRenderState = useMemo(
    () => previewCampaign
      ? resolveRedNoteRenderState(previewCampaign)
      : 'legacy',
    [previewCampaign],
  )
  const previewGenerationKey = previewGeneration?.id
    ?? campaign?.current_generation_id
    ?? campaign?.id
    ?? null
  const redNotePageCount = typeof previewRedNoteRenderState === 'object'
    ? previewRedNoteRenderState.plan.pages.length
    : null
  const requestedRedNotePageIndex =
    redNotePageSelection.generationKey === previewGenerationKey
      ? redNotePageSelection.pageIndex
      : 0
  const effectivePageIndex = redNotePageCount === null
    ? 0
    : clampRedNotePageIndex(requestedRedNotePageIndex, redNotePageCount)

  useEffect(() => {
    const generationKey = redNotePageCount === null
      ? null
      : previewGenerationKey
    setRedNotePageSelection((current) => (
      current.generationKey === generationKey
      && current.pageIndex === effectivePageIndex
        ? current
        : { generationKey, pageIndex: effectivePageIndex }
    ))
  }, [effectivePageIndex, previewGenerationKey, redNotePageCount])

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
  const posterTranscript = derivePosterTranscript(previewCampaign, {
    locale,
    pageIndex: effectivePageIndex,
    includeCompositedFooter: (
      previewIncludesQrBand
      && !!previewCode
      && !!previewCampaign.hero_image_url
    ),
  })
  const published = campaign.status === 'published'
  const firstVersion = !campaign.current_generation_id
  const campaignUseCase = getUseCase(campaign.use_case)
  const amazonReferenceMode = campaignUseCase.id === 'amazon_listing'
  const referenceOnlyMode = isReferenceOnlyUseCaseId(campaignUseCase.id)
  const redNotePost = campaignUseCase.id === 'rednote_post'
  const effectiveRefreshWebsite = referenceOnlyMode || firstVersion || refreshWebsite
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
  const referenceContextRequirementMet = (
    campaignUseCase.inputFields.referenceContext !== 'required'
    || normalizeReferenceContext(instruction) !== null
  )
  const useCaseReferenceProps = amazonReferenceMode
    ? {
        contextLabel: t('Listing copy and creative direction'),
        contextPlaceholder: t('Paste updated listing copy, approved claims, or describe what should change.'),
        contextHint: t('Seller-provided copy is the primary copy source.'),
        referenceImagesLabel: t('Product and brand images'),
        referenceImagesHint: t('Seller-provided images are the primary visual source.'),
      }
    : redNotePost
      ? {
          contextLabel: t('Draft copy'),
          contextPlaceholder: t('Paste the full draft copy for this RedNote post.'),
          contextHint: t('The draft copy is interpreted together with the reference images.'),
          referenceImagesLabel: t('Creative references'),
          referenceImagesHint: t('Add at least one fresh reference for this version.'),
        }
      : referenceOnlyMode
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

  function updatePendingReferences(
    action: SetStateAction<PendingReference[]>,
  ) {
    const next = typeof action === 'function'
      ? action(pendingReferencesRef.current)
      : action
    pendingReferencesRef.current = next
    setPendingReferences(next)
    setRestoredFileReferences((current) => current.filter((metadata) =>
      !next.some((reference) => (
        reference.kind === 'file'
        && reference.file.name === metadata.name
        && reference.file.size === metadata.size
        && reference.file.type === metadata.type
      ))
    ))
  }

  function discardLocalEditorDraft() {
    editorDraftPersistence.clear()
    setInstruction('')
    setPlatformHint(campaignPlatformHint ?? '')
    setPlatformHintBaseline(campaignPlatformHint)
    setPendingReferences([])
    setRestoredFileReferences([])
    setRefreshWebsite(false)
    setGenerationError(null)
    setRestoredDraft(false)
    setInitialPersistedCanonical(null)
  }

  async function generateVersion() {
    if (!user || generating || uploadingInputs) return
    if (!referenceContextRequirementMet) {
      setGenerationError(t('RedNote post generation requires draft copy.'))
      return
    }
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
    const colorScheme = getDeviceColorScheme()

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
        colorScheme,
        locale,
      })
      editorDraftPersistence.clear()
      setRestoredDraft(false)
      setRestoredFileReferences([])
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
    setPlatformHintBaseline(normalized)
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
      editorDraftPersistence.clear()
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

  function changeRedNotePageIndex(nextPageIndex: number) {
    if (redNotePageCount === null) return
    setRedNotePageSelection({
      generationKey: previewGenerationKey,
      pageIndex: clampRedNotePageIndex(nextPageIndex, redNotePageCount),
    })
  }

  const versionPanel = (
    <PosterVersionHistory
      campaign={campaign}
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
      {(restoredDraft || editorDraftPersistence.status !== 'pristine') && (
        <div className="editor-draft-persistence">
          {restoredDraft && (
            <div className="draft-restored-copy" role="status">
              <strong>{t('Local draft restored.')}</strong>
              <span>{t('Your inputs were restored from this browser.')}</span>
            </div>
          )}
          <DraftPersistenceStatus status={editorDraftPersistence.status} />
          {restoredDraft && (
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={discardLocalEditorDraft}
            >
              {t('Discard local draft')}
            </button>
          )}
        </div>
      )}
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
        onPendingReferencesChange={updatePendingReferences}
        disabled={generationInputsDisabled}
        contextRequirement={campaignUseCase.inputFields.referenceContext}
        referenceImagesRequirement={campaignUseCase.inputFields.referenceImages.requirement}
        referenceImagesMinimumCount={campaignUseCase.inputFields.referenceImages.minimumCount}
        {...useCaseReferenceProps}
      />
      {restoredFileReferences.length > 0 && (
        <div className="draft-file-restore-notice">
          <InlineNotice tone="warning">
            <strong>{t('Re-add image files')}</strong>
            <span>
              {t('This local draft included image files that cannot be restored. Re-add them before generating.')}
            </span>
          </InlineNotice>
        </div>
      )}
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
      {!referenceOnlyMode && (
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
          || !referenceContextRequirementMet
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
                pageIndex={effectivePageIndex}
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
          <figure className="poster-figure">
            <PosterCanvas
              campaign={previewCampaign}
              code={previewCode}
              imageAlt={posterTranscript.shortAlt}
              zoom={preferences.zoom}
              posterSize={previewPosterSize}
              pageIndex={effectivePageIndex}
              pageCount={redNotePageCount ?? undefined}
              versionLabel={selectedGeneration
                ? t('Version {number}', { number: selectedGeneration.version_number ?? '-' })
                : t('Current poster')}
              onZoomChange={(zoom) => updatePreferences({ zoom })}
              onPageIndexChange={changeRedNotePageIndex}
            />
            <PosterTranscript transcript={posterTranscript} />
          </figure>

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
