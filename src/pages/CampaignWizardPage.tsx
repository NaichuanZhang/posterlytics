import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { GenerationProgress, type AgentPrompt, type AgentStep } from '../components/GenerationProgress'
import { GenerationReferences } from '../components/GenerationReferences'
import { Layout } from '../components/Layout'
import { insforge } from '../lib/insforge'
import { uploadReferenceImages, deleteReferenceImages } from '../lib/referenceStorage'
import { normalizeReferenceContext } from '../lib/references'
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
  const [referenceFiles, setReferenceFiles] = useState<File[]>([])

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

    let uploaded = [] as Awaited<ReturnType<typeof uploadReferenceImages>>
    let generationId: string
    try {
      uploaded = await uploadReferenceImages(user.id, campaignId, referenceFiles)
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
    <Layout>
      <div className="hero-card">
        <span className="eyebrow">Paste a link, get an on-brand poster</span>
        <h1>Tell us about your product</h1>
        <p>
          We read your site and any supporting references, then generate a poster with a tracked QR for every placement.
        </p>
      </div>

      {working && steps.length > 0 ? (
        <GenerationProgress headline={PHASE_LABEL[phase]} screenshotUrl={screenshotUrl} steps={steps} layout={layout} />
      ) : working ? (
        <div className="card center" style={{ padding: 56 }}>
          <div className="spinner" style={{ margin: '0 auto 20px' }} />
          <p style={{ fontSize: '1.05rem', fontWeight: 600 }}>{PHASE_LABEL[phase]}</p>
          <p className="muted" style={{ marginTop: 6 }}>This usually takes less than a minute.</p>
        </div>
      ) : (
        <form className="card" onSubmit={handleSubmit}>
          <div className="field field-num">
            <label data-num="1">Product website URL <span className="req">required</span></label>
            <input
              className="input"
              type="url"
              required
              placeholder="https://yourproduct.com"
              value={productUrl}
              onChange={(event) => setProductUrl(event.target.value)}
            />
            <div className="hint">We read this for brand style, imagery, and product details.</div>
          </div>

          <div className="field field-num">
            <label data-num="2">Product name <span className="req">required</span></label>
            <input
              className="input"
              required
              placeholder="Acme Analytics"
              value={productName}
              onChange={(event) => setProductName(event.target.value)}
            />
          </div>

          <div className="field field-num">
            <label data-num="3">Tagline <span className="hint">(optional)</span></label>
            <input
              className="input"
              placeholder="The fastest way to ship dashboards"
              value={tagline}
              onChange={(event) => setTagline(event.target.value)}
            />
          </div>

          <div className="row wrap" style={{ gap: 18, alignItems: 'flex-start' }}>
            <div className="field field-num" style={{ flex: '1 1 180px' }}>
              <label data-num="4">Call to action <span className="req">required</span></label>
              <input
                className="input"
                required
                placeholder="Start free trial"
                value={ctaText}
                onChange={(event) => setCtaText(event.target.value)}
              />
            </div>
            <div className="field field-num" style={{ flex: '2 1 280px' }}>
              <label data-num="5">Destination URL <span className="req">required</span></label>
              <input
                className="input"
                type="url"
                required
                placeholder="https://yourproduct.com/signup"
                value={destinationUrl}
                onChange={(event) => setDestinationUrl(event.target.value)}
              />
              <div className="hint">Where the QR sends visitors after the visit is recorded.</div>
            </div>
          </div>

          <div className="reference-section">
            <h3>Generation references</h3>
            <p className="muted">Give the generator visual material or context that the website does not contain.</p>
            <GenerationReferences
              context={referenceContext}
              onContextChange={setReferenceContext}
              existingImages={[]}
              onRemoveExisting={() => {}}
              pendingFiles={referenceFiles}
              onPendingFilesChange={setReferenceFiles}
            />
          </div>

          {error && (
            <div className="form-error" role="alert">
              <strong>Campaign draft saved.</strong>
              <span>{error} Correct the issue and retry this same draft.</span>
            </div>
          )}

          <div className="row wrap" style={{ marginTop: 18 }}>
            <button className="btn" type="submit">
              {draftId ? 'Retry generation' : 'Generate poster'} <span className="btn-icon">-&gt;</span>
            </button>
            <button type="button" className="btn ghost" onClick={() => navigate('/')}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Layout>
  )
}
