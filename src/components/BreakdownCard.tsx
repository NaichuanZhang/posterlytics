import type { BreakdownBucket } from '../lib/types'
import { useI18n } from '../i18n/I18nProvider'

export function BreakdownCard({ title, buckets }: { title: string; buckets: BreakdownBucket[] }) {
  const { formatNumber, t } = useI18n()
  const total = buckets.reduce((sum, bucket) => sum + bucket.visits, 0)

  return (
    <section className="breakdown-section">
      <h3>{title}</h3>
      {buckets.length === 0 ? (
        <p className="panel-empty">{t('No data yet.')}</p>
      ) : (
        <div className="breakdown-list">
          {buckets.map((bucket) => {
            const percentage = total ? Math.round((bucket.visits / total) * 100) : 0
            return (
              <div key={bucket.key} className="breakdown-row">
                <div>
                  <span>{bucket.key}</span>
                  <strong>{formatNumber(bucket.visits)} / {formatNumber(percentage)}%</strong>
                </div>
                <span className="breakdown-track" aria-hidden="true">
                  <span style={{ width: `${percentage}%` }} />
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
