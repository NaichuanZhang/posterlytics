import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { insforge } from '../lib/insforge'
import type { Campaign } from '../lib/types'
import { Layout } from '../components/Layout'
import { Spinner } from '../components/ui/Spinner'

export function CampaignsListPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)

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
      <div className="row between" style={{ marginBottom: 4 }}>
        <h1 className="page-title">Campaigns</h1>
        <Link to="/campaigns/new" className="btn">
          + New campaign
        </Link>
      </div>
      <p className="page-sub">Each campaign makes an on-brand poster and tracks which placement converts.</p>

      {loading ? (
        <Spinner />
      ) : campaigns.length === 0 ? (
        <div className="card center" style={{ padding: 48 }}>
          <p style={{ fontSize: '1.1rem', marginBottom: 6 }}>No campaigns yet</p>
          <p className="muted" style={{ marginBottom: 20 }}>
            Paste a product URL and we'll generate an on-brand ad poster + tracked QR links.
          </p>
          <Link to="/campaigns/new" className="btn">
            Create your first campaign
          </Link>
        </div>
      ) : (
        <div className="grid cols-2">
          {campaigns.map((c) => {
            const thumb = c.brand_assets?.primary_image_url || c.hero_image_url || ''
            return (
              <Link
                key={c.id}
                to={`/campaigns/${c.id}`}
                className="card"
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
