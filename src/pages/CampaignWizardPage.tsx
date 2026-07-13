import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { insforge } from '../lib/insforge'
import { useAuth } from '../auth/AuthProvider'
import { Layout } from '../components/Layout'
import { GenerationProgress, type AgentStep, type AgentPrompt } from '../components/GenerationProgress'
import type { CampaignScenario, PosterLayout } from '../lib/types'
import { SCENARIO_ORDER, getScenario } from '../scenarios/registry'

type Phase = 'form' | 'creating' | 'analyzing' | 'generating' | 'error'

const PHASE_LABEL: Record<Phase, string> = {
  form: '',
  creating: 'Creating campaign…',
  analyzing: 'Reading your site — extracting brand, content & design…',
  generating: 'Generating your poster…',
  error: '',
}

// The fixed copy for each pipeline step. `designer` only runs for the designer
// style; it's filtered out of the seed otherwise.
const STEP_DEFS: Array<{ key: AgentStep['key']; label: string; blurb: string }> = [
  { key: 'analyze', label: 'Analyze', blurb: 'Reading your site — brand, palette, copy' },
  { key: 'designer', label: 'Designer', blurb: 'Designing a bespoke poster layout' },
  { key: 'hero', label: 'Poster', blurb: 'Painting the AI poster image' },
]

