import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { insforge } from '../lib/insforge'
import { useAuth } from '../auth/AuthProvider'
import { Layout } from '../components/Layout'
import { Poster } from '../components/Poster'
import { GenerationProgress, type AgentStep, type AgentPrompt } from '../components/GenerationProgress'
import type { Campaign, PosterMode } from '../lib/types'

type Phase = 'form' | 'creating' | 'analyzing' | 'generating' | 'choose' | 'saving' | 'error'

const PHASE_LABEL: Record<Phase, string> = {
  form: '',
  creating: 'Creating campaign…',
  analyzing: 'Reading your site — extracting brand, content & design…',
  generating: 'Generating your poster + landing page…',
  choose: '',
  saving: 'Saving your choice…',
  error: '',
}

// The fixed copy for each pipeline step. `designer` only runs for the designer
// style; it's filtered out of the seed otherwise.
const STEP_DEFS: Array<{ key: AgentStep['key']; label: string; blurb: string }> = [
  { key: 'analyze', label: 'Analyze', blurb: 'Reading your site — brand, palette, copy' },
  { key: 'designer', label: 'Designer', blurb: 'Designing a bespoke poster layout' },
  { key: 'hero', label: 'Poster', blurb: 'Painting the AI poster image' },
  { key: 'landing', label: 'Landing page', blurb: 'Building an on-brand landing page' },
]

