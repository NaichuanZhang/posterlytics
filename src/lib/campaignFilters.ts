import type { Campaign, CampaignStatus } from './types'

export type CampaignStatusFilter = CampaignStatus | 'all'

type FilterableCampaign = Pick<Campaign, 'product_name' | 'product_url' | 'status'>

export function filterCampaigns<T extends FilterableCampaign>(
  campaigns: readonly T[],
  query: string,
  status: CampaignStatusFilter,
): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()

  return campaigns.filter((campaign) => {
    if (status !== 'all' && campaign.status !== status) return false
    if (!normalizedQuery) return true

    return [campaign.product_name, campaign.product_url, campaign.status]
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  })
}
