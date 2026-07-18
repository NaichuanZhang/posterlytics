import { ArrowLeft, CheckCircle2, Globe2, ImagePlus, Sparkles, Type } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useGenerationActivity } from '../activity/GenerationActivityProvider'
import { DurableGenerationStatus } from '../components/DurableGenerationStatus'
import { AssetSelectionModeControl } from '../components/AssetSelectionModeControl'
import { GenerationReferences } from '../components/GenerationReferences'
import { PosterFormatSelect } from '../components/PosterFormatSelect'
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
  DEFAULT_POSTER_SIZE_SLUG,
  getPosterSize,
  type PosterSizeSlug,
} from '../lib/posterSize'

type Phase = 'form' | 'uploading' | 'started' | 'error'

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

  const [productUrl, setProductUrl] = useState('')
  const [productName, setProductName] = useState('')
  const [tagline, setTagline] = useState('')
  const [ctaText, setCtaText] = useState('Get started')
  const [destinationUrl, setDestinationUrl] = useState('')
  const [posterFormat, setPosterFormat] = useState<PosterSizeSlug>(DEFAULT_POSTER_SIZE_SLUG)
  const [referenceContext, setReferenceContext] = useState('')
  const [pendingReferences, setPendingReferences] = useState<PendingReference[]>([])

  async function persistDraft(): Promise<string> {
    if (!user) throw new Error(t('Sign in before creating a campaign.'))

    const values = {
      scenario: 'product',
      product_url: productUrl.trim(),
      product_name: productName.trim(),
      tagline: tagline.trim() || null,
      cta_text: ctaText.trim() || 'Learn more',
      destination_url: destinationUrl.trim(),
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
        throw new Error(createError?.message ?? t('Could not create campaign'))
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
    if (!user) return
    if (!pendingReferencesReady(pendingReferences)) {
      setError(t('Remove any image URL that could not load, or wait for its preview to finish.'))
      return
    }
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
                : t('Set the source, message, and tracked destination.')}
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
      ) : (
        <div className="wizard-layout">
          <form className="campaign-form" onSubmit={handleSubmit}>
            <section className="form-section" aria-labelledby="source-heading">
              <div className="form-section-heading">
                <span><Globe2 size={17} aria-hidden="true" /></span>
                <div>
                  <h2 id="source-heading">{t('Product source')}</h2>
                  <p>{t('The website supplies the visual and product context.')}</p>
                </div>
              </div>
              <div className="field-grid">
                <div className="field field-wide">
                  <label htmlFor="product-url">
                    {t('Website URL')} <span className="required-label">{t('Required')}</span>
                  </label>
                  <input
                    id="product-url"
                    className="input"
                    type="url"
                    required
                    placeholder="https://yourproduct.com"
                    value={productUrl}
                    onChange={(event) => setProductUrl(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="product-name">
                    {t('Product name')} <span className="required-label">{t('Required')}</span>
                  </label>
                  <input
                    id="product-name"
                    className="input"
                    required
                    placeholder="Northstar Reports"
                    value={productName}
                    onChange={(event) => setProductName(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="tagline">
                    {t('Tagline')} <span className="optional-label">{t('Optional')}</span>
                  </label>
                  <input
                    id="tagline"
                    className="input"
                    placeholder={t('Reports your team can act on')}
                    value={tagline}
                    onChange={(event) => setTagline(event.target.value)}
                  />
                </div>
                <PosterFormatSelect
                  id="poster-format"
                  value={posterFormat}
                  onChange={setPosterFormat}
                />
              </div>
            </section>

            <section className="form-section" aria-labelledby="message-heading">
              <div className="form-section-heading">
                <span><Type size={17} aria-hidden="true" /></span>
                <div>
                  <h2 id="message-heading">{t('Campaign action')}</h2>
                  <p>{t('Define the poster action and its tracked destination.')}</p>
                </div>
              </div>
              <div className="field-grid">
                <div className="field">
                  <label htmlFor="cta-text">
                    {t('Call to action')} <span className="required-label">{t('Required')}</span>
                  </label>
                  <input
                    id="cta-text"
                    className="input"
                    required
                    placeholder={t('Start free trial')}
                    value={ctaText}
                    onChange={(event) => setCtaText(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="destination-url">
                    {t('Destination URL')} <span className="required-label">{t('Required')}</span>
                  </label>
                  <input
                    id="destination-url"
                    className="input"
                    type="url"
                    required
                    placeholder="https://yourproduct.com/signup"
                    value={destinationUrl}
                    onChange={(event) => setDestinationUrl(event.target.value)}
                  />
                </div>
              </div>
            </section>

            <section className="form-section" aria-labelledby="references-heading">
              <div className="form-section-heading">
                <span><ImagePlus size={17} aria-hidden="true" /></span>
                <div>
                  <h2 id="references-heading">{t('Generation references')}</h2>
                  <p>{t('Add direction or images that are not present on the website.')}</p>
                </div>
              </div>
              <GenerationReferences
                context={referenceContext}
                onContextChange={setReferenceContext}
                existingImages={[]}
                onRemoveExisting={() => {}}
                pendingReferences={pendingReferences}
                onPendingReferencesChange={setPendingReferences}
              />
              <AssetSelectionModeControl
                value={preferences.assetSelectionMode}
                onChange={(assetSelectionMode) => updatePreferences({ assetSelectionMode })}
              />
            </section>

            {error && (
              <InlineNotice tone="error">
                <strong>{t('Campaign draft saved.')}</strong>
                <span>{error} {t('Correct the issue and retry this draft.')}</span>
              </InlineNotice>
            )}

            <div className="form-actions">
              <button
                className="button button-primary"
                type="submit"
                disabled={!pendingReferencesReady(pendingReferences)}
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
                <dd>{summarizeUrl(productUrl) || t('Not set')}</dd>
              </div>
              <div>
                <dt>{t('Action')}</dt>
                <dd>{ctaText.trim() || t('Not set')}</dd>
              </div>
              <div>
                <dt>{t('Destination')}</dt>
                <dd>{summarizeUrl(destinationUrl) || t('Not set')}</dd>
              </div>
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