export function CampaignWizardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('form')
  const [error, setError] = useState<string | null>(null)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [hasImage, setHasImage] = useState(false)
  // Live "behind the scenes" state for the generation loading screen.
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [steps, setSteps] = useState<AgentStep[]>([])

  // Immutable patch of one step by key (status / prompt updates as agents run).
  function patchStep(key: AgentStep['key'], patch: Partial<AgentStep>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }

  const [productUrl, setProductUrl] = useState('')
  const [productName, setProductName] = useState('')
  const [tagline, setTagline] = useState('')
  const [ctaText, setCtaText] = useState('Get started')
  const [destinationUrl, setDestinationUrl] = useState('')
  // 'auto' lets the analyzer pick; otherwise force the template. 'designer' adds
  // an agentic layout-design step (the `designer` function) before the image.
  const [styleChoice, setStyleChoice] =
    useState<'auto' | 'saas_glassmorphism' | 'cozy_scrapbook' | 'designer'>('auto')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setError(null)

    // 1. Create the campaign row.
    setPhase('creating')
    const { data: created, error: createErr } = await insforge.database
      .from('campaigns')
      .insert([
        {
          user_id: user.id,
          product_url: productUrl.trim(),
          product_name: productName.trim(),
          tagline: tagline.trim() || null,
          cta_text: ctaText.trim() || 'Learn more',
          destination_url: destinationUrl.trim(),
          status: 'draft',
        },
      ])
      .select()
      .single()

    if (createErr || !created) {
      setError(createErr?.message ?? 'Could not create campaign')
      setPhase('error')
      return
    }
    const campaignId = (created as { id: string }).id

    // Seed the live step list (drop the Designer step unless that style is chosen).
    const isDesigner = styleChoice === 'designer'
    setScreenshotUrl(null)
    setSteps(
      STEP_DEFS.filter((d) => d.key !== 'designer' || isDesigner).map((d) => ({
        ...d,
        status: 'pending' as const,
      })),
    )

    // The pipeline runs SEQUENTIALLY so the loading screen can reveal each agent's
    // real prompt the moment it returns: analyze → [designer] → hero → landing.
    // Each step is best-effort — an error marks that row and the flow continues.
    let imageOk = false

    // 2. Analyze: scrape + brand palette + auto-selected template + poster spec.
    setPhase('analyzing')
    patchStep('analyze', { status: 'running' })
    try {
      const { data, error: aErr } = await insforge.functions.invoke('analyze', {
        body: { campaignId, posterStyle: styleChoice === 'auto' ? undefined : styleChoice },
      })
      if (aErr) throw new Error(aErr.message ?? 'Analysis failed')
      const d = data as { screenshot_url?: string | null; prompt?: AgentPrompt } | null
      if (d?.screenshot_url) setScreenshotUrl(d.screenshot_url)
      patchStep('analyze', { status: 'done', prompt: d?.prompt })
    } catch (err) {
      console.error(err)
      patchStep('analyze', { status: 'error' })
    }

    // 3. Generate the assets. For the designer style the layout agent runs BEFORE
    // hero (hero paints from the layout); then the landing agent.
    setPhase('generating')

    if (isDesigner) {
      patchStep('designer', { status: 'running' })
      try {
        const { data, error: dErr } = await insforge.functions.invoke('designer', { body: { campaignId } })
        if (dErr) throw new Error(dErr.message ?? 'Layout design failed')
        patchStep('designer', { status: 'done', prompt: (data as { prompt?: AgentPrompt } | null)?.prompt })
      } catch (err) {
        console.error(err)
        patchStep('designer', { status: 'error' })
      }
    }

    patchStep('hero', { status: 'running' })
    try {
      const { data, error: hErr } = await insforge.functions.invoke('hero', { body: { campaignId } })
      imageOk = !hErr
      patchStep('hero', {
        status: hErr ? 'error' : 'done',
        prompt: (data as { prompt?: AgentPrompt } | null)?.prompt,
      })
    } catch (err) {
      console.error(err)
      imageOk = false
      patchStep('hero', { status: 'error' })
    }

    patchStep('landing', { status: 'running' })
    try {
      const { data, error: lErr } = await insforge.functions.invoke('landing', { body: { campaignId } })
      patchStep('landing', {
        status: lErr ? 'error' : 'done',
        prompt: (data as { prompt?: AgentPrompt } | null)?.prompt,
      })
    } catch (err) {
      console.error(err)
      patchStep('landing', { status: 'error' })
    }

    // 4. Load the finished campaign and show the side-by-side picker.
    const { data: full } = await insforge.database
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .maybeSingle()
    if (full) {
      setCampaign(full as Campaign)
      setHasImage(imageOk && !!(full as Campaign).hero_image_url)
      setPhase('choose')
    } else {
      // Couldn't reload — fall back to the editor with the default template mode.
      navigate(`/campaigns/${campaignId}`)
    }
  }

  async function choose(mode: PosterMode) {
    if (!campaign) return
    setPhase('saving')
    await insforge.database.from('campaigns').update({ poster_mode: mode }).eq('id', campaign.id)
    navigate(`/campaigns/${campaign.id}`)
  }

  const working = phase === 'creating' || phase === 'analyzing' || phase === 'generating' || phase === 'saving'

  return (
    <Layout>
      <div className="hero-card">
        <span className="eyebrow">Paste a link, get an on-brand poster</span>
        <h1>Tell us about your product</h1>
        <p>We scrape your site for brand style, imagery, and copy — then generate two on-brand posters with a tracked QR for every placement.</p>
      </div>

      {phase === 'choose' && campaign ? (
        <div className="card" style={{ padding: 28 }}>
          <h2 style={{ margin: '0 0 6px' }}>Pick your poster</h2>
          <p className="muted" style={{ margin: '0 0 22px' }}>
            Two takes on the same brand. Choose one to continue — you can switch later in the editor.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
            <PickCard
              title="Designed template"
              subtitle="Crisp, deterministic layout"
              onPick={() => choose('template')}
            >
              <Poster campaign={campaign} code="PREVIEW" width={300} mode="template" />
            </PickCard>

            <PickCard
              title="AI illustration"
              subtitle={hasImage ? 'Model-generated artwork' : 'Could not generate — try regenerating later'}
              disabled={!hasImage}
              onPick={() => choose('image')}
            >
              {hasImage ? (
                <Poster campaign={campaign} code="PREVIEW" width={300} mode="image" />
              ) : (
                <div className="muted" style={{ height: 450, display: 'grid', placeItems: 'center', background: 'var(--panel-2)', borderRadius: 8, textAlign: 'center', padding: 24 }}>
                  AI image unavailable.<br />You can generate it later in the editor.
                </div>
              )}
            </PickCard>
          </div>
        </div>
      ) : working && steps.length > 0 ? (
        <GenerationProgress headline={PHASE_LABEL[phase]} screenshotUrl={screenshotUrl} steps={steps} />
      ) : working ? (
        <div className="card center" style={{ padding: 56 }}>
          <div className="spinner" style={{ margin: '0 auto 20px' }} />
          <p style={{ fontSize: '1.05rem', fontWeight: 600 }}>{PHASE_LABEL[phase]}</p>
          <p className="muted" style={{ marginTop: 6 }}>This takes ~10–25 seconds.</p>
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
              onChange={(e) => setProductUrl(e.target.value)}
            />
            <div className="hint">We scrape this for your brand style, logo, imagery, and product story.</div>
          </div>
          <div className="field field-num">
            <label data-num="2">Product name <span className="req">required</span></label>
            <input
              className="input"
              required
              placeholder="Acme Analytics"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
            />
          </div>
          <div className="field field-num">
            <label data-num="3">Tagline <span className="hint" style={{ display: 'inline', marginLeft: 4 }}>(optional)</span></label>
            <input
              className="input"
              placeholder="The fastest way to ship dashboards"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
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
                onChange={(e) => setCtaText(e.target.value)}
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
                onChange={(e) => setDestinationUrl(e.target.value)}
              />
              <div className="hint">Where the QR ultimately sends people (after we log the conversion).</div>
            </div>
          </div>

          <div className="field field-num">
            <label data-num="6">Poster style</label>
            <div className="row wrap" style={{ gap: 8 }}>
              {([
                { key: 'auto', label: 'Auto', hint: 'Pick for me' },
                { key: 'saas_glassmorphism', label: 'SaaS', hint: 'Sleek / glassmorphism' },
                { key: 'cozy_scrapbook', label: 'Cozy', hint: 'Warm / scrapbook' },
                { key: 'designer', label: 'Designer', hint: 'AI-designed bespoke layout' },
              ] as const).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`btn sm ${styleChoice === opt.key ? '' : 'ghost'}`}
                  onClick={() => setStyleChoice(opt.key)}
                  title={opt.hint}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="hint">
              {styleChoice === 'auto'
                ? 'We choose the template that fits your brand.'
                : styleChoice === 'saas_glassmorphism'
                  ? 'Premium split light/dark launch poster with a 3D device mockup.'
                  : styleChoice === 'designer'
                    ? 'An AI art director designs a bespoke layout for your brand, then paints it — not a fixed template.'
                    : 'Warm hand-drawn scrapbook poster with a mascot and stat ring.'}
            </div>
          </div>

          {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn" type="submit">
              Generate posters <span className="btn-icon">→</span>
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

function PickCard({
  title,
  subtitle,
  children,
  onPick,
  disabled,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
  onPick: () => void
  disabled?: boolean
}) {
  return (
    <div className="card" style={{ background: 'var(--panel-2)', padding: 16, display: 'grid', gap: 14, justifyItems: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <strong style={{ fontSize: '1.05rem' }}>{title}</strong>
        <div className="muted" style={{ fontSize: '0.82rem', marginTop: 2 }}>{subtitle}</div>
      </div>
      {children}
      <button className="btn" style={{ width: '100%' }} onClick={onPick} disabled={disabled}>
        Use this poster
      </button>
    </div>
  )
}
