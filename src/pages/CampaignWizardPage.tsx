import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  CheckCircle2,
  FileText,
  Globe2,
  ImagePlus,
  ShoppingBag,
  Sparkles,
  Type,
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
import { AssetSelectionModeControl } from '../components/AssetSelectionModeControl'
import { GenerationReferences } from '../components/GenerationReferences'
import { PlatformHintField } from '../components/PlatformHintField'
import { PosterFormatSelect } from '../components/PosterFormatSelect'
import {
  isValidSocialCoverDestination,
  SocialCoverQrSettings,
} from '../components/SocialCoverQrSettings'
import { WebsiteCapturePreview } from '../components/WebsiteCapturePreview'
import { AppShell } from '../components/AppShell'
import { InlineNotice } from '../components/ui/Feedback'
import { useI18n } from '../i18n/I18nProvider'
import { insforge } from '../lib/insforge'
import { useWorkspacePreferences } from '../hooks/useWorkspacePreferences'
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
import {
  AMAZON_SOURCE_HOSTS,
  classifyProductSourceUrl,
  getSourceUseCaseSwitchTarget,
  isAmazonSourceUrl,
} from '../lib/amazonSource'
import { parseAmazonAsin } from '../lib/amazonProduct'
import { lookupAmazonProductTitle } from '../lib/amazonProductLookup'
import {
  DEFAULT_POSTER_SIZE_SLUG,
  getPosterSize,
  type PosterSizeSlug,
} from '../lib/posterSize'
import { normalizePlatformHint } from '../lib/platformHints'
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
  CREATABLE_USE_CASES,
  getUseCase,
  isReferenceOnlyUseCaseId,
  resolvePosterFormatOnUseCaseSwitch,
  type CreatableUseCaseId,
  type UseCaseFieldRequirement,
} from '../lib/useCases'
import { PosterThumbnail } from '../components/posters/PosterThumbnail'
import { derivePosterTranscript } from '../lib/posterTranscript'

type Phase = 'form' | 'uploading' | 'started' | 'error'
type AmazonTitleLookupStatus = 'idle' | 'loading' | 'unavailable'

const AMAZON_SOURCE_HOST_LIST = AMAZON_SOURCE_HOSTS.join(', ')

