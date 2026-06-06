import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { insforge } from '../lib/insforge'
import type { Campaign } from '../lib/types'
import { Layout } from '../components/Layout'
import { Spinner } from '../components/ui/Spinner'
import { useReveal } from '../hooks/useReveal'

export function CampaignsListPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const revealRef = useReveal<HTMLDivElement>([campaigns.length])

  useEffect(() => {
    insforge.database
      .from('campaigns')
      .select('id, product_name, product_url, status, created_at, brand_assets, hero_image_url')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setCampaigns((data ?? []) as Campaign[])
        setLoading(false)
      })
  }, [])

  return (
    <Layout>
      <div className="hero-card" style={{ textAlign: 'left' }}>
        <div className="row between wrap" style={{ gap: 16 }}>
          <div>
            <span className="eyebrow">Your campaigns</span>
            <h1 style={{ margin: '12px 0 6px' }}>Which placement actually converts?</h1>
            <p style={{ margin: 0 }}>Every campaign makes an on-brand poster and mints a tracked QR per placement.</p>
          </div>
          <Link to="/campaigns/new" className="btn">
            New campaign <span className="btn-icon">→</span>
          </Link>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : campaigns.length === 0 ? (
        <div className="card center" style={{ padding: 56 }}>
          <p style={{ fontSize: '1.15rem', marginBottom: 8, letterSpacing: '-0.01em' }}>No campaigns yet</p>
          <p className="muted" style={{ marginBottom: 24, maxWidth: '42ch', marginInline: 'auto' }}>
            Paste a product URL and we'll generate an on-brand ad poster plus tracked QR links.
          </p>
          <Link to="/campaigns/new" className="btn">
            Create your first campaign <span className="btn-icon">→</span>
          </Link>
        </div>
      ) : (
        <div className="grid cols-2" ref={revealRef}>
          {campaigns.map((c) => {
            const thumb = c.brand_assets?.primary_image_url || c.hero_image_url || ''
            return (
              <Link
                key={c.id}
                to={`/campaigns/${c.id}`}
                className="card reveal"
                style={{ textDecoration: 'none', color: 'inherit', display: 'flex', gap: 14 }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 10,
                    flex: '0 0 64px',
                    background: thumb ? `center/cover no-repeat url(${thumb})` : 'var(--panel-2)',
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div className="row between">
                    <strong style={{ fontSize: '1.05rem' }}>{c.product_name}</strong>
                  </div>
                  <div className="muted" style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.product_url}
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <span className={`badge ${c.status}`}>{c.status}</span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </Layout>
  )
}
