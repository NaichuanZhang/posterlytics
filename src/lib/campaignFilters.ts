import type { Campaign, CampaignStatus } from './types'

export type CampaignStatusFilter = CampaignStatus | 'generating' | 'all'

type FilterableCampaign = Pick<Campaign, 'product_name' | 'product_url' | 'status'> & {
  is_generating?: boolean
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
    if (status !== 'all' && status !== 'generating' && campaign.status !== status) return false
    if (!normalizedQuery) return true

    // Locale-free on purpose: routing the untitled placeholder through here would
    // make search results depend on the active language.
    return [
      campaign.product_name ?? '',
      campaign.product_url ?? '',
      campaign.id ?? '',
      campaign.status,
      campaign.is_generating ? 'generating' : '',
    ]
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  })
}
