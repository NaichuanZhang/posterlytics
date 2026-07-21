import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  CheckCircle2,
  Globe2,
  ImagePlus,
  ShoppingBag,
  Sparkles,
  Type,
} from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useGenerationActivity } from '../activity/GenerationActivityProvider'
import { DurableGenerationStatus } from '../components/DurableGenerationStatus'
import { AssetSelectionModeControl } from '../components/AssetSelectionModeControl'
import { GenerationReferences } from '../components/GenerationReferences'
import { PlatformHintField } from '../components/PlatformHintField'
import { PosterFormatSelect } from '../components/PosterFormatSelect'
import { WebsiteCapturePreview } from '../components/WebsiteCapturePreview'
import { AppShell } from '../components/AppShell'
import { InlineNotice } from '../components/ui/Feedback'
import { useI18n } from '../i18n/I18nProvider'
import { insforge } from '../lib/insforge'
import { useWorkspacePreferences } from '../hooks/useWorkspacePreferences'
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
import {
  DEFAULT_POSTER_SIZE_SLUG,
  getPosterSize,
  type PosterSizeSlug,
} from '../lib/posterSize'
import { normalizePlatformHint } from '../lib/platformHints'
import {
  EagerCaptureSyncError,
  syncEagerCaptureEvidence,
} from '../lib/eagerCapturePersistence'
import type { SelectedEagerCapture } from '../lib/eagerCapture'
import { getDeviceColorScheme } from '../lib/colorScheme'
import {
  CREATABLE_USE_CASES,
  getUseCase,
  type CreatableUseCaseId,
  type UseCaseFieldRequirement,
} from '../lib/useCases'

type Phase = 'form' | 'uploading' | 'started' | 'error'

const AMAZON_SOURCE_HOST_LIST = AMAZON_SOURCE_HOSTS.join(', ')

