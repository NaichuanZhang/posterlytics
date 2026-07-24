import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { BreakdownCard } from '../components/BreakdownCard'
import { StatsTable } from '../components/StatsTable'
import { InlineNotice, Skeleton } from '../components/ui/Feedback'
import { Spinner } from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { useCampaign } from '../hooks/useCampaign'
import { useCampaignBreakdowns } from '../hooks/useCampaignBreakdowns'
import { usePlacementStats } from '../hooks/usePlacementStats'
import { useI18n } from '../i18n/I18nProvider'
import { countryBreakdownsForDisplay } from '../lib/countryBreakdowns'
import { formatFreshnessTimestamp } from '../lib/i18n'
import { isCampaignTrackingActive } from '../lib/trackingPolicy'

export function AnalyticsPage() {
  const { formatNumber, locale, t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const { notify } = useToast()
  const { campaign, loading } = useCampaign(id)
  const trackingActive = campaign
    ? isCampaignTrackingActive(campaign)
    : false
  const {
    stats,
    loading: statsLoading,
    error: statsError,
    reload,
  } = usePlacementStats(id, trackingActive)
  const {
    breakdowns,
    loading: breakdownsLoading,
    error: breakdownsError,
    reload: reloadBreakdowns,
  } = useCampaignBreakdowns(id, trackingActive)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const analyticsLoading = statsLoading || breakdownsLoading
  const previousLoad = useRef({ campaignId: id, loading: true })

  // Intentionally dependency-less: observe every committed analytics load transition.
  useEffect(() => {
    if (id !== previousLoad.current.campaignId) {
      setLastUpdated(null)
      previousLoad.current = { campaignId: id, loading: analyticsLoading }
      return
    }

    if (
      previousLoad.current.loading
      && !analyticsLoading
      && trackingActive
      && !statsError
      && !breakdownsError
    ) {
      setLastUpdated(new Date())
    }
    previousLoad.current = { campaignId: id, loading: analyticsLoading }
  })

  async function refreshAll() {
    setRefreshing(true)
    await Promise.all([reload(), reloadBreakdowns()])
    setRefreshing(false)
    notify(t('Analytics refreshed.'), 'success')
  }

  if (loading) {
    return (
      <AppShell breadcrumbs={[
        { label: t('Campaigns'), to: '/' },
        { label: t('Analytics') },
      ]}>
        <Spinner full />
      </AppShell>
    )
  }
  if (!campaign) {
    return (
      <AppShell breadcrumbs={[
        { label: t('Campaigns'), to: '/' },
        { label: t('Not found') },
      ]}>
        <InlineNotice tone="error">{t('Campaign not found.')}</InlineNotice>
      </AppShell>
    )
  }
  if (!trackingActive) {
    return <Navigate to={`/campaigns/${campaign.id}`} replace />
  }

  const totals = stats.reduce(
    (accumulator, stat) => ({
      visits: accumulator.visits + stat.visits,
      unique: accumulator.unique + stat.unique_visitors,
    }),
    { visits: 0, unique: 0 },
  )
  const returnRate = totals.visits > 0
    ? Math.max(0, Math.round(((totals.visits - totals.unique) / totals.visits) * 100))
    : 0
  const countryBreakdown = countryBreakdownsForDisplay(
    breakdowns.countries,
    locale,
    t('Location unavailable'),
  )

  return (
    <AppShell
      breadcrumbs={[
        { label: t('Campaigns'), to: '/' },
        { label: campaign.product_name, to: `/campaigns/${campaign.id}` },
        { label: t('Analytics') },
      ]}
      campaign={campaign}
      activeSection="analytics"
      actions={(
        <button
          type="button"
          className="toolbar-button"
          disabled={refreshing || analyticsLoading}
          onClick={() => void refreshAll()}
        >
          <RefreshCw size={15} className={refreshing ? 'is-spinning' : ''} aria-hidden="true" />
          {t('Refresh')}
        </button>
      )}
    >
      <header className="page-heading page-heading-compact">
        <div>
          <h1>{t('Analytics')}</h1>
          <p>{t('Placement traffic and audience composition.')}</p>
        </div>
      </header>

      {(statsError || breakdownsError) && (
        <InlineNotice tone="error">
          <strong>{t('Some analytics could not be loaded.')}</strong>
          <span>{statsError || breakdownsError}</span>
        </InlineNotice>
      )}

      <div className="analytics-summary-meta">
        <h2>{t('All time')}</h2>
        <span className="analytics-freshness">
          {lastUpdated && (
            <time dateTime={lastUpdated.toISOString()}>
              {t('View updated: {date}', {
                date: formatFreshnessTimestamp(lastUpdated, locale),
              })}
            </time>
          )}
        </span>
      </div>

      {statsLoading ? (
        <div className="metric-strip" aria-label={t('Loading metrics')} aria-busy="true">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="metric" key={index}>
              <Skeleton className="skeleton-line skeleton-line-short" />
              <Skeleton className="metric-skeleton" />
            </div>
          ))}
        </div>
      ) : (
        <section className="metric-strip" aria-label={t('Campaign summary')}>
          <Metric label={t('Total visits')} value={formatNumber(totals.visits)} />
          <Metric label={t('Unique visitors')} value={formatNumber(totals.unique)} />
          <Metric label={t('Repeat visit share')} value={`${formatNumber(returnRate)}%`} />
        </section>
      )}
      {!breakdownsLoading && !breakdownsError && (
        <p className="analytics-filter-note">
          {t('Bots filtered: {count}', {
            count: formatNumber(breakdowns.bots_filtered),
          })}
        </p>
      )}

      <section className="analytics-table-section" aria-labelledby="placement-comparison-heading">
        <div className="section-heading">
          <div>
            <h2 id="placement-comparison-heading">{t('Placement comparison')}</h2>
            <p>{t('Traffic attributed to each minted link.')}</p>
          </div>
        </div>
        {statsLoading ? <TableSkeleton /> : <StatsTable stats={stats} />}
      </section>

      <section className="audience-section" aria-labelledby="audience-heading">
        <div className="section-heading">
          <div>
            <h2 id="audience-heading">{t('Audience breakdown')}</h2>
            <p>{t('Visits grouped by device, operating system, and available country data.')}</p>
          </div>
        </div>
        {breakdownsLoading ? (
          <div
            className="breakdown-grid"
            aria-label={t('Loading audience breakdowns')}
            aria-busy="true"
          >
            {Array.from({ length: 3 }, (_, index) => (
              <div className="breakdown-section" key={index}>
                <Skeleton className="skeleton-line skeleton-line-title" />
                <Skeleton className="breakdown-skeleton" />
                <Skeleton className="breakdown-skeleton" />
                <Skeleton className="breakdown-skeleton" />
              </div>
            ))}
          </div>
        ) : (
          <div className="breakdown-grid">
            <BreakdownCard title={t('Device')} buckets={breakdowns.devices} />
            <BreakdownCard title={t('Operating system')} buckets={breakdowns.os} />
            <BreakdownCard
              title={t('Country')}
              buckets={countryBreakdown.buckets}
              description={countryBreakdown.unavailableVisits > 0
                ? t('Location could not be determined for some visits.')
                : undefined}
            />
          </div>
        )}
      </section>
    </AppShell>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function TableSkeleton() {
  const { t } = useI18n()
  return (
    <div
      className="table-skeleton"
      aria-label={t('Loading placement comparison')}
      aria-busy="true"
    >
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index}>
          <Skeleton className="skeleton-line skeleton-line-title" />
          <Skeleton className="skeleton-line skeleton-line-short" />
          <Skeleton className="skeleton-line skeleton-line-short" />
        </div>
      ))}
    </div>
  )
}
