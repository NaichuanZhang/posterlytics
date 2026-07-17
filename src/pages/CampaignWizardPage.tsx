import { ArrowLeft, Globe2, ImagePlus, Sparkles, Type } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { GenerationProgress, type AgentPrompt, type AgentStep } from '../components/GenerationProgress'
import { GenerationReferences } from '../components/GenerationReferences'
import { AppShell } from '../components/AppShell'
import { InlineNotice } from '../components/ui/Feedback'
import { insforge } from '../lib/insforge'
import { materializeReferenceImages, deleteReferenceImages } from '../lib/referenceStorage'
import {
  normalizeReferenceContext,
  pendingReferencesReady,
  type PendingReference,
} from '../lib/references'
import {
  createPosterGeneration,
  failPosterGeneration,
  invokeGenerationFunction,
} from '../lib/generationApi'
import type { PosterGenerationStage, PosterLayout } from '../lib/types'

type Phase = 'form' | 'creating' | 'analyzing' | 'generating' | 'error'

const PHASE_LABEL: Record<Phase, string> = {
  form: '',
  creating: 'Creating campaign...',
  analyzing: 'Reading your site - extracting brand, content, and design...',
  generating: 'Generating your poster...',
  error: '',
}

const STEP_DEFS: Array<{ key: AgentStep['key']; label: string; blurb: string }> = [
  { key: 'analyze', label: 'Analyze', blurb: 'Reading your site - brand, palette, copy' },
  { key: 'designer', label: 'Designer', blurb: 'Designing a bespoke poster layout' },
  { key: 'hero', label: 'Poster', blurb: 'Painting the AI poster image' },
]

export function CampaignWizardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('form')
  const [error, setError] = useState<string | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [layout, setLayout] = useState<PosterLayout | null>(null)

  const [productUrl, setProductUrl] = useState('')
  const [productName, setProductName] = useState('')
  const [tagline, setTagline] = useState('')
  const [ctaText, setCtaText] = useState('Get started')
  const [destinationUrl, setDestinationUrl] = useState('')
  const [referenceContext, setReferenceContext] = useState('')
  const [pendingReferences, setPendingReferences] = useState<PendingReference[]>([])

  function patchStep(key: AgentStep['key'], patch: Partial<AgentStep>) {
    setSteps((previous) => previous.map((step) => (step.key === key ? { ...step, ...patch } : step)))
  }

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
    setPhase('creating')

    let campaignId: string
    try {
      campaignId = await persistDraft()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setPhase('error')
      return
    }

    let uploaded = [] as Awaited<ReturnType<typeof materializeReferenceImages>>
    let generationId: string
    try {
      uploaded = await materializeReferenceImages(user.id, campaignId, pendingReferences)
      const generation = await createPosterGeneration({
        campaignId,
        instruction: normalizeReferenceContext(referenceContext),
        referenceImages: uploaded,
        refreshWebsite: true,
      })
      generationId = generation.id
    } catch (cause) {
      if (uploaded.length > 0) await deleteReferenceImages(uploaded)
      setError(cause instanceof Error ? cause.message : String(cause))
      setPhase('error')
      return
    }

    setScreenshotUrl(null)
    setLayout(null)
    setSteps(STEP_DEFS.map((definition) => ({ ...definition, status: 'pending' as const })))

    let failureStage: PosterGenerationStage = 'analyze'
    try {
      setPhase('analyzing')
      patchStep('analyze', { status: 'running' })
      const analyzeData = await invokeGenerationFunction('analyze', campaignId, generationId)
      const analyzeResult = analyzeData as { screenshot_url?: string | null; prompt?: AgentPrompt } | null
      if (analyzeResult?.screenshot_url) setScreenshotUrl(analyzeResult.screenshot_url)
      patchStep('analyze', { status: 'done', prompt: analyzeResult?.prompt })

      failureStage = 'designer'
      setPhase('generating')
      patchStep('designer', { status: 'running' })
      const designerData = await invokeGenerationFunction('designer', campaignId, generationId)
      const designerResult = designerData as { prompt?: AgentPrompt; poster_layout?: PosterLayout } | null
      if (designerResult?.poster_layout) setLayout(designerResult.poster_layout)
      patchStep('designer', { status: 'done', prompt: designerResult?.prompt })

      failureStage = 'hero'
      patchStep('hero', { status: 'running' })
      const heroData = await invokeGenerationFunction('hero', campaignId, generationId)
      patchStep('hero', {
        status: 'done',
        prompt: (heroData as { prompt?: AgentPrompt } | null)?.prompt,
      })
    } catch (cause) {
      await failPosterGeneration(generationId, failureStage, cause)
      patchStep(failureStage === 'analyze' ? 'analyze' : failureStage === 'designer' ? 'designer' : 'hero', {
        status: 'error',
        error: cause instanceof Error ? cause.message : String(cause),
      })
      setError('Generation did not complete. Review the inputs and retry this same draft.')
      setPhase('error')
      return
    }

    navigate(`/campaigns/${campaignId}`)
  }

  const working = phase === 'creating' || phase === 'analyzing' || phase === 'generating'

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
          <h1>{working ? 'Building your poster' : 'Create campaign'}</h1>
          <p>{working ? 'The style board and agent stages update as generation progresses.' : 'Set the source, message, and tracked destination.'}</p>
        </div>
      </header>

      {working && steps.length > 0 ? (
        <GenerationProgress
          headline={PHASE_LABEL[phase]}
          screenshotUrl={screenshotUrl}
          steps={steps}
          layout={layout}
        />
      ) : working ? (
        <div className="creation-starting" aria-live="polite">
          <span className="spinner" />
          <div>
            <strong>{PHASE_LABEL[phase]}</strong>
            <p>Preparing the generation workspace.</p>
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
