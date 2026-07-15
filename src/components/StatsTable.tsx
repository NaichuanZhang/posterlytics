import type { PlacementStat } from '../lib/types'

// Per-placement visit analytics. The highest-traffic placement is highlighted.
export function StatsTable({ stats }: { stats: PlacementStat[] }) {
  if (stats.length === 0) {
    return <p className="muted">No placements yet. Add placements and publish to start tracking.</p>
  }

  const winnerId = [...stats].sort((a, b) => b.visits - a.visits)[0]?.placement_id
  const anyVisits = stats.some((stat) => stat.visits > 0)

  return (
    <table className="stats">
      <thead>
        <tr>
          <th>Placement</th>
          <th className="num">Visits</th>
          <th className="num">Unique</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((s) => (
          <tr key={s.placement_id} className={anyVisits && s.placement_id === winnerId ? 'winner' : ''}>
            <td>
              {s.label}
              {anyVisits && s.placement_id === winnerId && (
                <span className="badge published" style={{ marginLeft: 8 }}>
                  Top
                </span>
              )}
            </td>
            <td className="num">{s.visits}</td>
            <td className="num">{s.unique_visitors}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
