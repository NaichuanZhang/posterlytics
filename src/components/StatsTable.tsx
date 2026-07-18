import type { PlacementStat } from '../lib/types'
import { useI18n } from '../i18n/I18nProvider'

// Per-placement visit analytics. The highest-traffic placement is highlighted.
export function StatsTable({ stats }: { stats: PlacementStat[] }) {
  const { formatNumber, t } = useI18n()
  if (stats.length === 0) {
    return <p className="panel-empty">{t('No placement traffic yet.')}</p>
  }

  const winnerId = [...stats].sort((a, b) => b.visits - a.visits)[0]?.placement_id
  const anyVisits = stats.some((stat) => stat.visits > 0)

  return (
    <div className="table-scroll">
      <table className="stats">
        <thead>
          <tr>
            <th>{t('Placement')}</th>
            <th className="num">{t('Visits')}</th>
            <th className="num">{t('Unique')}</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((stat) => (
            <tr key={stat.placement_id} className={anyVisits && stat.placement_id === winnerId ? 'winner' : ''}>
              <td>
                {stat.label}
                {anyVisits && stat.placement_id === winnerId && (
                  <span className="table-leader">{t('Top')}</span>
                )}
              </td>
              <td className="num">{formatNumber(stat.visits)}</td>
              <td className="num">{formatNumber(stat.unique_visitors)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