export function CampaignWizardPage() {
  const { locale, t } = useI18n()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { items: activityItems, refresh: refreshActivity } = useGenerationActivity()
  const { preferences, updatePreferences } = useWorkspacePreferences()
  const [phase, setPhase] = useState<Phase>('form')
  const [validationAttempt, setValidationAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [selectedUseCaseId, setSelectedUseCaseId] = useState<CreatableUseCaseId | null>(null)
  const [sourceMismatchAttempted, setSourceMismatchAttempted] = useState(false)
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

  const [productUrl, setProductUrl] = useState('')
  const [productName, setProductName] = useState('')
  const [tagline, setTagline] = useState('')
  const [ctaText, setCtaText] = useState('Get started')
  const [destinationUrl, setDestinationUrl] = useState('')
  const [posterFormat, setPosterFormat] = useState<PosterSizeSlug>(DEFAULT_POSTER_SIZE_SLUG)
  const [platformHint, setPlatformHint] = useState('')
  const [referenceContext, setReferenceContext] = useState('')
  const [pendingReferences, setPendingReferences] = useState<PendingReference[]>([])
  const pageHeadingRef = useRef<HTMLHeadingElement>(null)
  const sourceHeadingRef = useRef<HTMLHeadingElement>(null)
  const useCasePickerHeadingRef = useRef<HTMLHeadingElement>(null)
  const productUrlInputRef = useRef<HTMLInputElement>(null)
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
  const latestProductUrl = useRef(productUrl)
  const latestProductName = useRef(productName)
  const latestUseCaseId = useRef(selectedUseCaseId)
  const useCasePickerOriginRef = useRef<CreatableUseCaseId | null>(null)
  latestProductUrl.current = productUrl
  latestProductName.current = productName
  latestUseCaseId.current = selectedUseCaseId
  pendingReferencesRef.current = pendingReferences

  useEffect(() => {
    if (!user || restoredOwnerRef.current === user.id) return
    restoredOwnerRef.current = user.id
    const localDraft = loadCampaignDraft(user.id)
    if (localDraft) {
      const restoredReferences = rehydrateLocalDraftReferences(
        localDraft.data.references,
      )
      setSelectedUseCaseId(localDraft.data.selectedUseCaseId)
      setProductUrl(localDraft.data.productUrl)
      setProductName(localDraft.data.productName)
      setTagline(localDraft.data.tagline)
      setCtaText(localDraft.data.ctaText)
      setDestinationUrl(localDraft.data.destinationUrl)
      setPosterFormat(localDraft.data.posterFormat)
      setPlatformHint(localDraft.data.platformHint)
      setReferenceContext(localDraft.data.referenceContext)
      setPendingReferences(restoredReferences.pendingReferences)
      setRestoredFileReferences(restoredReferences.unrestorableFiles)
      setDraftId(localDraft.data.serverCampaignId)
      setEagerCapturePreview(restoreCampaignEagerCapture({
        metadata: localDraft.data.eagerCapture,
        availableCapture: eagerCapturePreview,
        productUrl: localDraft.data.productUrl,
        useCase: localDraft.data.selectedUseCaseId,
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

  const selectedUseCase = selectedUseCaseId ? getUseCase(selectedUseCaseId) : null
  const inputFields = selectedUseCase?.inputFields ?? null
  const productSourceKind = classifyProductSourceUrl(productUrl)
  const mismatchTarget = selectedUseCase
    ? getSourceUseCaseSwitchTarget(
        selectedUseCase.inputFields.productUrl.sourceKind,
        productSourceKind,
      )
    : null
  const invalidAmazonSource = (
    selectedUseCase?.inputFields.productUrl.sourceKind === 'amazon'
    && productSourceKind === 'invalid'
  )
  const amazonListing = selectedUseCaseId === 'amazon_listing'
  const socialCover = selectedUseCaseId === 'social_cover'
  const socialCoverQrEnabled = socialCover && posterFormat === 'rednote_3x4'
  const referenceOnlyMode = isReferenceOnlyUseCaseId(selectedUseCaseId)
  const redNotePost = selectedUseCaseId === 'rednote_post'
  const minimumReferenceImages = inputFields
    ? Math.max(
        inputFields.referenceImages.minimumCount,
        inputFields.referenceImages.requirement === 'required' ? 1 : 0,
      )
    : 0
  const referenceMinimumMet = pendingReferences.length >= minimumReferenceImages
  const referenceContextRequirementMet = (
    inputFields?.referenceContext !== 'required'
    || normalizeReferenceContext(referenceContext) !== null
  )
  const campaignDraftData = useMemo(() => buildCampaignDraftData({
    selectedUseCaseId,
    productUrl,
    productName,
    tagline,
    ctaText,
    destinationUrl,
    posterFormat,
    platformHint,
    referenceContext,
    pendingReferences,
    unrestorableFiles: restoredFileReferences,
    serverCampaignId: draftId,
    eagerCapture: eagerCapturePreview,
  }), [
    ctaText,
    destinationUrl,
    draftId,
    eagerCapturePreview,
    pendingReferences,
    platformHint,
    posterFormat,
    productName,
    productUrl,
    referenceContext,
    restoredFileReferences,
    selectedUseCaseId,
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
  const productNameRequired = inputFields?.productName === 'required'
  const productNameValidity = useRequiredFieldValidity({
    required: productNameRequired,
    valid: productName.trim().length > 0,
    validationAttempt,
    resetKey: selectedUseCaseId,
  })
  const generationViewActive = phase === 'uploading' || phase === 'started'

  useFocusOnChange(pageHeadingRef, generationViewActive, {
    enabled: generationViewActive,
  })
  useFocusOnChange(sourceHeadingRef, selectedUseCaseId, {
    enabled: selectedUseCaseId !== null,
  })
  useFocusOnChange(useCasePickerHeadingRef, selectedUseCaseId, {
    enabled: selectedUseCaseId === null,
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

  function discardLocalDraft() {
    campaignDraftPersistence.clear()
    cancelAmazonTitleLookup()
    useCasePickerOriginRef.current = null
    setPhase('form')
    setError(null)
    setDraftId(null)
    setJobId(null)
    setSelectedUseCaseId(null)
    setSourceMismatchAttempted(false)
    setEagerCapturePreview(null)
    setCaptureInFlight(false)
    setProductUrl('')
    setProductName('')
    setTagline('')
    setCtaText('Get started')
    setDestinationUrl('')
    setPosterFormat(DEFAULT_POSTER_SIZE_SLUG)
    setPlatformHint('')
    setReferenceContext('')
    setPendingReferences([])
    setRestoredFileReferences([])
    setRestoredDraft(false)
    setInitialPersistedCanonical(null)
  }

  function selectUseCase(useCaseId: CreatableUseCaseId) {
    const source = selectedUseCaseId ?? useCasePickerOriginRef.current
    cancelAmazonTitleLookup()
    latestUseCaseId.current = useCaseId
    setSelectedUseCaseId(useCaseId)
    setSourceMismatchAttempted(false)
    setEagerCapturePreview(null)
    setPosterFormat((current) =>
      resolvePosterFormatOnUseCaseSwitch(current, source, useCaseId)
    )
    if (useCaseId === 'social_cover' && source !== 'social_cover') {
      setDestinationUrl('')
    }
    useCasePickerOriginRef.current = null
    if (
      useCaseId === 'amazon_listing'
      && !destinationUrl.trim()
      && isAmazonSourceUrl(productUrl)
    ) {
      setDestinationUrl(productUrl.trim())
    }
  }

  function prefillAmazonDestination() {
    if (
      selectedUseCaseId === 'amazon_listing'
      && !destinationUrl.trim()
      && isAmazonSourceUrl(productUrl)
    ) {
      setDestinationUrl(productUrl.trim())
    }
  }

  function cancelAmazonTitleLookup() {
    amazonTitleRequestToken.current += 1
    activeAmazonTitleRequest.current?.controller.abort()
    activeAmazonTitleRequest.current = null
    setAmazonTitleLookupStatus('idle')
  }

  async function prefillAmazonProductName() {
    if (
      latestUseCaseId.current !== 'amazon_listing'
      || latestProductName.current.trim()
    ) {
      return
    }

    const requestedUrl = latestProductUrl.current.trim()
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
      && latestUseCaseId.current === 'amazon_listing'
      && parseAmazonAsin(latestProductUrl.current) === asin
      && !latestProductName.current.trim()
    )
  }

  async function persistDraft(): Promise<string> {
    if (!user) throw new Error(t('Sign in before creating a campaign.'))
    if (!selectedUseCaseId) throw new Error(t('Choose a use case before creating a campaign.'))

    const fields = getUseCase(selectedUseCaseId).inputFields
    const qrEnabled = (
      selectedUseCaseId === 'social_cover'
      && posterFormat === 'rednote_3x4'
    )
    if (qrEnabled && !isValidSocialCoverDestination(destinationUrl)) {
      throw new Error(t('Use a complete HTTP or HTTPS destination URL.'))
    }
    const resolvedProductUrl = fields.productUrl.requirement === 'hidden'
      ? null
      : productUrl.trim()
    const resolvedDestinationUrl = qrEnabled
      ? destinationUrl.trim()
      : fields.destinationUrl === 'hidden'
        ? null
        : selectedUseCaseId === 'amazon_listing'
          && !destinationUrl.trim()
          && isAmazonSourceUrl(productUrl)
            ? productUrl.trim()
            : destinationUrl.trim()
    if (resolvedDestinationUrl && resolvedDestinationUrl !== destinationUrl) {
      setDestinationUrl(resolvedDestinationUrl)
    }

    const values = {
      scenario: 'product',
      use_case: selectedUseCaseId,
      product_url: resolvedProductUrl,
      product_name: productName.trim(),
      tagline: tagline.trim() || null,
      cta_text: ctaText.trim() || 'Learn more',
      destination_url: resolvedDestinationUrl,
      platform_hint: fields.platformHint === 'hidden'
        ? null
        : normalizePlatformHint(platformHint),
      poster_format: selectedUseCaseId === 'social_cover'
        ? qrEnabled
          ? 'rednote_3x4'
          : 'rednote_cover_3x4'
        : posterFormat,
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
    if (!user || !selectedUseCaseId || !selectedUseCase || !inputFields) return
    const invalidControl = firstInvalidControl(event.currentTarget)
    if (invalidControl) {
      queueValidationAttempt(invalidControl)
      return
    }
    if (mismatchTarget || invalidAmazonSource) {
      setSourceMismatchAttempted(true)
      queueValidationAttempt(productUrlInputRef.current)
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
    const submittedProductUrl = productUrl
    const submittedUseCase = selectedUseCaseId
    const submittedSocialQrEnabled = socialCoverQrEnabled
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

    if (submittedSocialQrEnabled) {
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
        productUrl: submittedProductUrl,
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
        assetSelectionMode: preferences.assetSelectionMode,
        colorScheme: submittedColorScheme,
        locale,
      })
      campaignDraftPersistence.clear()
      setRestoredDraft(false)
      setRestoredFileReferences([])
      setJobId(result.job.id)
      setPhase('started')
      await refreshActivity()
      if (result.generation.asset_selection_mode === 'editor') {
        navigate(
          `/campaigns/${campaignId}/generations/${result.generation.id}/assets`,
        )
      }
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
      if (result.generation.asset_selection_mode === 'editor') {
        navigate(
          `/campaigns/${result.generation.campaign_id}/generations/${result.generation.id}/assets`,
        )
      }
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

  function renderCampaignAction(fields: NonNullable<typeof inputFields>) {
    if (fields.ctaText === 'hidden' && fields.destinationUrl === 'hidden') return null

    return (
      <section className="form-section" aria-labelledby="message-heading">
        <div className="form-section-heading">
          <span><Type size={17} aria-hidden="true" /></span>
          <div>
            <h2 id="message-heading">{t('Campaign action')}</h2>
            <p>{t('Define the poster action and its tracked destination.')}</p>
          </div>
        </div>
        <div className="field-grid">
          {fields.ctaText !== 'hidden' && (
            <div className="field">
              <label htmlFor="cta-text">
                {t('Call to action')} <FieldRequirement requirement={fields.ctaText} />
              </label>
              <input
                id="cta-text"
                className="input"
                required={fields.ctaText === 'required'}
                placeholder={t('Start free trial')}
                value={ctaText}
                onChange={(event) => setCtaText(event.target.value)}
              />
            </div>
          )}
          {fields.destinationUrl !== 'hidden' && (
            <div className="field">
              <label htmlFor="destination-url">
                {t('Destination URL')}{' '}
                <FieldRequirement requirement={fields.destinationUrl} />
              </label>
              <input
                id="destination-url"
                className="input"
                type="url"
                required={fields.destinationUrl === 'required'}
                placeholder="https://yourproduct.com/signup"
                value={destinationUrl}
                onChange={(event) => setDestinationUrl(event.target.value)}
              />
            </div>
          )}
        </div>
      </section>
    )
  }

  function renderArtworkOutputFields(fields: NonNullable<typeof inputFields>) {
    if (!selectedUseCase) return null

    const outputFields = (
      <>
        {fields.tagline !== 'hidden' && (
          <div className="field">
            <label htmlFor="tagline">
              {referenceOnlyMode ? t('Supporting line') : t('Tagline')}{' '}
              <FieldRequirement requirement={fields.tagline} />
            </label>
            <input
              id="tagline"
              className="input"
              required={fields.tagline === 'required'}
              placeholder={referenceOnlyMode
                ? t('A short optional line')
                : t('Reports your team can act on')}
              value={tagline}
              onChange={(event) => setTagline(event.target.value)}
            />
          </div>
        )}
        {socialCover ? (
          <SocialCoverQrSettings
            idPrefix="social-cover-qr"
            enabled={socialCoverQrEnabled}
            destinationUrl={destinationUrl}
            onEnabledChange={(enabled) => {
              setPosterFormat(enabled ? 'rednote_3x4' : 'rednote_cover_3x4')
              if (!enabled) setDestinationUrl('')
            }}
            onDestinationUrlChange={setDestinationUrl}
          />
        ) : (
          <PosterFormatSelect
            id="poster-format"
            value={posterFormat}
            allowedFormats={selectedUseCase.allowedPosterFormats}
            onChange={setPosterFormat}
          />
        )}
        {fields.platformHint !== 'hidden' && (
          <PlatformHintField
            id="platform-hint"
            value={platformHint}
            onChange={setPlatformHint}
          />
        )}
      </>
    )

    if (!referenceOnlyMode) return outputFields

    return (
      <section className="form-section" aria-labelledby="artwork-output-heading">
        <div className="form-section-heading">
          <span><Type size={17} aria-hidden="true" /></span>
          <div>
            <h2 id="artwork-output-heading">{t('Artwork output')}</h2>
            <p>
              {socialCover
                ? t('Keep the full-bleed default or add a tracked QR footer.')
                : t('Name the artwork and choose its full-bleed output format.')}
            </p>
          </div>
        </div>
        <div className="field-grid">
          {outputFields}
        </div>
      </section>
    )
  }

  function renderGenerationReferences(fields: NonNullable<typeof inputFields>) {
    if (
      fields.referenceContext === 'hidden'
      && fields.referenceImages.requirement === 'hidden'
    ) {
      return null
    }

    const referenceProps = amazonListing
      ? {
          contextLabel: t('Listing copy'),
          contextPlaceholder: t('Paste the product title, bullets, description, and approved claims.'),
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
            referenceImagesHint: t('Reference images are the primary visual source.'),
          }
        : referenceOnlyMode
          ? {
            contextLabel: t('Creative direction'),
            contextPlaceholder: t('Describe the mood, visual hook, audience, and anything the artwork should preserve.'),
            contextHint: t('Creative direction is interpreted together with the reference images.'),
            referenceImagesLabel: t('Creative references'),
            referenceImagesHint: t('Reference images are the primary visual source.'),
          }
          : {}

    return (
      <section className="form-section" aria-labelledby="references-heading">
        <div className="form-section-heading">
          <span><ImagePlus size={17} aria-hidden="true" /></span>
          <div>
            <h2 id="references-heading">
              {amazonListing
                ? t('Listing copy and product images')
                : redNotePost
                  ? t('Draft copy and creative references')
                  : referenceOnlyMode
                    ? t('Creative references and direction')
                : t('Generation references')}
            </h2>
            <p>
              {amazonListing
                ? t('Provide the seller-owned text and visuals Posterlytics should use.')
                : redNotePost
                  ? t('Add the complete draft copy and at least one image for the post.')
                  : referenceOnlyMode
                    ? t('Start with at least one image, then add any context that should shape the artwork.')
                : t('Add direction or images that are not present on the website.')}
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
          contextRequirement={fields.referenceContext}
          referenceImagesRequirement={fields.referenceImages.requirement}
          referenceImagesMinimumCount={fields.referenceImages.minimumCount}
          validationAttempt={validationAttempt}
          {...referenceProps}
        />
        <AssetSelectionModeControl
          value={preferences.assetSelectionMode}
          onChange={(assetSelectionMode) => updatePreferences({ assetSelectionMode })}
        />
      </section>
    )
  }

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
                : selectedUseCase
                  ? redNotePost
                    ? t('Set artwork details, draft copy, creative references, and an optional platform hint.')
                    : referenceOnlyMode
                      ? t('Set artwork details, creative references, and an optional platform hint.')
                    : t('Set the source, message, and tracked destination.')
                  : t('Choose the campaign source that matches what you want to create.')}
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
              <h2>{t('{name} is ready', { name: activity.campaign_name })}</h2>
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
              alt={t('{name} poster', { name: activity.campaign_name })}
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
      ) : !selectedUseCase || !inputFields ? (
        <section className="use-case-picker" aria-labelledby="use-case-picker-heading">
          <div className="use-case-picker-heading">
            <h2 ref={useCasePickerHeadingRef} id="use-case-picker-heading">
              {t('Choose a campaign type')}
            </h2>
            <p>{t('Select the source workflow that matches this campaign.')}</p>
          </div>
          <div className="use-case-card-grid">
            {CREATABLE_USE_CASES.map((useCase) => (
              <button
                key={useCase.id}
                type="button"
                className="use-case-card"
                onClick={() => selectUseCase(useCase.id)}
              >
                <span className="use-case-card-icon" aria-hidden="true">
                  {useCase.id === 'amazon_listing'
                    ? <ShoppingBag size={22} />
                    : useCase.id === 'rednote_post'
                      ? <FileText size={22} />
                      : isReferenceOnlyUseCaseId(useCase.id)
                        ? <ImagePlus size={22} />
                        : <Globe2 size={22} />}
                </span>
                <span className="use-case-card-copy">
                  <strong>{t(useCase.label)}</strong>
                  {useCase.creationDescription && (
                    <span>{t(useCase.creationDescription)}</span>
                  )}
                </span>
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      ) : (
        <div className="wizard-layout">
          <form
            className="campaign-form"
            onInvalidCapture={handleInvalidCapture}
            onSubmit={handleSubmit}
          >
            <div className="campaign-use-case-selection">
              <div>
                <span>{t('Campaign type')}</span>
                <strong>{t(selectedUseCase.label)}</strong>
              </div>
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() => {
                  useCasePickerOriginRef.current = selectedUseCaseId
                  cancelAmazonTitleLookup()
                  latestUseCaseId.current = null
                  setSelectedUseCaseId(null)
                  setSourceMismatchAttempted(false)
                  setEagerCapturePreview(null)
                }}
              >
                <ArrowRightLeft size={14} aria-hidden="true" />
                {t('Change campaign type')}
              </button>
            </div>

            <section className="form-section" aria-labelledby="source-heading">
              <div className="form-section-heading">
                <span>
                  {referenceOnlyMode
                    ? <ImagePlus size={17} aria-hidden="true" />
                    : <Globe2 size={17} aria-hidden="true" />}
                </span>
                <div>
                  <h2 ref={sourceHeadingRef} id="source-heading">
                    {referenceOnlyMode ? t('Artwork details') : t('Product source')}
                  </h2>
                  <p>
                    {amazonListing
                      ? t('Use a supported Amazon listing URL. Posterlytics will use seller-provided references instead of scraping the page.')
                      : referenceOnlyMode
                        ? t('Name the artwork and choose its full-bleed output format.')
                      : t('The website supplies the visual and product context.')}
                  </p>
                </div>
              </div>
              <div className="field-grid">
                {inputFields.productUrl.requirement !== 'hidden' && (
                  <div className="field field-wide">
                    <label htmlFor="product-url">
                      {amazonListing ? t('Amazon listing URL') : t('Website URL')}{' '}
                      <FieldRequirement requirement={inputFields.productUrl.requirement} />
                    </label>
                    <input
                      ref={productUrlInputRef}
                      id="product-url"
                      className="input"
                      type="url"
                      required={inputFields.productUrl.requirement === 'required'}
                      placeholder={amazonListing
                        ? t('https://www.amazon.com/dp/B0EXAMPLE')
                        : 'https://yourproduct.com'}
                      value={productUrl}
                      aria-describedby={
                        mismatchTarget || invalidAmazonSource
                          ? 'product-url-mismatch'
                          : undefined
                      }
                      onChange={(event) => {
                        const nextUrl = event.target.value
                        latestProductUrl.current = nextUrl
                        cancelAmazonTitleLookup()
                        setProductUrl(nextUrl)
                        setSourceMismatchAttempted(false)
                        setEagerCapturePreview(null)
                      }}
                      onBlur={() => {
                        prefillAmazonDestination()
                        void prefillAmazonProductName()
                      }}
                    />
                  </div>
                )}
                {(mismatchTarget || invalidAmazonSource) && (
                  <div
                    className="field field-wide source-mismatch"
                    id="product-url-mismatch"
                  >
                    <InlineNotice tone={sourceMismatchAttempted ? 'error' : 'warning'}>
                      <span className="source-mismatch-copy">
                        <strong>
                          {invalidAmazonSource
                            ? t('Enter a supported Amazon listing URL.')
                            : mismatchTarget === 'amazon_listing'
                              ? t('This source belongs to Amazon listing.')
                              : t('This is not a supported Amazon listing URL.')}
                        </strong>
                        <span>
                          {invalidAmazonSource
                            ? t('Use a complete HTTP or HTTPS URL on one of these hosts: {hosts}.', {
                              hosts: AMAZON_SOURCE_HOST_LIST,
                            })
                            : mismatchTarget === 'amazon_listing'
                              ? t('Amazon sources use seller-provided copy and images instead of website capture.')
                              : t('Use a complete HTTP or HTTPS URL on one of these hosts: {hosts}.', {
                                hosts: AMAZON_SOURCE_HOST_LIST,
                              })}
                        </span>
                      </span>
                      {mismatchTarget && (
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          onClick={() => selectUseCase(mismatchTarget)}
                        >
                          <ArrowRightLeft size={14} aria-hidden="true" />
                          {mismatchTarget === 'amazon_listing'
                            ? t('Switch to Amazon listing')
                            : t('Switch to Website product')}
                        </button>
                      )}
                    </InlineNotice>
                  </div>
                )}
                {selectedUseCaseId === 'website_product' && (
                  <WebsiteCapturePreview
                    url={productUrl}
                    disabled={Boolean(mismatchTarget)}
                    onPreviewChange={setEagerCapturePreview}
                    onCaptureInFlightChange={setCaptureInFlight}
                  />
                )}
                {inputFields.productName !== 'hidden' && (
                  <div className="field">
                    <label htmlFor="product-name">
                      {referenceOnlyMode ? t('Artwork name') : t('Product name')}{' '}
                      <FieldRequirement requirement={inputFields.productName} />
                    </label>
                    <input
                      id="product-name"
                      className="input"
                      required={inputFields.productName === 'required'}
                      aria-required={productNameRequired}
                      aria-invalid={productNameValidity.invalid}
                      placeholder={referenceOnlyMode ? t('Summer launch cover') : 'Northstar Reports'}
                      value={productName}
                      aria-describedby={[
                        amazonListing && amazonTitleLookupStatus !== 'idle'
                          ? 'amazon-title-lookup-status'
                          : '',
                        productNameValidity.invalid ? 'product-name-error' : '',
                      ].filter(Boolean).join(' ') || undefined}
                      onChange={(event) => {
                        const nextName = event.target.value
                        latestProductName.current = nextName
                        if (nextName.trim()) cancelAmazonTitleLookup()
                        setProductName(nextName)
                      }}
                      onBlur={productNameValidity.onBlur}
                    />
                    {amazonListing && amazonTitleLookupStatus !== 'idle' && (
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
                    {productNameValidity.invalid && (
                      <p className="field-error" id="product-name-error">
                        {t('{name} is required.', {
                          name: referenceOnlyMode
                            ? t('Artwork name')
                            : t('Product name'),
                        })}
                      </p>
                    )}
                  </div>
                )}
                {!referenceOnlyMode && renderArtworkOutputFields(inputFields)}
              </div>
            </section>

            {referenceOnlyMode && renderGenerationReferences(inputFields)}
            {referenceOnlyMode && renderArtworkOutputFields(inputFields)}
            {amazonListing && renderGenerationReferences(inputFields)}
            {renderCampaignAction(inputFields)}
            {!amazonListing && !referenceOnlyMode && renderGenerationReferences(inputFields)}

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
              {inputFields.productUrl.requirement !== 'hidden' && (
                <div>
                  <dt>{t('Source')}</dt>
                  <dd>{summarizeUrl(productUrl) || t('Not set')}</dd>
                </div>
              )}
              {inputFields.ctaText !== 'hidden' && (
                <div>
                  <dt>{t('Action')}</dt>
                  <dd>{ctaText.trim() || t('Not set')}</dd>
                </div>
              )}
              {(inputFields.destinationUrl !== 'hidden' || socialCoverQrEnabled) && (
                <div>
                  <dt>{t('Destination')}</dt>
                  <dd>{summarizeUrl(destinationUrl) || t('Not set')}</dd>
                </div>
              )}
              {inputFields.platformHint !== 'hidden' && (
                <div>
                  <dt>{t('Target platform')}</dt>
                  <dd>{platformHint.trim() || t('No platform hint')}</dd>
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
                <dd>{t(getPosterSize(posterFormat).label)}</dd>
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

function FieldRequirement({
  requirement,
}: {
  requirement: UseCaseFieldRequirement
}) {
  const { t } = useI18n()
  return requirement === 'required' ? (
    <span className="required-label">{t('Required')}</span>
  ) : (
    <span className="optional-label">{t('Optional')}</span>
  )
}
