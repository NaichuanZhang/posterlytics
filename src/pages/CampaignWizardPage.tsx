import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  ImagePlus,
  Sparkles,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type SetStateAction,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useGenerationActivity } from '../activity/GenerationActivityProvider'
import { DurableGenerationStatus } from '../components/DurableGenerationStatus'
import { DraftPersistenceStatus } from '../components/DraftPersistenceStatus'
import { GenerationReferences } from '../components/GenerationReferences'
import { OutputKindControl } from '../components/OutputKindControl'
import { PosterFormatSelect } from '../components/PosterFormatSelect'
import { SourceUrlsField } from '../components/SourceUrlsField'
import {
  isValidPosterQrDestination,
  PosterQrSettings,
} from '../components/PosterQrSettings'
import { WebsiteCapturePreview } from '../components/WebsiteCapturePreview'
import { AppShell } from '../components/AppShell'
import { InlineNotice } from '../components/ui/Feedback'
import { useI18n } from '../i18n/I18nProvider'
import {
  displayNameOrUntitled,
  normalizeCampaignTitleWrite,
} from '../lib/campaignDisplayName'
import {
  formatsForBand,
  posterFormatHasQr,
  posterFormatSupportsQrToggle,
  posterFormatWithQr,
} from '../lib/qrPolicy'
import { insforge } from '../lib/insforge'
import { useCampaign } from '../hooks/useCampaign'
import { useDebouncedLocalDraft } from '../hooks/useDebouncedLocalDraft'
import { useRequiredFieldValidity } from '../hooks/useRequiredFieldValidity'
import { useFocusOnChange } from '../hooks/useViewFocus'
import { materializeReferenceImages, deleteReferenceImages } from '../lib/referenceStorage'
import {
  normalizeReferenceContext,
  pendingReferencesReady,
  type PendingReference,
} from '../lib/references'
import {
  enqueuePosterGeneration,
  retryPosterGeneration,
} from '../lib/generationApi'
import { isAmazonSourceUrl } from '../lib/amazonSource'
import { parseAmazonAsin } from '../lib/amazonProduct'
import { lookupAmazonProductTitle } from '../lib/amazonProductLookup'
import {
  DEFAULT_POSTER_SIZE_SLUG,
  getPosterSize,
  resolvePosterFormat,
  type PosterSizeSlug,
} from '../lib/posterSize'
import { ensureDefaultCampaignPlacement } from '../lib/placementService'
import {
  EagerCaptureSyncError,
  syncEagerCaptureEvidence,
} from '../lib/eagerCapturePersistence'
import type { SelectedEagerCapture } from '../lib/eagerCapture'
import { getDeviceColorScheme } from '../lib/colorScheme'
import {
  buildCampaignDraftData,
  campaignDraftKey,
  isCampaignDraftDirty,
  loadCampaignDraft,
  restoreCampaignEagerCapture,
  serializeCampaignDraft,
} from '../lib/campaignDraft'
import {
  canonicalLocalDraftContent,
  rehydrateLocalDraftReferences,
  type LocalDraftFileReference,
} from '../lib/localDraft'
import {
  buildSourceUrlWrite,
  creationSourceSignals,
  primarySourceUrl,
} from '../lib/sourceUrls'
import {
  resolveCreationUseCase,
  type CreationOutputKind,
} from '../lib/useCases'
import { PosterThumbnail } from '../components/posters/PosterThumbnail'
import { derivePosterTranscript } from '../lib/posterTranscript'

type Phase = 'form' | 'uploading' | 'started' | 'error'
type AmazonTitleLookupStatus = 'idle' | 'loading' | 'unavailable'

// The RedNote post pipeline is full-bleed 3:4; the DB forbids placements on it.
const POST_POSTER_FORMAT = resolvePosterFormat('3:4', false)

