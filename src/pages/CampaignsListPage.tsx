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

const STATUS_FILTERS: Array<{ value: CampaignStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'generating', label: 'Generating' },
  { value: 'published', label: 'Published' },
]

export function CampaignsListPage() {
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
        .select('id, product_name, product_url, status, created_at, brand_assets, hero_image_url')
        .order('created_at', { ascending: false })

      if (queryError) {
        setError(queryError.message)
      } else {
        setCampaigns((data ?? []) as Campaign[])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The campaign query failed.')
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

  return (
    <AppShell
      breadcrumbs={[{ label: 'Campaigns' }]}
      actions={(
        <Link to="/campaigns/new" className="toolbar-button toolbar-button-primary">
          <Plus size={15} aria-hidden="true" />
          New campaign
        </Link>
      )}
    >
      <header className="page-heading">
        <div>
          <h1>Campaigns</h1>
          <p>Poster files and placement performance in one workspace.</p>
        </div>
        {!loading && !error && <span className="page-count">{campaigns.length} total</span>}
      </header>

      <div className="browser-controls">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search campaigns</span>
          <input
            type="search"
            placeholder="Search campaigns"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="segmented-control" aria-label="Filter by status">
          {STATUS_FILTERS.map((filter) => (
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
          <strong>Campaigns could not be loaded.</strong>
          <span>{error}</span>
          <button type="button" className="text-button" onClick={() => void loadCampaigns()}>
            Try again
          </button>
        </InlineNotice>
      ) : loading ? (
        <CampaignSkeletons />
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={<GalleryVerticalEnd size={24} />}
          title="No campaigns yet"
          description="Create a campaign to generate its first poster and tracked placement."
          action={(
            <Link to="/campaigns/new" className="button button-primary">
              <Plus size={16} aria-hidden="true" />
              Create campaign
            </Link>
          )}
        />
      ) : filteredCampaigns.length === 0 ? (
        <EmptyState
          icon={<Search size={23} />}
          title="No matching campaigns"
          description="Change the search or status filter to see more files."
          action={(
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setQuery('')
                setStatus('all')
              }}
            >
              Clear filters
            </button>
          )}
        />
      ) : (
        <section className="campaign-browser" aria-label="Campaign files">
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
  const thumbnail = campaign.hero_image_url
    || campaign.brand_assets?.primary_image_url
    || campaign.brand_assets?.images?.[0]?.url
    || ''

  return (
    <Link to={`/campaigns/${campaign.id}`} className="campaign-file">
      <div className="campaign-thumbnail">
        {thumbnail ? (
          <img src={thumbnail} alt={`${campaign.product_name} poster`} />
        ) : (
          <span className="campaign-placeholder" aria-hidden="true">
            <GalleryVerticalEnd size={26} />
          </span>
        )}
        <span className={`status-badge status-${activity ? 'generating' : campaign.status}`}>
          {activity ? generationActivityLabel(activity) : campaign.status}
        </span>
      </div>
      <div className="campaign-file-copy">
        <strong>{campaign.product_name}</strong>
        <span>{safeHostname(campaign.product_url)}</span>
        {activity && <span className="campaign-generation-state">{generationActivityLabel(activity)}</span>}
        <time dateTime={campaign.created_at}>{formatDate(campaign.created_at)}</time>
      </div>
    </Link>
  )
}

function CampaignSkeletons() {
  return (
    <section className="campaign-browser" aria-label="Loading campaigns" aria-busy="true">
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

function safeHostname(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}
