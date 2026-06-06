import { useState } from 'react'
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
  const { placements } = usePlacements(id, user?.id)
  const [busy, setBusy] = useState<string | null>(null)
  const [agent, setAgent] = useState<AgentResult | null>(null)
  const [agentError, setAgentError] = useState<string | null>(null)

  if (loading) return <Layout><Spinner full /></Layout>
  if (!campaign) return <Layout><p className="muted">Campaign not found.</p></Layout>

  // Preview QR uses the first placement, or a placeholder code.
  const previewCode = placements[0]?.code ?? 'PREVIEW01'

  async function regenerate() {
    if (!campaign) return
    setBusy('regen')
    try {
      const { error } = await insforge.functions.invoke('analyze', { body: { campaignId: campaign.id } })
      if (!error) {
        const fresh = await insforge.database
          .from('campaigns')
          .select('brand_assets')
          .eq('id', campaign.id)
          .maybeSingle()
        const needsHero = !((fresh.data as { brand_assets?: { images?: unknown[] } })?.brand_assets?.images?.length)
        if (needsHero) await insforge.functions.invoke('hero', { body: { campaignId: campaign.id } }).catch(() => {})
      }
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

  const published = campaign.status === 'published'

  return (
    <Layout>
      <div className="row between" style={{ marginBottom: 4 }}>
        <h1 className="page-title">{campaign.product_name}</h1>
        <span className={`badge ${campaign.status}`}>{campaign.status}</span>
      </div>
      <p className="page-sub">
        <Link to="/">← All campaigns</Link>
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 560px) 1fr', gap: 28, alignItems: 'start' }}>
        {/* Poster preview */}
        <div className="card" style={{ display: 'grid', placeItems: 'center', background: 'var(--panel-2)' }}>
          <div style={{ transform: 'scale(0.92)', transformOrigin: 'top center' }}>
            <Poster campaign={campaign} code={previewCode} />
          </div>
        </div>

        {/* Controls */}
        <div className="grid" style={{ gap: 16 }}>
          <div className="card">
            <h3 style={{ margin: '0 0 10px' }}>Poster copy</h3>
            <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 12px' }}>
              Generated from your site. Regenerate for a fresh take.
            </p>
            <dl style={{ margin: 0, display: 'grid', gap: 8, fontSize: '0.9rem' }}>
              <Row label="Hook" value={campaign.poster_copy?.hook} />
              <Row label="One-liner" value={campaign.poster_copy?.what_it_does} />
              <Row label="Features" value={(campaign.poster_copy?.features ?? []).join(' · ')} />
              <Row label="Tone" value={campaign.style_profile?.tone} />
            </dl>
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
