import { Link, useParams } from 'react-router-dom'
import { useCampaign } from '../hooks/useCampaign'
import { usePlacementStats } from '../hooks/usePlacementStats'
import { Layout } from '../components/Layout'
import { Spinner } from '../components/ui/Spinner'
import { StatsTable } from '../components/StatsTable'

export function AnalyticsPage() {
  const { id } = useParams<{ id: string }>()
  const { campaign, loading } = useCampaign(id)
  const { stats, loading: statsLoading, reload } = usePlacementStats(id)

  if (loading) return <Layout><Spinner full /></Layout>
  if (!campaign) return <Layout><p className="muted">Campaign not found.</p></Layout>

  const totals = stats.reduce(
    (acc, s) => ({
      scans: acc.scans + s.scans,
      unique: acc.unique + s.unique_visitors,
      conversions: acc.conversions + s.conversions,
    }),
    { scans: 0, unique: 0, conversions: 0 },
  )

  return (
    <Layout>
      <div className="row between" style={{ marginBottom: 4 }}>
        <h1 className="page-title">Analytics — {campaign.product_name}</h1>
        <button className="btn secondary sm" onClick={reload}>↻ Refresh</button>
      </div>
      <p className="page-sub">
        <Link to={`/campaigns/${campaign.id}`}>← Back to poster</Link> · Which placement actually drove conversions.
      </p>

      <div className="grid cols-2" style={{ marginBottom: 22 }}>
        <Stat label="Total scans" value={totals.scans} />
        <Stat label="Unique visitors" value={totals.unique} />
        <Stat label="Conversions" value={totals.conversions} />
        <Stat
          label="Overall conv. rate"
          value={totals.unique ? `${Math.round((totals.conversions / totals.unique) * 100)}%` : '—'}
        />
      </div>

      <div className="card">
        {statsLoading ? <Spinner /> : <StatsTable stats={stats} />}
      </div>
    </Layout>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card">
      <div className="muted" style={{ fontSize: '0.82rem' }}>{label}</div>
      <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  )
}
