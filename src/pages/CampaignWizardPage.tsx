import { ArrowLeft, CheckCircle2, Globe2, ImagePlus, Sparkles, Type } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useGenerationActivity } from '../activity/GenerationActivityProvider'
import { DurableGenerationStatus } from '../components/DurableGenerationStatus'
import { AssetSelectionModeControl } from '../components/AssetSelectionModeControl'
import { GenerationReferences } from '../components/GenerationReferences'
import { AppShell } from '../components/AppShell'
import { InlineNotice } from '../components/ui/Feedback'
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

type Phase = 'form' | 'uploading' | 'started' | 'error'

const PHASE_LABEL: Record<Phase, string> = {
  form: '',
  uploading: 'Uploading inputs...',
  started: 'Generation started',
  error: '',
}

export function CampaignWizardPage() {
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
  const [referenceContext, setReferenceContext] = useState('')
  const [pendingReferences, setPendingReferences] = useState<PendingReference[]>([])

  async function persistDraft(): Promise<string> {
    if (!user) throw new Error('Sign in before creating a campaign.')

    const values = {
      scenario: 'product',
      product_url: productUrl.trim(),
      product_name: productName.trim(),
      tagline: tagline.trim() || null,
      cta_text: ctaText.trim() || 'Learn more',
      destination_url: destinationUrl.trim(),
      status: 'draft',
    }

    let campaignId = draftId
    if (!campaignId) {
      const { data, error: createError } = await insforge.database
        .from('campaigns')
        .insert([{ ...values, user_id: user.id }])
        .select('id')
        .single()
      if (createError || !data) throw new Error(createError?.message ?? 'Could not create campaign')
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
      setError('Remove any image URL that could not load, or wait for its preview to finish.')
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
      uploaded = await materializeReferenceImages(user.id, campaignId, pendingReferences)
      const result = await enqueuePosterGeneration({
        campaignId,
        instruction: normalizeReferenceContext(referenceContext),
        referenceImages: uploaded,
        refreshWebsite: true,
        assetSelectionMode: preferences.assetSelectionMode,
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
      const result = await retryPosterGeneration(jobId)
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
  const working = phase === 'uploading' || (
    phase === 'started'
    && activity?.status !== 'succeeded'
    && activity?.status !== 'failed'
    && activity?.status !== 'canceled'
  )

  return (
    <AppShell
      breadcrumbs={[
        { label: 'Campaigns', to: '/' },
        { label: draftId ? 'Campaign draft' : 'New campaign' },
      ]}
      actions={(
        <Link to="/" className="toolbar-button">
          <ArrowLeft size={15} aria-hidden="true" />
          Cancel
        </Link>
      )}
    >
      <header className="page-heading page-heading-compact">
        <div>
          <h1>
            {activity?.status === 'succeeded'
              ? 'Poster ready'
              : activity?.status === 'failed'
                ? 'Generation failed'
                : working
                  ? 'Building your poster'
                  : 'Create campaign'}
          </h1>
          <p>
            {phase === 'uploading'
              ? 'Keep this page open while the source files finish uploading.'
              : working
                ? 'Generation continues in the background after the inputs are queued.'
                : 'Set the source, message, and tracked destination.'}
          </p>
        </div>
      </header>

      {phase === 'uploading' ? (
        <div className="creation-starting" aria-live="polite">
          <span className="spinner" />
          <div>
            <strong>{PHASE_LABEL[phase]}</strong>
            <p>Keep this page open until generation starts.</p>
          </div>
        </div>
      ) : activity?.status === 'succeeded' ? (
        <section className="generation-result generation-result-ready" aria-live="polite">
          <div className="generation-result-copy">
            <CheckCircle2 size={23} aria-hidden="true" />
            <div>
              <span>Version {activity.version_number ?? 1}</span>
              <h2>{activity.campaign_name} is ready</h2>
              <p>The completed poster is now the campaign's current version.</p>
            </div>
          </div>
          {activity.hero_image_url && (
            <img src={activity.hero_image_url} alt={`${activity.campaign_name} poster`} />
          )}
          <Link to={`/campaigns/${activity.campaign_id}`} className="button button-primary">
            Open editor
          </Link>
        </section>
      ) : activity?.status === 'failed' ? (
        <section className="generation-result generation-result-failed" aria-live="polite">
          <DurableGenerationStatus item={activity} />
          <InlineNotice tone="error">
            <strong>Poster generation did not complete.</strong>
            <span>{activity.last_error_message || 'The final automatic attempt failed.'}</span>
          </InlineNotice>
          <div className="form-actions">
            <button type="button" className="button button-primary" onClick={() => void retryGeneration()}>
              <Sparkles size={15} aria-hidden="true" />
              Retry with same inputs
            </button>
            <Link to="/" className="button button-secondary">Back to campaigns</Link>
          </div>
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
        </section>
      ) : phase === 'started' && activity ? (
        <section className="generation-result">
          <DurableGenerationStatus item={activity} safeToLeave />
          <Link to="/" className="button button-secondary">
            Back to campaigns
          </Link>
        </section>
      ) : phase === 'started' ? (
        <div className="creation-starting" aria-live="polite">
          <span className="spinner" />
          <div>
            <strong>Generation started</strong>
            <p>Safe to leave Posterlytics. Activity will update shortly.</p>
          </div>
        </div>
      ) : (
        <div className="wizard-layout">
          <form className="campaign-form" onSubmit={handleSubmit}>
            <section className="form-section" aria-labelledby="source-heading">
              <div className="form-section-heading">
                <span><Globe2 size={17} aria-hidden="true" /></span>
                <div>
                  <h2 id="source-heading">Product source</h2>
                  <p>The website supplies the visual and product context.</p>
                </div>
              </div>
              <div className="field-grid">
                <div className="field field-wide">
                  <label htmlFor="product-url">Website URL <span className="required-label">Required</span></label>
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
                  <label htmlFor="product-name">Product name <span className="required-label">Required</span></label>
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
                  <label htmlFor="tagline">Tagline <span className="optional-label">Optional</span></label>
                  <input
                    id="tagline"
                    className="input"
                    placeholder="Reports your team can act on"
                    value={tagline}
                    onChange={(event) => setTagline(event.target.value)}
                  />
                </div>
              </div>
            </section>

            <section className="form-section" aria-labelledby="message-heading">
              <div className="form-section-heading">
                <span><Type size={17} aria-hidden="true" /></span>
                <div>
                  <h2 id="message-heading">Campaign action</h2>
                  <p>Define the poster action and its tracked destination.</p>
                </div>
              </div>
              <div className="field-grid">
                <div className="field">
                  <label htmlFor="cta-text">Call to action <span className="required-label">Required</span></label>
                  <input
                    id="cta-text"
                    className="input"
                    required
                    placeholder="Start free trial"
                    value={ctaText}
                    onChange={(event) => setCtaText(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="destination-url">Destination URL <span className="required-label">Required</span></label>
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
                  <h2 id="references-heading">Generation references</h2>
                  <p>Add direction or images that are not present on the website.</p>
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
                <strong>Campaign draft saved.</strong>
                <span>{error} Correct the issue and retry this draft.</span>
              </InlineNotice>
            )}

            <div className="form-actions">
              <button
                className="button button-primary"
                type="submit"
                disabled={!pendingReferencesReady(pendingReferences)}
              >
                <Sparkles size={16} aria-hidden="true" />
                {draftId ? 'Retry generation' : 'Generate poster'}
              </button>
              <button type="button" className="button button-secondary" onClick={() => navigate('/')}>
                Cancel
              </button>
            </div>
          </form>

          <aside className="campaign-summary" aria-label="Campaign summary">
            <div className="summary-poster">
              <span className="summary-poster-mark">P</span>
              <strong>{productName.trim() || 'Untitled campaign'}</strong>
              <span>{tagline.trim() || 'Poster preview pending'}</span>
            </div>
            <dl>
              <div>
                <dt>Source</dt>
                <dd>{summarizeUrl(productUrl) || 'Not set'}</dd>
              </div>
              <div>
                <dt>Action</dt>
                <dd>{ctaText.trim() || 'Not set'}</dd>
              </div>
              <div>
                <dt>Destination</dt>
                <dd>{summarizeUrl(destinationUrl) || 'Not set'}</dd>
              </div>
              <div>
                <dt>References</dt>
                <dd>{pendingReferences.length} image{pendingReferences.length === 1 ? '' : 's'}</dd>
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
