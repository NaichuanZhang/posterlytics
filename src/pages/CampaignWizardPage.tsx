import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { insforge } from '../lib/insforge'
import { useAuth } from '../auth/AuthProvider'
import { Layout } from '../components/Layout'

type Phase = 'form' | 'creating' | 'analyzing' | 'hero' | 'done' | 'error'

const PHASE_LABEL: Record<Phase, string> = {
  form: '',
  creating: 'Creating campaign…',
  analyzing: 'Reading your site — extracting brand, assets & product story…',
  hero: 'Painting an on-brand hero image…',
  done: 'Done!',
  error: '',
}

export function CampaignWizardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('form')
  const [error, setError] = useState<string | null>(null)

  const [productUrl, setProductUrl] = useState('')
  const [productName, setProductName] = useState('')
  const [tagline, setTagline] = useState('')
  const [ctaText, setCtaText] = useState('Get started')
  const [destinationUrl, setDestinationUrl] = useState('')

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

    // 2. Analyze: scrape + real assets + substance + style.
    setPhase('analyzing')
    try {
      const { data: analysis, error: aErr } = await insforge.functions.invoke('analyze', {
        body: { campaignId },
      })
      if (aErr) throw new Error(aErr.message ?? 'Analysis failed')

      // 3. Hero fallback only if no real product imagery was found.
      const needsHero = (analysis as { needs_hero?: boolean })?.needs_hero
      if (needsHero) {
        setPhase('hero')
        // Hero failure is non-fatal — the poster falls back to a gradient.
        await insforge.functions.invoke('hero', { body: { campaignId } }).catch(() => {})
      }
    } catch (err) {
      // Generation hiccup is recoverable in the editor; proceed anyway.
      console.error(err)
    }

    setPhase('done')
    navigate(`/campaigns/${campaignId}`)
  }

  const working = phase !== 'form' && phase !== 'error'

  return (
    <Layout>
      <h1 className="page-title">New campaign</h1>
      <p className="page-sub">Tell us about your product. We'll scrape your site and generate an on-brand poster.</p>

      {working ? (
        <div className="card center" style={{ padding: 48 }}>
          <div className="spinner" style={{ margin: '0 auto 18px' }} />
          <p style={{ fontSize: '1.05rem' }}>{PHASE_LABEL[phase]}</p>
          <p className="muted" style={{ marginTop: 6 }}>This takes ~10–25 seconds.</p>
        </div>
      ) : (
        <form className="card" onSubmit={handleSubmit} style={{ maxWidth: 620 }}>
          <div className="field">
            <label>Product website URL *</label>
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
          <div className="field">
            <label>Product name *</label>
            <input
              className="input"
              required
              placeholder="Acme Analytics"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Tagline (optional)</label>
            <input
              className="input"
              placeholder="The fastest way to ship dashboards"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
            />
          </div>
          <div className="row" style={{ gap: 16 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Call to action *</label>
              <input
                className="input"
                required
                placeholder="Start free trial"
                value={ctaText}
                onChange={(e) => setCtaText(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: 2 }}>
              <label>Destination URL *</label>
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

          {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

          <div className="row">
            <button className="btn" type="submit">
              Generate poster →
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
