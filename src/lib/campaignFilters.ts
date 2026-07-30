import type { Campaign, CampaignStatus } from './types'

export type CampaignStatusFilter =
  | CampaignStatus
  | 'generating'
  | 'awaiting_poster'
  | 'all'

type FilterableCampaign = Pick<Campaign, 'product_name' | 'product_url' | 'status'> & {
  is_generating?: boolean
  /**
   * Derived, not a column: no finished poster and nothing in flight. Optional
   * for the same reason as `is_generating` — callers compute it per render.
   */
  is_awaiting_poster?: boolean
  // Keeps an untitled campaign findable when the name contributes nothing.
  id?: string
}

export function filterCampaigns<T extends FilterableCampaign>(
  campaigns: readonly T[],
  query: string,
  status: CampaignStatusFilter,
): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()

  return campaigns.filter((campaign) => {
    if (status === 'generating' && !campaign.is_generating) return false
    if (status === 'awaiting_poster' && !campaign.is_awaiting_poster) return false
    if (
      status !== 'all'
      && status !== 'generating'
      && status !== 'awaiting_poster'
      && campaign.status !== status
    ) return false
    if (!normalizedQuery) return true

    // Locale-free on purpose: routing the untitled placeholder through here would
    // make search results depend on the active language.
    return [
      campaign.product_name ?? '',
      campaign.product_url ?? '',
      campaign.id ?? '',
      campaign.status,
      campaign.is_generating ? 'generating' : '',
      campaign.is_awaiting_poster ? 'awaiting poster' : '',
    ]
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  })
}
