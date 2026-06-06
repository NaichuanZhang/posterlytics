import type { PlacementStat } from '../lib/types'

// Per-placement analytics: scans, unique visitors, conversions, conversion rate.
// The winning placement (most conversions, then rate) is highlighted — this is
// the "which placement actually drove conversions" answer.
export function StatsTable({ stats }: { stats: PlacementStat[] }) {
  if (stats.length === 0) {
    return <p className="muted">No placements yet. Add placements and publish to start tracking.</p>
  }

  const winnerId = [...stats].sort(
    (a, b) => b.conversions - a.conversions || (b.conversion_rate ?? 0) - (a.conversion_rate ?? 0),
  )[0]?.placement_id
  const anyConversions = stats.some((s) => s.conversions > 0)

  return (
    <table className="stats">
      <thead>
        <tr>
          <th>Placement</th>
          <th className="num">Scans</th>
          <th className="num">Unique</th>
          <th className="num">Conversions</th>
          <th className="num">Conv. rate</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((s) => (
          <tr key={s.placement_id} className={anyConversions && s.placement_id === winnerId ? 'winner' : ''}>
            <td>
              {s.label}
              {anyConversions && s.placement_id === winnerId && (
                <span className="badge published" style={{ marginLeft: 8 }}>
                  Top
                </span>
              )}
            </td>
            <td className="num">{s.scans}</td>
            <td className="num">{s.unique_visitors}</td>
            <td className="num">{s.conversions}</td>
            <td className="num">{s.conversion_rate != null ? `${s.conversion_rate}%` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