export function CampaignWizardPage() {
  const { locale, t } = useI18n()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { items: activityItems, refresh: refreshActivity } = useGenerationActivity()
  const [phase, setPhase] = useState<Phase>('form')
  const [validationAttempt, setValidationAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [amazonTitleLookupStatus, setAmazonTitleLookupStatus] =
    useState<AmazonTitleLookupStatus>('idle')
  const [eagerCapturePreview, setEagerCapturePreview] =
    useState<SelectedEagerCapture | null>(null)
  const [captureInFlight, setCaptureInFlight] = useState(false)
  const [draftReady, setDraftReady] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState(false)
  const [restoredFileReferences, setRestoredFileReferences] =
    useState<LocalDraftFileReference[]>([])
  const [initialPersistedCanonical, setInitialPersistedCanonical] =
    useState<string | null>(null)

  const [sourceUrls, setSourceUrls] = useState<string[]>([])
  const [productName, setProductName] = useState('')
  const [tagline, setTagline] = useState('')
  const [destinationUrl, setDestinationUrl] = useState('')
  const [posterFormat, setPosterFormat] = useState<PosterSizeSlug>(DEFAULT_POSTER_SIZE_SLUG)
  const [outputKind, setOutputKind] = useState<CreationOutputKind>('poster')
  const [referenceContext, setReferenceContext] = useState('')
  const [pendingReferences, setPendingReferences] = useState<PendingReference[]>([])
  const pageHeadingRef = useRef<HTMLHeadingElement>(null)
  const validationTargetRef = useRef<HTMLElement | null>(null)
  const validationAttemptQueuedRef = useRef(false)
  const amazonTitleRequestToken = useRef(0)
  const activeAmazonTitleRequest = useRef<{
    asin: string
    controller: AbortController
    token: number
  } | null>(null)
  const attemptedAmazonTitleAsins = useRef(new Set<string>())
  const restoredOwnerRef = useRef<string | null>(null)
  const pendingReferencesRef = useRef(pendingReferences)
  const latestSourceUrls = useRef(sourceUrls)
  const latestProductName = useRef(productName)
  const latestOutputKind = useRef(outputKind)
  latestSourceUrls.current = sourceUrls
  latestProductName.current = productName
  latestOutputKind.current = outputKind
  pendingReferencesRef.current = pendingReferences

  // The persisted source URL is source_urls[0]; the rest are declared context.
  const primaryUrl = primarySourceUrl(sourceUrls) ?? ''
  const sourceSignals = creationSourceSignals(sourceUrls)
  const resolvedUseCase = resolveCreationUseCase({
    ...sourceSignals,
    outputKind,
  })
  const isPost = outputKind === 'post'
  const isAmazon = resolvedUseCase === 'amazon_listing'
  const hasFetchableEvidence = sourceSignals.hasSourceUrl && !isAmazon && !isPost
  const qrEnabled = !isPost && posterFormatHasQr(posterFormat)
  // No fetchable source evidence => at least one asset is required. Amazon never
  // fetches (seller images are the evidence), reference-only has no URL, and a
  // multi-page post is built from its references.
  const referencesRequired = !hasFetchableEvidence
  const minimumReferenceImages = referencesRequired ? 1 : 0
  const referenceMinimumMet = pendingReferences.length >= minimumReferenceImages
  const creativeDirectionRequired = isPost
  const referenceContextRequirementMet = (
    !creativeDirectionRequired
    || normalizeReferenceContext(referenceContext) !== null
  )

  useEffect(() => {
    if (!user || restoredOwnerRef.current === user.id) return
    restoredOwnerRef.current = user.id
    const localDraft = loadCampaignDraft(user.id)
    if (localDraft) {
      const restoredReferences = rehydrateLocalDraftReferences(
        localDraft.data.references,
      )
      setSourceUrls(localDraft.data.sourceUrls)
      setProductName(localDraft.data.productName)
      setTagline(localDraft.data.tagline)
      setDestinationUrl(localDraft.data.destinationUrl)
      setPosterFormat(localDraft.data.posterFormat)
      setOutputKind(localDraft.data.outputKind)
      setReferenceContext(localDraft.data.referenceContext)
      setPendingReferences(restoredReferences.pendingReferences)
      setRestoredFileReferences(restoredReferences.unrestorableFiles)
      setDraftId(localDraft.data.serverCampaignId)
      setEagerCapturePreview(restoreCampaignEagerCapture({
        metadata: localDraft.data.eagerCapture,
        availableCapture: eagerCapturePreview,
        sourceUrls: localDraft.data.sourceUrls,
        outputKind: localDraft.data.outputKind,
        colorScheme: getDeviceColorScheme(),
      }))
      setInitialPersistedCanonical(
        canonicalLocalDraftContent(localDraft.data),
      )
      setRestoredDraft(true)
    }
    setDraftReady(true)
  }, [user])

  useEffect(() => () => {
    amazonTitleRequestToken.current += 1
    activeAmazonTitleRequest.current?.controller.abort()
    activeAmazonTitleRequest.current = null
  }, [])

  const campaignDraftData = useMemo(() => buildCampaignDraftData({
    sourceUrls,
    productName,
    tagline,
    destinationUrl,
    posterFormat,
    outputKind,
    referenceContext,
    pendingReferences,
    unrestorableFiles: restoredFileReferences,
    serverCampaignId: draftId,
    eagerCapture: eagerCapturePreview,
  }), [
    destinationUrl,
    draftId,
    eagerCapturePreview,
    outputKind,
    pendingReferences,
    posterFormat,
    productName,
    referenceContext,
    restoredFileReferences,
    sourceUrls,
    tagline,
  ])
  const campaignDraftHasContent = isCampaignDraftDirty(campaignDraftData)
  const campaignDraftActive = phase !== 'started'
  const serializeLocalCampaignDraft = useCallback((
    value: typeof campaignDraftData,
    nowMs: number,
  ) => {
    if (!user) throw new Error()
    return serializeCampaignDraft(user.id, value, nowMs)
  }, [user])
  const campaignDraftPersistence = useDebouncedLocalDraft({
    storageKey: user ? campaignDraftKey(user.id) : null,
    value: campaignDraftData,
    ready: draftReady,
    dirty: campaignDraftActive && campaignDraftHasContent,
    initialPersistedCanonical,
    guardBeforeUnload: (
      (campaignDraftActive && campaignDraftHasContent)
      || phase === 'uploading'
      || captureInFlight
    ),
    serialize: serializeLocalCampaignDraft,
  })
  const destinationUrlValidity = useRequiredFieldValidity({
    required: qrEnabled,
    valid: isValidPosterQrDestination(destinationUrl),
    validationAttempt,
    // A constant reset key would make the gate inert; key it on QR state instead.
    resetKey: qrEnabled ? 'qr-on' : 'qr-off',
  })
  const generationViewActive = phase === 'uploading' || phase === 'started'

  useFocusOnChange(pageHeadingRef, generationViewActive, {
    enabled: generationViewActive,
  })

  const queueValidationAttempt = useCallback((target: HTMLElement | null) => {
    if (target && validationTargetRef.current === null) {
      validationTargetRef.current = target
    }
    if (validationAttemptQueuedRef.current) return

    validationAttemptQueuedRef.current = true
    queueMicrotask(() => {
      validationAttemptQueuedRef.current = false
      setValidationAttempt((current) => current + 1)
    })
  }, [])

  useLayoutEffect(() => {
    if (validationAttempt === 0) return

    const target = validationTargetRef.current
    validationTargetRef.current = null
    if (
      !target?.isConnected
      || document.querySelector('[aria-modal="true"]')
      || !isVisibleFocusTarget(target)
    ) {
      return
    }
    target.focus()
  }, [validationAttempt])

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

  function updateSourceUrls(next: string[]) {
    latestSourceUrls.current = next
    cancelAmazonTitleLookup()
    setSourceUrls(next)
    setEagerCapturePreview(null)
  }

  function updateOutputKind(next: CreationOutputKind) {
    latestOutputKind.current = next
    setOutputKind(next)
    if (next === 'post') {
      // Multi-page post is locked to bandless 3:4 with no QR or destination.
      setPosterFormat(POST_POSTER_FORMAT)
      setDestinationUrl('')
    }
  }

  function discardLocalDraft() {
    campaignDraftPersistence.clear()
    cancelAmazonTitleLookup()
    setPhase('form')
    setError(null)
    setDraftId(null)
    setJobId(null)
    setEagerCapturePreview(null)
    setCaptureInFlight(false)
    setSourceUrls([])
    setProductName('')
    setTagline('')
    setDestinationUrl('')
    setPosterFormat(DEFAULT_POSTER_SIZE_SLUG)
    setOutputKind('poster')
    setReferenceContext('')
    setPendingReferences([])
    setRestoredFileReferences([])
    setRestoredDraft(false)
    setInitialPersistedCanonical(null)
  }

  function cancelAmazonTitleLookup() {
    amazonTitleRequestToken.current += 1
    activeAmazonTitleRequest.current?.controller.abort()
    activeAmazonTitleRequest.current = null
    setAmazonTitleLookupStatus('idle')
  }

  async function prefillAmazonProductName() {
    if (
      resolveCreationUseCase({
        ...creationSourceSignals(latestSourceUrls.current),
        outputKind: latestOutputKind.current,
      }) !== 'amazon_listing'
      || latestProductName.current.trim()
    ) {
      return
    }

    const requestedUrl = primarySourceUrl(latestSourceUrls.current) ?? ''
    const asin = parseAmazonAsin(requestedUrl)
    if (!asin) {
      if (isAmazonSourceUrl(requestedUrl)) {
        setAmazonTitleLookupStatus('unavailable')
      }
      return
    }
    if (
      activeAmazonTitleRequest.current?.asin === asin
      || attemptedAmazonTitleAsins.current.has(asin)
    ) {
      return
    }

    activeAmazonTitleRequest.current?.controller.abort()
    const controller = new AbortController()
    const token = ++amazonTitleRequestToken.current
    activeAmazonTitleRequest.current = { asin, controller, token }
    attemptedAmazonTitleAsins.current.add(asin)
    setAmazonTitleLookupStatus('loading')

    try {
      const result = await lookupAmazonProductTitle({
        url: requestedUrl,
        signal: controller.signal,
      })
      if (!amazonTitleRequestIsCurrent(token, asin)) return

      if (
        result.status === 'found'
        && !latestProductName.current.trim()
      ) {
        latestProductName.current = result.title
        setProductName(result.title)
        setAmazonTitleLookupStatus('idle')
      } else {
        setAmazonTitleLookupStatus('unavailable')
      }
    } catch (cause) {
      if (
        isAbortError(cause)
        || !amazonTitleRequestIsCurrent(token, asin)
      ) {
        return
      }
      setAmazonTitleLookupStatus('unavailable')
    } finally {
      if (activeAmazonTitleRequest.current?.token === token) {
        activeAmazonTitleRequest.current = null
      }
    }
  }

  function amazonTitleRequestIsCurrent(token: number, asin: string) {
    return (
      token === amazonTitleRequestToken.current
      && resolveCreationUseCase({
        ...creationSourceSignals(latestSourceUrls.current),
        outputKind: latestOutputKind.current,
      }) === 'amazon_listing'
      && parseAmazonAsin(primarySourceUrl(latestSourceUrls.current) ?? '') === asin
      && !latestProductName.current.trim()
    )
  }

  async function persistDraft(): Promise<string> {
    if (!user) throw new Error(t('Sign in before creating a campaign.'))

    if (qrEnabled && !isValidPosterQrDestination(destinationUrl)) {
      throw new Error(t('Use a complete HTTP or HTTPS destination URL.'))
    }
    const sourceWrite = buildSourceUrlWrite(sourceUrls)
    const resolvedDestinationUrl = qrEnabled ? destinationUrl.trim() : null
    const persistedFormat = isPost ? POST_POSTER_FORMAT : posterFormat

    const values = {
      scenario: 'product',
      use_case: resolvedUseCase,
      product_url: sourceWrite.product_url,
      source_urls: sourceWrite.source_urls,
      // NULL, never '': every downstream fallback uses ?? / ||. Shared with the
      // editor's rename so the two writers cannot normalize differently.
      product_name: normalizeCampaignTitleWrite(productName),
      tagline: tagline.trim() || null,
      // Absent so NOT NULL DEFAULT 'Learn more' absorbs it; no CTA input remains.
      destination_url: resolvedDestinationUrl,
      // No platform-hint input in the unified screen.
      platform_hint: null,
      poster_format: persistedFormat,
      status: 'draft',
    }

    let campaignId = draftId
    if (!campaignId) {
      const { data, error: createError } = await insforge.database
        .from('campaigns')
        .insert([{ ...values, user_id: user.id }])
        .select('id')
        .single()
      if (createError || !data) {
        console.error('Campaign creation failed', {
          error: createError,
          hasData: Boolean(data),
        })
        throw new Error(t('Could not create campaign. Check your connection and try again.'))
      }
      campaignId = (data as { id: string }).id
      setDraftId(campaignId)
    }

    const { error: updateError } = await insforge.database
      .from('campaigns')
      .update(values)
      .eq('id', campaignId)
    if (updateError) throw new Error(updateError.message)
    return campaignId
  }

  function handleInvalidCapture(event: FormEvent<HTMLFormElement>) {
    queueValidationAttempt(firstInvalidControl(event.currentTarget))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return
    const invalidControl = firstInvalidControl(event.currentTarget)
    if (invalidControl) {
      queueValidationAttempt(invalidControl)
      return
    }
    if (!referenceContextRequirementMet) {
      setError(t('RedNote post generation requires draft copy.'))
      queueValidationAttempt(resolveValidationFocusTarget(
        event.currentTarget.querySelector('textarea[aria-required="true"]'),
      ))
      return
    }
    if (pendingReferences.length < minimumReferenceImages) {
      setError(t('Add at least {count} images.', { count: minimumReferenceImages }))
      queueValidationAttempt(resolveValidationFocusTarget(
        event.currentTarget.querySelector('[data-testid="reference-file-input"]'),
      ))
      return
    }
    if (!pendingReferencesReady(pendingReferences)) {
      setError(t('Remove any image URL that could not load, or wait for its preview to finish.'))
      return
    }
    const submittedColorScheme = getDeviceColorScheme()
    const submittedPrimaryUrl = primaryUrl
    const submittedUseCase = resolvedUseCase
    const submittedQrEnabled = qrEnabled
    const submittedEagerCapture = eagerCapturePreview
    setError(null)
    setPhase('uploading')

    let campaignId: string
    try {
      campaignId = await persistDraft()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setPhase('error')
      return
    }

    if (submittedQrEnabled) {
      const placementError = await ensureDefaultCampaignPlacement({
        campaignId,
        userId: user.id,
        label: t('Primary'),
      })
      if (placementError) {
        console.error('Primary placement provisioning failed', {
          campaignId,
          error: placementError,
        })
        setError(t('The campaign was saved, but its primary placement could not be prepared.'))
        setPhase('error')
        return
      }
    }

    try {
      await syncEagerCaptureEvidence({
        campaignId,
        productUrl: submittedPrimaryUrl,
        useCase: submittedUseCase,
        colorScheme: submittedColorScheme,
        preview: submittedEagerCapture?.preview ?? null,
        selection: submittedEagerCapture?.selection ?? null,
      })
    } catch (cause) {
      console.warn('Eager capture evidence was not persisted; generation will recapture.', {
        code: cause instanceof EagerCaptureSyncError ? cause.code : 'unknown',
      })
    }

    let uploaded = [] as Awaited<ReturnType<typeof materializeReferenceImages>>
    try {
      uploaded = await materializeReferenceImages(
        user.id,
        campaignId,
        pendingReferences,
        locale,
      )
      const result = await enqueuePosterGeneration({
        campaignId,
        instruction: normalizeReferenceContext(referenceContext),
        referenceImages: uploaded,
        refreshWebsite: true,
        // Creation always runs the full pipeline; the mid-pipeline asset-review
        // page is an editor-only preference.
        assetSelectionMode: 'yolo',
        colorScheme: submittedColorScheme,
        locale,
      })
      campaignDraftPersistence.clear()
      setRestoredDraft(false)
      setRestoredFileReferences([])
      setJobId(result.job.id)
      setPhase('started')
      await refreshActivity()
    } catch (cause) {
      if (uploaded.length > 0) await deleteReferenceImages(uploaded)
      setError(cause instanceof Error ? cause.message : String(cause))
      setPhase('error')
    }
  }

  async function retryGeneration() {
    if (!jobId) return
    setError(null)
    try {
      const result = await retryPosterGeneration(jobId, locale)
      setJobId(result.job.id)
      setPhase('started')
      await refreshActivity()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const activity = activityItems.find((item) => item.job_id === jobId) ?? null
  const activityPosterSize = activity ? getPosterSize(activity.poster_format) : null
  const completedRedNoteCampaignId = (
    activity?.status === 'succeeded'
    && activity.use_case === 'rednote_post'
  )
    ? activity.campaign_id
    : undefined
  const { campaign: completedRedNoteCampaign } = useCampaign(
    completedRedNoteCampaignId,
  )
  const completedRedNotePreview = (
    completedRedNoteCampaign?.id === completedRedNoteCampaignId
  )
    ? completedRedNoteCampaign
    : null
  const working = phase === 'uploading' || (
    phase === 'started'
    && activity?.status !== 'succeeded'
    && activity?.status !== 'failed'
    && activity?.status !== 'canceled'
  )

  const referenceLabels = isAmazon
    ? {
        contextLabel: t('Listing copy'),
        contextPlaceholder: t('Paste the product title, bullets, description, and approved claims.'),
        contextHint: t('Seller-provided copy is the primary copy source.'),
        referenceImagesLabel: t('Product and brand images'),
        referenceImagesHint: t('Seller-provided images are the primary visual source.'),
      }
    : isPost
      ? {
          contextLabel: t('Draft copy'),
          contextPlaceholder: t('Paste the full draft copy for this RedNote post.'),
          contextHint: t('The draft copy is interpreted together with the reference images.'),
          referenceImagesLabel: t('Creative references'),
          referenceImagesHint: t('Reference images are the primary visual source.'),
        }
      : {}

  return (
    <AppShell
      breadcrumbs={[
        { label: t('Campaigns'), to: '/' },
        { label: draftId ? t('Campaign draft') : t('New campaign') },
      ]}
      actions={(
        <Link to="/" className="toolbar-button">
          <ArrowLeft size={15} aria-hidden="true" />
          {t('Cancel')}
        </Link>
      )}
    >
      <header className="page-heading page-heading-compact">
        <div>
          <h1 ref={pageHeadingRef}>
            {activity?.status === 'succeeded'
              ? t('Poster ready')
              : activity?.status === 'failed'
                ? t('Generation failed')
                : working
                  ? t('Building your poster')
                  : t('Create campaign')}
          </h1>
          <p>
            {phase === 'uploading'
              ? t('Keep this page open while the source files finish uploading.')
              : working
                ? t('Generation continues in the background after the inputs are queued.')
                : t('Add a title, sources, and references, then generate.')}
          </p>
        </div>
      </header>

      {(restoredDraft || campaignDraftPersistence.status !== 'pristine') && (
        <div className="draft-persistence-bar">
          {restoredDraft && (
            <div className="draft-restored-copy" role="status">
              <strong>{t('Local draft restored.')}</strong>
              <span>{t('Your inputs were restored from this browser.')}</span>
            </div>
          )}
          <DraftPersistenceStatus status={campaignDraftPersistence.status} />
          {restoredDraft && (
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={discardLocalDraft}
            >
              {t('Discard local draft')}
            </button>
          )}
        </div>
      )}

      {phase === 'uploading' ? (
        <div className="creation-starting" aria-live="polite">
          <span className="spinner" />
          <div>
            <strong>{t('Uploading inputs...')}</strong>
            <p>{t('Keep this page open until generation starts.')}</p>
          </div>
        </div>
      ) : activity?.status === 'succeeded' ? (
        <section className="generation-result generation-result-ready" aria-live="polite">
          <div className="generation-result-copy">
            <CheckCircle2 size={23} aria-hidden="true" />
            <div>
              <span>{t('Version {number}', { number: activity.version_number ?? 1 })}</span>
              <h2>
                {t('{name} is ready', {
                  name: displayNameOrUntitled(
                    activity.campaign_name,
                    t('Untitled campaign'),
                  ),
                })}
              </h2>
              <p>{t("The completed poster is now the campaign's current version.")}</p>
            </div>
          </div>
          {activity.use_case === 'rednote_post' ? (
            completedRedNotePreview ? (
              <PosterThumbnail
                className="generation-result-poster"
                campaign={completedRedNotePreview}
                imageAlt={derivePosterTranscript(completedRedNotePreview, {
                  locale,
                  includeCompositedFooter: false,
                }).shortAlt}
              />
            ) : (
              <div
                className="generation-result-poster generation-result-poster-placeholder"
                aria-label={t('Loading')}
              >
                <FileText size={24} aria-hidden="true" />
              </div>
            )
          ) : activity.hero_image_url ? (
            <img
              src={activity.hero_image_url}
              alt={t('{name} poster', {
                name: displayNameOrUntitled(
                  activity.campaign_name,
                  t('Untitled campaign'),
                ),
              })}
              style={{
                aspectRatio: `${activityPosterSize!.artwork.width} / ${activityPosterSize!.artwork.height}`,
              }}
            />
          ) : null}
          <Link to={`/campaigns/${activity.campaign_id}`} className="button button-primary">
            {t('Open editor')}
          </Link>
        </section>
      ) : activity?.status === 'failed' ? (
        <section className="generation-result generation-result-failed" aria-live="polite">
          <DurableGenerationStatus item={activity} />
          <InlineNotice tone="error">
            <strong>{t('Poster generation did not complete.')}</strong>
            <span>{activity.last_error_message || t('The final automatic attempt failed.')}</span>
          </InlineNotice>
          <div className="form-actions">
            <button type="button" className="button button-primary" onClick={() => void retryGeneration()}>
              <Sparkles size={15} aria-hidden="true" />
              {t('Retry with same inputs')}
            </button>
            <Link to="/" className="button button-secondary">{t('Back to campaigns')}</Link>
          </div>
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
        </section>
      ) : phase === 'started' && activity ? (
        <section className="generation-result">
          <DurableGenerationStatus item={activity} safeToLeave />
          <Link to="/" className="button button-secondary">
            {t('Back to campaigns')}
          </Link>
        </section>
      ) : phase === 'started' ? (
        <div className="creation-starting" aria-live="polite">
          <span className="spinner" />
          <div>
            <strong>{t('Generation started')}</strong>
            <p>{t('Safe to leave Posterlytics. Activity will update shortly.')}</p>
          </div>
        </div>
      ) : (
        <div className="wizard-layout">
          <form
            className="campaign-form"
            onInvalidCapture={handleInvalidCapture}
            onSubmit={handleSubmit}
          >
            <section className="form-section" aria-labelledby="details-heading">
              <div className="form-section-heading">
                <span><Sparkles size={17} aria-hidden="true" /></span>
                <div>
                  <h2 id="details-heading">{t('Campaign details')}</h2>
                  <p>{t('Add a title, sources, and references, then generate.')}</p>
                </div>
              </div>
              <div className="field-grid">
                {/* First, so a layout shift below can never move the primary
                    choice out from under a click. */}
                <div className="field field-wide">
                  <OutputKindControl
                    idPrefix="output-kind"
                    value={outputKind}
                    onChange={updateOutputKind}
                  />
                </div>
                <div className="field">
                  <label htmlFor="product-name">
                    {t('Title')} <span className="optional-label">{t('Optional')}</span>
                  </label>
                  <input
                    id="product-name"
                    className="input"
                    placeholder="Northstar Reports"
                    value={productName}
                    aria-describedby={
                      isAmazon && amazonTitleLookupStatus !== 'idle'
                        ? 'amazon-title-lookup-status'
                        : undefined
                    }
                    onChange={(event) => {
                      const nextName = event.target.value
                      latestProductName.current = nextName
                      if (nextName.trim()) cancelAmazonTitleLookup()
                      setProductName(nextName)
                    }}
                  />
                  {isAmazon && amazonTitleLookupStatus !== 'idle' && (
                    <p
                      className="hint"
                      id="amazon-title-lookup-status"
                      aria-live="polite"
                    >
                      {amazonTitleLookupStatus === 'loading'
                        ? t('Looking up the Amazon product title...')
                        : t('Product title unavailable. Enter the product name.')}
                    </p>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="tagline">
                    {t('Supporting line')}{' '}
                    <span className="optional-label">{t('Optional')}</span>
                  </label>
                  <input
                    id="tagline"
                    className="input"
                    placeholder={t('A short optional line')}
                    value={tagline}
                    onChange={(event) => setTagline(event.target.value)}
                  />
                </div>
                <SourceUrlsField
                  id="source-url"
                  values={sourceUrls}
                  onChange={updateSourceUrls}
                  onPrimaryBlur={() => void prefillAmazonProductName()}
                />
                {resolvedUseCase === 'website_product' && (
                  <WebsiteCapturePreview
                    url={primaryUrl}
                    disabled={false}
                    onPreviewChange={setEagerCapturePreview}
                    onCaptureInFlightChange={setCaptureInFlight}
                  />
                )}
                {isAmazon && (
                  <div className="field field-wide" id="amazon-source-hint">
                    <InlineNotice tone="warning">
                      <strong>{t('Amazon seller reference mode')}</strong>
                      <span>
                        {t('Amazon sources use seller-provided copy and images instead of website capture.')}
                      </span>
                    </InlineNotice>
                  </div>
                )}
                {isPost ? null : posterFormatSupportsQrToggle(posterFormat) ? (
                  <PosterQrSettings
                    idPrefix="poster-qr"
                    enabled={qrEnabled}
                    destinationUrl={destinationUrl}
                    onEnabledChange={(enabled) => {
                      setPosterFormat(posterFormatWithQr(posterFormat, enabled))
                      if (!enabled) setDestinationUrl('')
                    }}
                    onDestinationUrlChange={setDestinationUrl}
                  />
                ) : null}
                {!isPost && (
                  <PosterFormatSelect
                    id="poster-format"
                    value={posterFormat}
                    // One option per aspect for the current band; the QR toggle
                    // controls band, so the select never duplicates aspects.
                    allowedFormats={formatsForBand(qrEnabled)}
                    onChange={setPosterFormat}
                  />
                )}
                {qrEnabled && destinationUrlValidity.invalid && (
                  <p className="field-error" id="poster-qr-destination-error">
                    {t('Use a complete HTTP or HTTPS destination URL.')}
                  </p>
                )}
              </div>
            </section>

            <section className="form-section" aria-labelledby="references-heading">
              <div className="form-section-heading">
                <span><ImagePlus size={17} aria-hidden="true" /></span>
                <div>
                  <h2 id="references-heading">
                    {isAmazon
                      ? t('Listing copy and product images')
                      : isPost
                        ? t('Draft copy and creative references')
                        : t('Generation references')}
                  </h2>
                  <p>
                    {isAmazon
                      ? t('Provide the seller-owned text and visuals Posterlytics should use.')
                      : isPost
                        ? t('Add the complete draft copy and at least one image for the post.')
                        : hasFetchableEvidence
                          ? t('Add direction or images that are not present on the website.')
                          : t('Start with at least one image, then add any context that should shape the artwork.')}
                  </p>
                </div>
              </div>
              <GenerationReferences
                context={referenceContext}
                onContextChange={setReferenceContext}
                existingImages={[]}
                onRemoveExisting={() => {}}
                pendingReferences={pendingReferences}
                onPendingReferencesChange={updatePendingReferences}
                contextRequirement={creativeDirectionRequired ? 'required' : 'optional'}
                referenceImagesRequirement={referencesRequired ? 'required' : 'optional'}
                referenceImagesMinimumCount={minimumReferenceImages}
                validationAttempt={validationAttempt}
                {...referenceLabels}
              />
            </section>

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

            {error && (
              <InlineNotice tone="error">
                {draftId && (
                  <strong>
                    {t('Campaign details were saved; generation did not start.')}
                  </strong>
                )}
                <span>
                  {error}
                  {draftId && <> {t('Correct the issue and retry this draft.')}</>}
                </span>
              </InlineNotice>
            )}

            <div className="form-actions">
              <button
                className="button button-primary"
                type="submit"
                disabled={
                  !referenceMinimumMet
                  || !referenceContextRequirementMet
                  || !pendingReferencesReady(pendingReferences)
                }
              >
                <Sparkles size={16} aria-hidden="true" />
                {draftId ? t('Retry generation') : t('Generate poster')}
              </button>
              <button type="button" className="button button-secondary" onClick={() => navigate('/')}>
                {t('Cancel')}
              </button>
            </div>
          </form>

          <aside className="campaign-summary" aria-label={t('Campaign summary')}>
            <div className="summary-poster">
              <span className="summary-poster-mark">P</span>
              <strong>{productName.trim() || t('Untitled campaign')}</strong>
              <span>{tagline.trim() || t('Poster preview pending')}</span>
            </div>
            <dl>
              <div>
                <dt>{t('Source')}</dt>
                <dd>{summarizeUrl(primaryUrl) || t('Not set')}</dd>
              </div>
              <div>
                <dt>{t('Output')}</dt>
                <dd>{isPost ? t('Multi-page post') : t('Single poster')}</dd>
              </div>
              {qrEnabled && (
                <div>
                  <dt>{t('Destination')}</dt>
                  <dd>{summarizeUrl(destinationUrl) || t('Not set')}</dd>
                </div>
              )}
              <div>
                <dt>{t('References')}</dt>
                <dd>
                  {t(pendingReferences.length === 1 ? '{count} image' : '{count} images', {
                    count: pendingReferences.length,
                  })}
                </dd>
              </div>
              <div>
                <dt>{t('Format')}</dt>
                <dd>{t(getPosterSize(isPost ? POST_POSTER_FORMAT : posterFormat).label)}</dd>
              </div>
            </dl>
          </aside>
        </div>
      )}
    </AppShell>
  )
}

type NativeValidityControl =
  | HTMLButtonElement
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLTextAreaElement

function hasNativeValidity(element: Element): element is NativeValidityControl {
  return (
    element instanceof HTMLButtonElement
    || element instanceof HTMLInputElement
    || element instanceof HTMLSelectElement
    || element instanceof HTMLTextAreaElement
  )
}

function isVisibleFocusTarget(target: HTMLElement): boolean {
  if (
    !target.isConnected
    || target.matches('[hidden], :disabled, [aria-disabled="true"]')
  ) {
    return false
  }
  const style = window.getComputedStyle(target)
  return (
    style.display !== 'none'
    && style.visibility !== 'hidden'
    && target.getClientRects().length > 0
  )
}

function resolveValidationFocusTarget(
  control: Element | null,
): HTMLElement | null {
  if (!(control instanceof HTMLElement)) return null

  const visibleTargetId = control.dataset.validationFocusTarget
  if (visibleTargetId) {
    const visibleTarget = document.getElementById(visibleTargetId)
    return visibleTarget instanceof HTMLElement && isVisibleFocusTarget(visibleTarget)
      ? visibleTarget
      : null
  }
  if (control.classList.contains('sr-only')) return null
  return isVisibleFocusTarget(control) ? control : null
}

function firstInvalidControl(form: HTMLFormElement): HTMLElement | null {
  for (const element of Array.from(form.elements)) {
    if (
      hasNativeValidity(element)
      && element.willValidate
      && !element.validity.valid
    ) {
      const target = resolveValidationFocusTarget(element)
      if (target) return target
    }
  }

  for (const element of form.querySelectorAll('[aria-invalid="true"]')) {
    const target = resolveValidationFocusTarget(element)
    if (target) return target
  }
  return null
}

function summarizeUrl(value: string) {
  if (!value.trim()) return ''
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}

function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === 'AbortError'
}