export function CampaignWizardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('form')
  const [error, setError] = useState<string | null>(null)
  // Live "behind the scenes" state for the generation loading screen.
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [steps, setSteps] = useState<AgentStep[]>([])
  // The bespoke layout (designer style only) — shown as a wireframe preview the
  // moment the Designer step finishes, while hero paints the image.
  const [layout, setLayout] = useState<PosterLayout | null>(null)

  // Immutable patch of one step by key (status / prompt updates as agents run).
  function patchStep(key: AgentStep['key'], patch: Partial<AgentStep>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }

  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err))

  // Which scenario we're creating. 'product' is the original flow; 'event' scrapes
  // a Luma event page. The scenario registry drives labels/placeholders/hints.
  const [scenario, setScenario] = useState<CampaignScenario>('product')
  const scenarioCfg = getScenario(scenario)
  const isEvent = scenario === 'event'

  const [productUrl, setProductUrl] = useState('')
  const [productName, setProductName] = useState('')
  const [tagline, setTagline] = useState('')
  const [ctaText, setCtaText] = useState('Get started')
  const [destinationUrl, setDestinationUrl] = useState('')

  // Event pre-fill: when the Luma URL blurs (event mode), hit the anon
  // `event-preview` function to parse the page and pre-fill "Event name" +
  // surface the detected logistics for confirmation — closing the gap where the
  // event fields are marked source:'scrape' but nothing populated them until the
  // later analyze run. Best-effort: any failure degrades silently to manual entry.
  const [eventPreview, setEventPreview] = useState<{
    date_line: string; time_line: string; location_line: string; host_line: string
  } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  // Monotonic request id — a slower response for an older request must not clobber
  // a newer one (blur A, blur B; A resolves last).
  const previewReqRef = useRef(0)
  // Always mirrors the URL field's CURRENT value, so a resolved response can check
  // the field hasn't changed under it (user edited without re-blurring).
  const latestUrlRef = useRef('')
  // The last URL we got a DEFINITIVE answer for — skip re-fetching it. Only set on
  // a real response (found or not), never on a transient failure, so failures stay
  // retryable on a later blur.
  const prefilledUrlRef = useRef('')

  async function previewEvent() {
    if (!isEvent) return
    const url = productUrl.trim()
    if (!url || url === prefilledUrlRef.current) return
    const reqId = ++previewReqRef.current
    setPreviewing(true)
    try {
      const { data, error: pErr } = await insforge.functions.invoke('event-preview', { body: { url } })
      if (pErr) throw new Error(pErr.message ?? 'preview failed')
      // Drop the result if a newer request started OR the URL field has since
      // changed (stale response must not clobber a now-different form).
      if (reqId !== previewReqRef.current || url !== latestUrlRef.current.trim()) return
      const d = data as {
        found?: boolean; event_name?: string
        date_line?: string; time_line?: string; location_line?: string; host_line?: string
      } | null
      // A definitive answer arrived for this URL — lock it against re-fetch.
      prefilledUrlRef.current = url
      if (d?.found) {
        // Fill the name only if it's still empty AT APPLY TIME (functional update
        // reads the current value — never clobber a name typed while in flight).
        if (d.event_name) setProductName((prev) => (prev.trim() ? prev : d.event_name!))
        setEventPreview({
          date_line: d.date_line ?? '',
          time_line: d.time_line ?? '',
          location_line: d.location_line ?? '',
          host_line: d.host_line ?? '',
        })
      } else {
        setEventPreview(null)
      }
    } catch {
      // Silent fallback to manual entry — the URL may be blocked, private, or
      // unparseable. Expected best-effort failure: don't log, and leave the URL
      // unlocked so a later blur can retry it. Only clear the preview if this is
      // still the latest request AND the field hasn't changed under us (a stale
      // failure must not wipe a newer URL's state).
      if (reqId === previewReqRef.current && url === latestUrlRef.current.trim()) setEventPreview(null)
    } finally {
      // Only the latest request owns the spinner.
      if (reqId === previewReqRef.current) setPreviewing(false)
    }
  }

  // Helper: the label/placeholder/hint for a field key in the active scenario.
  const fieldCfg = (key: string) => scenarioCfg.fields.find((f) => f.key === key)
  // 'auto' lets the analyzer pick; otherwise force the template. 'designer' adds
  // an agentic layout-design step (the `designer` function) before the image.
  const [styleChoice, setStyleChoice] =
    useState<'auto' | 'saas_glassmorphism' | 'cozy_scrapbook' | 'designer'>('auto')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setError(null)

    // 1. Create the campaign row. For events the QR sends people to the Luma event
    // page, so destination_url defaults to the event URL when left blank.
    setPhase('creating')
    const url = productUrl.trim()
    const dest = destinationUrl.trim() || (isEvent ? url : '')
    const { data: created, error: createErr } = await insforge.database
      .from('campaigns')
      .insert([
        {
          user_id: user.id,
          scenario,
          product_url: url,
          product_name: productName.trim(),
          tagline: tagline.trim() || null,
          cta_text: ctaText.trim() || (isEvent ? 'Scan to RSVP' : 'Learn more'),
          destination_url: dest,
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
    // Events use a bespoke event prompt in hero (not the product layout agent), so
    // the Designer step never runs for them.
    const isDesigner = !isEvent && styleChoice === 'designer'
    setScreenshotUrl(null)
    setLayout(null)
    setSteps(
      STEP_DEFS.filter((d) => d.key !== 'designer' || isDesigner).map((d) => ({
        ...d,
        status: 'pending' as const,
      })),
    )

    // The pipeline runs SEQUENTIALLY so the loading screen can reveal each agent's
    // real prompt the moment it returns: analyze → [designer] → hero.
    // Each step is best-effort — an error marks that row and the flow continues.

    // 2. Analyze: scrape + brand palette + auto-selected style + poster spec.
    setPhase('analyzing')
    patchStep('analyze', { status: 'running' })
    try {
      const { data, error: aErr } = await insforge.functions.invoke('analyze', {
        body: { campaignId, scenario, posterStyle: styleChoice === 'auto' ? undefined : styleChoice },
      })
      if (aErr) throw new Error(aErr.message ?? 'Analysis failed')
      const d = data as { screenshot_url?: string | null; prompt?: AgentPrompt } | null
      if (d?.screenshot_url) setScreenshotUrl(d.screenshot_url)
      patchStep('analyze', { status: 'done', prompt: d?.prompt })
    } catch (err) {
      console.error(err)
      patchStep('analyze', { status: 'error', error: errMsg(err) })
    }

    // 3. Generate the poster. For the designer style the layout agent runs BEFORE
    // hero (hero paints from the layout).
    setPhase('generating')

    if (isDesigner) {
      patchStep('designer', { status: 'running' })
      try {
        const { data, error: dErr } = await insforge.functions.invoke('designer', { body: { campaignId } })
        if (dErr) throw new Error(dErr.message ?? 'Layout design failed')
        const dd = data as { prompt?: AgentPrompt; poster_layout?: PosterLayout } | null
        if (dd?.poster_layout) setLayout(dd.poster_layout)
        patchStep('designer', { status: 'done', prompt: dd?.prompt })
      } catch (err) {
        console.error(err)
        patchStep('designer', { status: 'error', error: errMsg(err) })
      }
    }

    patchStep('hero', { status: 'running' })
    try {
      const { data, error: hErr } = await insforge.functions.invoke('hero', { body: { campaignId } })
      patchStep('hero', {
        status: hErr ? 'error' : 'done',
        error: hErr ? (hErr.message ?? 'Poster generation failed') : undefined,
        prompt: (data as { prompt?: AgentPrompt } | null)?.prompt,
      })
    } catch (err) {
      console.error(err)
      patchStep('hero', { status: 'error', error: errMsg(err) })
    }

    // 4. Done — go straight to the editor, which loads the finished campaign.
    navigate(`/campaigns/${campaignId}`)
  }

  const working = phase === 'creating' || phase === 'analyzing' || phase === 'generating'

  return (
    <Layout>
      <div className="hero-card">
        <span className="eyebrow">Paste a link, get an on-brand poster</span>
        <h1>{isEvent ? 'Tell us about your event' : 'Tell us about your product'}</h1>
        <p>
          {isEvent
            ? 'Paste your Luma event link — we read the date, time, location, and host, then generate an on-brand promo poster with a tracked QR for every placement.'
            : 'We scrape your site for brand style, imagery, and copy — then generate an on-brand poster with a tracked QR for every placement.'}
        </p>
      </div>

      {working && steps.length > 0 ? (
        <GenerationProgress headline={PHASE_LABEL[phase]} screenshotUrl={screenshotUrl} steps={steps} layout={layout} />
      ) : working ? (
        <div className="card center" style={{ padding: 56 }}>
          <div className="spinner" style={{ margin: '0 auto 20px' }} />
          <p style={{ fontSize: '1.05rem', fontWeight: 600 }}>{PHASE_LABEL[phase]}</p>
          <p className="muted" style={{ marginTop: 6 }}>This takes ~10–25 seconds.</p>
        </div>
      ) : (
        <form className="card" onSubmit={handleSubmit}>
          <div className="field">
            <label>What are you promoting?</label>
            <div className="row wrap" style={{ gap: 8 }}>
              {SCENARIO_ORDER.map((id) => {
                const cfg = getScenario(id)
                return (
                  <button
                    key={id}
                    type="button"
                    className={`btn sm ${scenario === id ? '' : 'ghost'}`}
                    onClick={() => setScenario(id)}
                    title={cfg.hint}
                  >
                    {cfg.label}
                  </button>
                )
              })}
            </div>
            <div className="hint">{scenarioCfg.hint}</div>
          </div>
          <div className="field field-num">
            <label data-num="1">{fieldCfg('product_url')?.label ?? 'Product website URL'} <span className="req">required</span></label>
            <input
              className="input"
              type="url"
              required
              placeholder={fieldCfg('product_url')?.placeholder ?? 'https://yourproduct.com'}
              value={productUrl}
              onChange={(e) => { latestUrlRef.current = e.target.value; setProductUrl(e.target.value) }}
              onBlur={isEvent ? previewEvent : undefined}
            />
            <div className="hint">
              {previewing
                ? 'Reading the Luma page…'
                : fieldCfg('product_url')?.hint ?? 'We scrape this for your brand style, logo, imagery, and product story.'}
            </div>
          </div>
          <div className="field field-num">
            <label data-num="2">{fieldCfg('product_name')?.label ?? 'Product name'} <span className="req">required</span></label>
            <input
              className="input"
              required
              placeholder={fieldCfg('product_name')?.placeholder ?? 'Acme Analytics'}
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
            />
            {isEvent && <div className="hint">{fieldCfg('product_name')?.hint ?? ''}</div>}
          </div>

          {/* Detected event logistics — shown after the Luma page is parsed so the
              user can confirm what the poster will render (all authoritative from
              the scrape; edit the manual fallbacks if anything's off). */}
          {isEvent && eventPreview && (eventPreview.date_line || eventPreview.location_line || eventPreview.host_line) && (
            <div className="card" style={{ padding: 14, marginBottom: 16, background: 'var(--surface, #faf8f5)' }}>
              <p className="muted" style={{ fontSize: '0.8rem', fontWeight: 600, margin: '0 0 8px' }}>
                Detected from the Luma page
              </p>
              <dl style={{ margin: 0, display: 'grid', gap: 6, fontSize: '0.9rem' }}>
                {eventPreview.date_line && (
                  <div className="row between" style={{ gap: 12 }}>
                    <dt className="muted" style={{ flex: '0 0 72px' }}>Date</dt>
                    <dd style={{ margin: 0, textAlign: 'right', flex: 1 }}>
                      {[eventPreview.date_line, eventPreview.time_line].filter(Boolean).join(' · ')}
                    </dd>
                  </div>
                )}
                {eventPreview.location_line && (
                  <div className="row between" style={{ gap: 12 }}>
                    <dt className="muted" style={{ flex: '0 0 72px' }}>Location</dt>
                    <dd style={{ margin: 0, textAlign: 'right', flex: 1 }}>{eventPreview.location_line}</dd>
                  </div>
                )}
                {eventPreview.host_line && (
                  <div className="row between" style={{ gap: 12 }}>
                    <dt className="muted" style={{ flex: '0 0 72px' }}>Host</dt>
                    <dd style={{ margin: 0, textAlign: 'right', flex: 1 }}>{eventPreview.host_line}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
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
                placeholder={isEvent ? 'Scan to RSVP' : 'Start free trial'}
                value={ctaText}
                onChange={(e) => setCtaText(e.target.value)}
              />
            </div>
            <div className="field field-num" style={{ flex: '2 1 280px' }}>
              <label data-num="5">
                Destination URL {isEvent ? <span className="hint" style={{ display: 'inline', marginLeft: 4 }}>(optional)</span> : <span className="req">required</span>}
              </label>
              <input
                className="input"
                type="url"
                required={!isEvent}
                placeholder={isEvent ? 'Defaults to your Luma event link' : 'https://yourproduct.com/signup'}
                value={destinationUrl}
                onChange={(e) => setDestinationUrl(e.target.value)}
              />
              <div className="hint">
                {isEvent
                  ? 'Where the QR sends people to RSVP (after we log the scan). Defaults to your Luma event link.'
                  : 'Where the QR ultimately sends people (after we log the conversion).'}
              </div>
            </div>
          </div>

          {/* Product poster style — events use a bespoke event prompt, so this is
              product-only. */}
          {!isEvent && (
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
                ? 'We choose the style that fits your brand.'
                : styleChoice === 'saas_glassmorphism'
                  ? 'Premium split light/dark launch poster with a 3D device mockup.'
                  : styleChoice === 'designer'
                    ? 'An AI art director designs a bespoke layout for your brand, then paints it — not a fixed template.'
                    : 'Warm hand-drawn scrapbook poster with a mascot and stat ring.'}
            </div>
          </div>
          )}

          {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn" type="submit">
              {isEvent ? 'Generate event poster' : 'Generate posters'} <span className="btn-icon">→</span>
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
