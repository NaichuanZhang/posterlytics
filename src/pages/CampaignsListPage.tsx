import { GalleryVerticalEnd, Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useGenerationActivity } from '../activity/GenerationActivityProvider'
import { EmptyState, InlineNotice, Skeleton } from '../components/ui/Feedback'
import { insforge } from '../lib/insforge'
import {
  filterCampaigns,
  type CampaignStatusFilter,
} from '../lib/campaignFilters'
import type { Campaign } from '../lib/types'
import type { GenerationActivityItem } from '../lib/types'
import { activityForCampaign, generationActivityLabel } from '../lib/generationActivity'
import { useI18n } from '../i18n/I18nProvider'
import { derivePosterTranscript } from '../lib/posterTranscript'
import { getUseCase, isReferenceOnlyUseCaseId } from '../lib/useCases'

export function CampaignsListPage() {
  const { t } = useI18n()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<CampaignStatusFilter>('all')
  const { items: generationActivity } = useGenerationActivity()

  const loadCampaigns = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: queryError } = await insforge.database
        .from('campaigns')
        .select('id, product_name, product_url, tagline, scenario, use_case, poster_format, poster_copy, poster_content, poster_spec, poster_layout, status, created_at, brand_assets, hero_image_url')
        .order('created_at', { ascending: false })

      if (queryError) {
        setError(queryError.message)
      } else {
        setCampaigns((data ?? []) as Campaign[])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('The campaign query failed.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCampaigns()
  }, [loadCampaigns])

  const campaignRows = useMemo(() => campaigns.map((campaign) => {
    const activity = activityForCampaign(generationActivity, campaign.id)
    return {
      campaign,
      activity,
      product_name: campaign.product_name,
      product_url: campaign.product_url,
      status: campaign.status,
      is_generating: !!activity,
    }
  }), [campaigns, generationActivity])

  const filteredCampaigns = useMemo(
    () => filterCampaigns(campaignRows, query, status),
    [campaignRows, query, status],
  )
  const statusFilters: Array<{ value: CampaignStatusFilter; label: string }> = [
    { value: 'all', label: t('All') },
    { value: 'draft', label: t('Draft') },
    { value: 'generating', label: t('Generating') },
    { value: 'published', label: t('Published') },
  ]

  return (
    <AppShell
      breadcrumbs={[{ label: t('Campaigns') }]}
      actions={(
        <Link to="/campaigns/new" className="toolbar-button toolbar-button-primary">
          <Plus size={15} aria-hidden="true" />
          {t('New campaign')}
        </Link>
      )}
    >
      <header className="page-heading">
        <div>
          <h1>{t('Campaigns')}</h1>
          <p>{t('Poster files and placement performance in one workspace.')}</p>
        </div>
        {!loading && !error && (
          <span className="page-count">{t('{count} total', { count: campaigns.length })}</span>
        )}
      </header>

      <div className="browser-controls">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">{t('Search campaigns')}</span>
          <input
            type="search"
            placeholder={t('Search campaigns')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="segmented-control" aria-label={t('Filter by status')}>
          {statusFilters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={status === filter.value ? 'is-active' : ''}
              aria-pressed={status === filter.value}
              onClick={() => setStatus(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <InlineNotice tone="error">
          <strong>{t('Campaigns could not be loaded.')}</strong>
          <span>{error}</span>
          <button type="button" className="text-button" onClick={() => void loadCampaigns()}>
            {t('Try again')}
          </button>
        </InlineNotice>
      ) : loading ? (
        <CampaignSkeletons />
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={<GalleryVerticalEnd size={24} />}
          title={t('No campaigns yet')}
          description={t('Create a campaign to generate its first poster and tracked placement.')}
          action={(
            <Link to="/campaigns/new" className="button button-primary">
              <Plus size={16} aria-hidden="true" />
              {t('Create campaign')}
            </Link>
          )}
        />
      ) : filteredCampaigns.length === 0 ? (
        <EmptyState
          icon={<Search size={23} />}
          title={t('No matching campaigns')}
          description={t('Change the search or status filter to see more files.')}
          action={(
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setQuery('')
                setStatus('all')
              }}
            >
              {t('Clear filters')}
            </button>
          )}
        />
      ) : (
        <section className="campaign-browser" aria-label={t('Campaign files')}>
          {filteredCampaigns.map(({ campaign, activity }) => (
            <CampaignFile key={campaign.id} campaign={campaign} activity={activity} />
          ))}
        </section>
      )}
    </AppShell>
  )
}

function CampaignFile({
  campaign,
  activity,
}: {
  campaign: Campaign
  activity: GenerationActivityItem | null
}) {
  const { formatDate, locale, t } = useI18n()
  const heroThumbnail = campaign.hero_image_url || ''
  const thumbnail = heroThumbnail
    || campaign.brand_assets?.primary_image_url
    || campaign.brand_assets?.images?.[0]?.url
    || ''
  const thumbnailAlt = heroThumbnail
    ? derivePosterTranscript(campaign, {
        locale,
        includeCompositedFooter: false,
      }).shortAlt
    : ''
  const trackingEnabled = getUseCase(campaign.use_case).trackingEnabled

  return (
    <Link to={`/campaigns/${campaign.id}`} className="campaign-file">
      <div className="campaign-thumbnail">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={thumbnailAlt}
          />
        ) : (
          <span className="campaign-placeholder" aria-hidden="true">
            <GalleryVerticalEnd size={26} />
          </span>
        )}
        {(activity || trackingEnabled) && (
          <span className={`status-badge status-${activity ? 'generating' : campaign.status}`}>
            {activity
              ? generationActivityLabel(activity, locale)
              : campaign.status === 'published'
                ? t('Published')
                : t('Draft')}
          </span>
        )}
      </div>
      <div className="campaign-file-copy">
        <strong>{campaign.product_name}</strong>
        <span>
          {isReferenceOnlyUseCaseId(campaign.use_case)
            ? t(getUseCase(campaign.use_case).label)
            : safeHostname(campaign.product_url)}
        </span>
        {activity && (
          <span className="campaign-generation-state">
            {generationActivityLabel(activity, locale)}
          </span>
        )}
        <time dateTime={campaign.created_at}>
          {formatDate(campaign.created_at, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </time>
      </div>
    </Link>
  )
}

function CampaignSkeletons() {
  const { t } = useI18n()
  return (
    <section className="campaign-browser" aria-label={t('Loading campaigns')} aria-busy="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="campaign-file campaign-file-skeleton" key={index}>
          <Skeleton className="campaign-thumbnail" />
          <div className="campaign-file-copy">
            <Skeleton className="skeleton-line skeleton-line-title" />
            <Skeleton className="skeleton-line" />
            <Skeleton className="skeleton-line skeleton-line-short" />
          </div>
        </div>
      ))}
    </section>
  )
}

function safeHostname(value: string | null) {
  if (!value) return ''
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}
