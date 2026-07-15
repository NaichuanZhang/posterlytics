import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useCampaign } from '../hooks/useCampaign'
import { usePlacements } from '../hooks/usePlacements'
import { useAuth } from '../auth/AuthProvider'
import { Layout } from '../components/Layout'
import { Spinner } from '../components/ui/Spinner'
import { QrCode } from '../components/QrCode'
import { PosterExportButton } from '../components/PosterExportButton'
import { buildViewUrl } from '../lib/viewUrl'

export function PlacementsPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { campaign, loading } = useCampaign(id)
  const { placements, addPlacement, removePlacement } = usePlacements(id, user?.id)
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    setBusy(true)
    setError(null)
    const err = await addPlacement(label.trim())
    if (err) setError(err)
    else setLabel('')
    setBusy(false)
  }

  function copyLink(code: string) {
    navigator.clipboard?.writeText(buildViewUrl(code))
    setCopied(code)
    setTimeout(() => setCopied(null), 1500)
  }

  if (loading) return <Layout><Spinner full /></Layout>
  if (!campaign) return <Layout><p className="muted">Campaign not found.</p></Layout>

  return (
    <Layout>
      <h1 className="page-title">Placements — {campaign.product_name}</h1>
      <p className="page-sub">
        <Link to={`/campaigns/${campaign.id}`}>← Back to poster</Link> · Each placement mints a unique QR + link so
        you can compare visits across channels.
      </p>

      {campaign.status !== 'published' && (
        <div className="card" style={{ borderColor: 'var(--accent)', marginBottom: 18 }}>
          <strong style={{ color: 'var(--accent)' }}>Not published yet.</strong>{' '}
          <span className="muted">Scans/links won't track until you publish on the poster page.</span>
        </div>
      )}

      <form className="card" onSubmit={handleAdd} style={{ marginBottom: 22 }}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label>New placement</label>
            <input
              className="input"
              placeholder="e.g. Bulletin board, LinkedIn, IG story"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <button className="btn" disabled={busy || !label.trim()}>
            {busy ? 'Adding…' : '+ Add'}
          </button>
        </div>
        {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
      </form>

      {placements.length === 0 ? (
        <p className="muted">No placements yet. Add one above for each channel you'll promote on.</p>
      ) : (
        <div className="grid cols-2">
          {placements.map((p) => (
            <div key={p.id} className="card">
              <div className="row between" style={{ marginBottom: 12 }}>
                <strong style={{ fontSize: '1.05rem' }}>{p.label}</strong>
                <button className="btn ghost sm" onClick={() => removePlacement(p.id)} title="Delete">
                  ✕
                </button>
              </div>
              <div className="row" style={{ gap: 16, alignItems: 'center' }}>
                <div style={{ background: '#fff', padding: 8, borderRadius: 10 }}>
                  <QrCode value={buildViewUrl(p.code)} size={104} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="muted" style={{ fontSize: '0.78rem' }}>Tracked link</div>
                  <code style={{ fontSize: '0.78rem', wordBreak: 'break-all', display: 'block', margin: '2px 0 12px' }}>
                    {buildViewUrl(p.code)}
                  </code>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <button className="btn secondary sm" onClick={() => copyLink(p.code)}>
                      {copied === p.code ? 'Copied!' : 'Copy link'}
                    </button>
                    <PosterExportButton campaign={campaign} placement={p} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  )
}