export function CampaignWizardPage() {
  const { locale, t } = useI18n()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { items: activityItems, refresh: refreshActivity } = useGenerationActivity()
  const { preferences, updatePreferences } = useWorkspacePreferences()
  const [phase, setPhase] = useState<Phase>('form')
  const [error, setError] = useState<string | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [selectedUseCaseId, setSelectedUseCaseId] = useState<CreatableUseCaseId | null>(null)
  const [sourceMismatchAttempted, setSourceMismatchAttempted] = useState(false)
  const [eagerCapturePreview, setEagerCapturePreview] =
    useState<SelectedEagerCapture | null>(null)

  const [productUrl, setProductUrl] = useState('')
  const [productName, setProductName] = useState('')
  const [tagline, setTagline] = useState('')
  const [ctaText, setCtaText] = useState('Get started')
  const [destinationUrl, setDestinationUrl] = useState('')
  const [posterFormat, setPosterFormat] = useState<PosterSizeSlug>(DEFAULT_POSTER_SIZE_SLUG)
  const [platformHint, setPlatformHint] = useState('')
  const [referenceContext, setReferenceContext] = useState('')
  const [pendingReferences, setPendingReferences] = useState<PendingReference[]>([])
  const productUrlInputRef = useRef<HTMLInputElement>(null)

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
  const minimumReferenceImages = inputFields
    ? Math.max(
        inputFields.referenceImages.minimumCount,
        inputFields.referenceImages.requirement === 'required' ? 1 : 0,
      )
    : 0
  const referenceMinimumMet = pendingReferences.length >= minimumReferenceImages

  function selectUseCase(useCaseId: CreatableUseCaseId) {
    const nextUseCase = getUseCase(useCaseId)
    setSelectedUseCaseId(useCaseId)
    setSourceMismatchAttempted(false)
    setEagerCapturePreview(null)
    setPosterFormat((current) =>
      nextUseCase.allowedPosterFormats.includes(current)
        ? current
        : nextUseCase.defaultPosterFormat
    )
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

  async function persistDraft(): Promise<string> {
    if (!user) throw new Error(t('Sign in before creating a campaign.'))
    if (!selectedUseCaseId) throw new Error(t('Choose a use case before creating a campaign.'))

    const fields = getUseCase(selectedUseCaseId).inputFields
    const resolvedProductUrl = fields.productUrl.requirement === 'hidden'
      ? null
      : productUrl.trim()
    const resolvedDestinationUrl = fields.destinationUrl === 'hidden'
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
      poster_format: posterFormat,
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!user || !selectedUseCaseId || !selectedUseCase || !inputFields) return
    if (mismatchTarget || invalidAmazonSource) {
      setSourceMismatchAttempted(true)
      productUrlInputRef.current?.focus()
      return
    }
    if (pendingReferences.length < minimumReferenceImages) {
      setError(t('Add at least {count} images.', { count: minimumReferenceImages }))
      return
    }
    if (!pendingReferencesReady(pendingReferences)) {
      setError(t('Remove any image URL that could not load, or wait for its preview to finish.'))
      return
    }
    const submittedColorScheme = getDeviceColorScheme()
    const submittedProductUrl = productUrl
    const submittedUseCase = selectedUseCaseId
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
      : socialCover
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
                : socialCover
                  ? t('Creative references and direction')
                : t('Generation references')}
            </h2>
            <p>
              {amazonListing
                ? t('Provide the seller-owned text and visuals Posterlytics should use.')
                : socialCover
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
          onPendingReferencesChange={setPendingReferences}
          contextRequirement={fields.referenceContext}
          referenceImagesRequirement={fields.referenceImages.requirement}
          referenceImagesMinimumCount={fields.referenceImages.minimumCount}
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
          <h1>
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
                  ? socialCover
                    ? t('Set artwork details, creative references, and an optional platform hint.')
                    : t('Set the source, message, and tracked destination.')
                  : t('Choose the campaign source that matches what you want to create.')}
          </p>
        </div>
      </header>

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
          {activity.hero_image_url && (
            <img
              src={activity.hero_image_url}
              alt={t('{name} poster', { name: activity.campaign_name })}
              style={{
                aspectRatio: `${activityPosterSize!.artwork.width} / ${activityPosterSize!.artwork.height}`,
              }}
            />
          )}
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
            <h2 id="use-case-picker-heading">{t('Choose a campaign type')}</h2>
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
                    : useCase.id === 'social_cover'
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
          <form className="campaign-form" onSubmit={handleSubmit}>
            <div className="campaign-use-case-selection">
              <div>
                <span>{t('Campaign type')}</span>
                <strong>{t(selectedUseCase.label)}</strong>
              </div>
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() => {
                  setSelectedUseCaseId(null)
                  setSourceMismatchAttempted(false)
                  setEagerCapturePreview(null)
                }}
              >
                <ArrowRightLeft size={14} aria-hidden="true" />
                {t('Change campaign type')}
              </button>
            </div>

            {socialCover && renderGenerationReferences(inputFields)}

            <section className="form-section" aria-labelledby="source-heading">
              <div className="form-section-heading">
                <span>
                  {socialCover
                    ? <ImagePlus size={17} aria-hidden="true" />
                    : <Globe2 size={17} aria-hidden="true" />}
                </span>
                <div>
                  <h2 id="source-heading">
                    {socialCover ? t('Artwork details') : t('Product source')}
                  </h2>
                  <p>
                    {amazonListing
                      ? t('Use a supported Amazon listing URL. Posterlytics will use seller-provided references instead of scraping the page.')
                      : socialCover
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
                        setProductUrl(event.target.value)
                        setSourceMismatchAttempted(false)
                        setEagerCapturePreview(null)
                      }}
                      onBlur={prefillAmazonDestination}
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
                  />
                )}
                {inputFields.productName !== 'hidden' && (
                  <div className="field">
                    <label htmlFor="product-name">
                      {socialCover ? t('Artwork name') : t('Product name')}{' '}
                      <FieldRequirement requirement={inputFields.productName} />
                    </label>
                    <input
                      id="product-name"
                      className="input"
                      required={inputFields.productName === 'required'}
                      placeholder={socialCover ? t('Summer launch cover') : 'Northstar Reports'}
                      value={productName}
                      onChange={(event) => setProductName(event.target.value)}
                    />
                  </div>
                )}
                {inputFields.tagline !== 'hidden' && (
                  <div className="field">
                    <label htmlFor="tagline">
                      {socialCover ? t('Supporting line') : t('Tagline')}{' '}
                      <FieldRequirement requirement={inputFields.tagline} />
                    </label>
                    <input
                      id="tagline"
                      className="input"
                      required={inputFields.tagline === 'required'}
                      placeholder={socialCover
                        ? t('A short optional line')
                        : t('Reports your team can act on')}
                      value={tagline}
                      onChange={(event) => setTagline(event.target.value)}
                    />
                  </div>
                )}
                <PosterFormatSelect
                  id="poster-format"
                  value={posterFormat}
                  allowedFormats={selectedUseCase.allowedPosterFormats}
                  onChange={setPosterFormat}
                />
                {inputFields.platformHint !== 'hidden' && (
                  <PlatformHintField
                    id="platform-hint"
                    value={platformHint}
                    onChange={setPlatformHint}
                  />
                )}
              </div>
            </section>

            {amazonListing && renderGenerationReferences(inputFields)}
            {renderCampaignAction(inputFields)}
            {!amazonListing && !socialCover && renderGenerationReferences(inputFields)}

            {error && (
              <InlineNotice tone="error">
                {draftId && <strong>{t('Campaign draft saved.')}</strong>}
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
              {inputFields.destinationUrl !== 'hidden' && (
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

function summarizeUrl(value: string) {
  if (!value.trim()) return ''
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value
  }
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
