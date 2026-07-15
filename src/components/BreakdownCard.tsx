import type { BreakdownBucket } from '../lib/types'

// A single audience-breakdown dimension (Device / OS / Country) as a horizontal
// bar list. Each bucket shows its visit count + share of the total. Reuses the
// existing card/muted tokens so it matches the Stat cards in AnalyticsPage.
export function BreakdownCard({ title, buckets }: { title: string; buckets: BreakdownBucket[] }) {
  const total = buckets.reduce((sum, b) => sum + b.visits, 0)
  return (
    <div className="card">
      <div
        className="muted"
        style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}
      >
        {title}
      </div>
      {buckets.length === 0 ? (
        <p className="muted" style={{ fontSize: '0.88rem', margin: 0 }}>No data yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {buckets.map((b) => {
            const pct = total ? Math.round((b.visits / total) * 100) : 0
            return (
              <div key={b.key}>
                <div className="row between" style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: '0.9rem' }}>{b.key}</span>
                  <span
                    style={{
                      fontSize: '0.85rem',
                      fontFamily: "'Geist Mono', ui-monospace, monospace",
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {b.visits} · {pct}%
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: 'var(--hairline)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
