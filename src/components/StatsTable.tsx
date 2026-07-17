import type { PlacementStat } from '../lib/types'

// Per-placement visit analytics. The highest-traffic placement is highlighted.
export function StatsTable({ stats }: { stats: PlacementStat[] }) {
  if (stats.length === 0) {
    return <p className="panel-empty">No placement traffic yet.</p>
  }

  const winnerId = [...stats].sort((a, b) => b.visits - a.visits)[0]?.placement_id
  const anyVisits = stats.some((stat) => stat.visits > 0)

  return (
    <div className="table-scroll">
      <table className="stats">
        <thead>
          <tr>
            <th>Placement</th>
            <th className="num">Visits</th>
            <th className="num">Unique</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((stat) => (
            <tr key={stat.placement_id} className={anyVisits && stat.placement_id === winnerId ? 'winner' : ''}>
              <td>
                {stat.label}
                {anyVisits && stat.placement_id === winnerId && (
                  <span className="table-leader">Top</span>
                )}
              </td>
              <td className="num">{stat.visits}</td>
              <td className="num">{stat.unique_visitors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
