import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { insforge } from '../lib/insforge'
import { useCampaign } from '../hooks/useCampaign'
import { usePlacements } from '../hooks/usePlacements'
import { useAuth } from '../auth/AuthProvider'
import { Layout } from '../components/Layout'
import { Spinner } from '../components/ui/Spinner'
import { Poster } from '../components/Poster'
import type { AgentResult } from '../lib/types'

export function PosterEditorPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { campaign, loading, reload } = useCampaign(id)
  const { placements, ensureDefault } = usePlacements(id, user?.id)
  const [busy, setBusy] = useState<string | null>(null)
  const [agent, setAgent] = useState<AgentResult | null>(null)
  const [agentError, setAgentError] = useState<string | null>(null)

  // A campaign should always have at least one placement so the poster's QR
  // encodes a real, trackable code (not a dead preview). Create one if missing.
  useEffect(() => {
    if (user?.id) void ensureDefault()
  }, [user?.id, ensureDefault])

  if (loading) return <Layout><Spinner full /></Layout>
  if (!campaign) return <Layout><p className="muted">Campaign not found.</p></Layout>

  // Preview QR uses the first real placement (ensureDefault guarantees one soon).
  const previewCode = placements[0]?.code ?? null
  const published = campaign.status === 'published'

  // Spec card rows depend on the auto-selected template shape.
  const isSaas = campaign.poster_style === 'saas_glassmorphism'
  const spec = campaign.poster_spec as Record<string, unknown> | null
  const specRows: Array<{ label: string; value?: string }> = isSaas
    ? [
        { label: 'Headline', value: spec?.headline as string },
        { label: 'Slogan', value: spec?.slogan as string },
        { label: 'CTA', value: spec?.cta_main as string },
      ]
    : [
        { label: 'Hook', value: [spec?.hook_line1, spec?.hook_line2].filter(Boolean).join(' ') },
        { label: 'Subtitle', value: spec?.subtitle as string },
        { label: 'Mascot', value: spec?.mascot as string },
      ]

  async function regenerate() {
    if (!campaign) return
    setBusy('regen')
    try {
      // Re-extract the spec; the template re-renders from it client-side. If the
      // active mode is the AI image, also re-paint the image.
      await insforge.functions.invoke('analyze', { body: { campaignId: campaign.id } })
      if (campaign.poster_mode === 'image') {
        await insforge.functions.invoke('hero', { body: { campaignId: campaign.id } })
      }
      await reload()
    } finally {
      setBusy(null)
    }
  }

  // Switch render mode. Going to 'image' with no AI image yet generates one first.
  async function switchMode(mode: 'template' | 'image') {
    if (!campaign || campaign.poster_mode === mode) return
    setBusy('mode')
    try {
      if (mode === 'image' && !campaign.hero_image_url) {
        await insforge.functions.invoke('hero', { body: { campaignId: campaign.id } })
      }
      await insforge.database.from('campaigns').update({ poster_mode: mode }).eq('id', campaign.id)
      await reload()
    } finally {
      setBusy(null)
    }
  }

  async function setStatus(status: 'published' | 'draft') {
    if (!campaign) return
    setBusy(status)
    await insforge.database.from('campaigns').update({ status }).eq('id', campaign.id)
    await reload()
    setBusy(null)
  }

  // Run the tool-calling Campaign Optimizer agent (reads stats + copy, proposes new copy).
  async function optimize() {
    if (!campaign) return
    setBusy('optimize')
    setAgentError(null)
    setAgent(null)
    try {
      const { data, error } = await insforge.functions.invoke('agent', { body: { campaignId: campaign.id } })
      if (error) setAgentError(error.message ?? 'Agent failed')
      else setAgent(data as AgentResult)
    } catch (e) {
      setAgentError(e instanceof Error ? e.message : 'Agent failed')
    } finally {
      setBusy(null)
    }
  }

  // Apply the agent's proposed copy to the campaign.
  async function applyProposal() {
    if (!campaign || !agent?.proposal) return
    setBusy('apply')
    await insforge.database
      .from('campaigns')
      .update({
        poster_copy: agent.proposal.poster_copy,
        landing_content: agent.proposal.landing_content,
      })
      .eq('id', campaign.id)
    setAgent(null)
    await reload()
    setBusy(null)
  }

  return (
    <Layout>
      <div className="row between" style={{ marginBottom: 4 }}>
        <h1 className="page-title">{campaign.product_name}</h1>
        <span className={`badge ${campaign.status}`}>{campaign.status}</span>
      </div>
      <p className="page-sub">
        <Link to="/">← All campaigns</Link>
      </p>

      {!published && (
        <div className="card" style={{ borderColor: 'var(--accent)', marginBottom: 18 }}>
          <div className="row between" style={{ gap: 12, alignItems: 'center' }}>
            <span>
              <strong style={{ color: 'var(--accent)' }}>Draft — not live.</strong>{' '}
              <span className="muted">
                The QR works once you publish; scanning it now shows a "not live yet" page.
              </span>
            </span>
            <button className="btn sm" onClick={() => setStatus('published')} disabled={!!busy}>
              {busy === 'published' ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 480px) 1fr', gap: 28, alignItems: 'start' }}>
        {/* Poster preview */}
        <div className="card" style={{ display: 'grid', placeItems: 'center', background: 'var(--panel-2)', padding: 16 }}>
          {previewCode ? (
            <Poster campaign={campaign} code={previewCode} />
          ) : (
            <p className="muted" style={{ padding: 24, textAlign: 'center' }}>Preparing your placement…</p>
          )}
        </div>

        {/* Controls */}
        <div className="grid" style={{ gap: 16 }}>
          <div className="card">
            <h3 style={{ margin: '0 0 10px' }}>Poster spec</h3>
            <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 12px' }}>
              Style auto-picked from your site. Regenerate for a fresh take.
            </p>
            <dl style={{ margin: 0, display: 'grid', gap: 8, fontSize: '0.9rem' }}>
              <Row
                label="Style"
                value={isSaas ? 'SaaS Glassmorphism' : 'Cozy Scrapbook'}
              />
              {specRows.map((r) => (
                <Row key={r.label} label={r.label} value={r.value} />
              ))}
              <Row label="Tone" value={campaign.style_profile?.tone} />
            </dl>

            {/* Render-mode toggle: deterministic template vs AI illustration. */}
            <div className="row" style={{ marginTop: 14, gap: 0, border: '1px solid var(--border, rgba(0,0,0,0.12))', borderRadius: 10, overflow: 'hidden', width: 'fit-content' }}>
              <button
                className={`btn sm ${campaign.poster_mode !== 'image' ? '' : 'ghost'}`}
                style={{ borderRadius: 0 }}
                onClick={() => switchMode('template')}
                disabled={!!busy || campaign.poster_mode !== 'image'}
              >
                Template
              </button>
              <button
                className={`btn sm ${campaign.poster_mode === 'image' ? '' : 'ghost'}`}
                style={{ borderRadius: 0 }}
                onClick={() => switchMode('image')}
                disabled={!!busy || campaign.poster_mode === 'image'}
              >
                {busy === 'mode' ? 'Switching…' : 'AI image'}
              </button>
            </div>
            {campaign.poster_mode === 'image' && !campaign.hero_image_url && (
              <p className="hint" style={{ marginTop: 6 }}>AI image not generated yet — Regenerate to paint it.</p>
            )}
            <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
              <button className="btn secondary sm" onClick={regenerate} disabled={!!busy}>
                {busy === 'regen' ? 'Regenerating…' : '↻ Regenerate'}
              </button>
              <button className="btn sm" onClick={optimize} disabled={!!busy}>
                {busy === 'optimize' ? 'Optimizing…' : '✦ Optimize with AI'}
              </button>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              The optimizer reads your live per-placement stats and proposes better copy.
            </p>
          </div>

          {(agent || agentError) && (
            <div className="card" style={{ borderColor: 'var(--primary)' }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>✦ AI proposal</h3>
                <button className="btn ghost sm" onClick={() => { setAgent(null); setAgentError(null) }}>
                  Dismiss
                </button>
              </div>
              {agentError ? (
                <p className="error-text">{agentError}</p>
              ) : agent ? (
                <>
                  {agent.summary && (
                    <p style={{ fontSize: '0.9rem', margin: '0 0 10px' }}>{agent.summary}</p>
                  )}
                  {agent.proposal ? (
                    <>
                      <p className="muted" style={{ fontSize: '0.82rem', margin: '0 0 10px', fontStyle: 'italic' }}>
                        {agent.proposal.rationale}
                      </p>
                      <dl style={{ margin: 0, display: 'grid', gap: 8, fontSize: '0.9rem' }}>
                        <Row label="Hook" value={agent.proposal.poster_copy.hook} />
                        <Row label="One-liner" value={agent.proposal.poster_copy.what_it_does} />
                        <Row label="Features" value={agent.proposal.poster_copy.features.join(' · ')} />
                        <Row label="CTA" value={agent.proposal.poster_copy.cta} />
                      </dl>
                      <button className="btn sm" style={{ marginTop: 14 }} onClick={applyProposal} disabled={!!busy}>
                        {busy === 'apply' ? 'Applying…' : 'Apply proposal'}
                      </button>
                    </>
                  ) : (
                    <p className="muted" style={{ fontSize: '0.85rem' }}>
                      The agent didn't return a structured proposal. Try again.
                    </p>
                  )}
                  <p className="hint" style={{ marginTop: 10 }}>
                    Tools used: {agent.toolCalls.length ? agent.toolCalls.join(', ') : '—'} · {agent.steps} steps
                  </p>
                </>
              ) : null}
            </div>
          )}

          <div className="card">
            <h3 style={{ margin: '0 0 8px' }}>Placements & tracking</h3>
            <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 12px' }}>
              {placements.length} placement{placements.length === 1 ? '' : 's'}. Each gets a unique QR + link.
            </p>
            <div className="row wrap">
              <Link to={`/campaigns/${campaign.id}/placements`} className="btn secondary sm">
                Manage placements
              </Link>
              <Link to={`/campaigns/${campaign.id}/analytics`} className="btn secondary sm">
                View analytics
              </Link>
            </div>
          </div>

          <div className="card">
            <h3 style={{ margin: '0 0 8px' }}>{published ? 'Live' : 'Publish'}</h3>
            <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 12px' }}>
              {published
                ? 'Your landing page is live. QR scans are being tracked.'
                : 'Publish to activate the hosted landing page and start tracking scans.'}
            </p>
            {published ? (
              <button className="btn danger sm" onClick={() => setStatus('draft')} disabled={!!busy}>
                {busy === 'draft' ? 'Unpublishing…' : 'Unpublish'}
              </button>
            ) : (
              <button className="btn" onClick={() => setStatus('published')} disabled={!!busy}>
                {busy === 'published' ? 'Publishing…' : 'Publish campaign'}
              </button>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
      <dt className="muted" style={{ flex: '0 0 84px' }}>{label}</dt>
      <dd style={{ margin: 0, textAlign: 'right', flex: 1 }}>{value || '—'}</dd>
    </div>
  )
}
