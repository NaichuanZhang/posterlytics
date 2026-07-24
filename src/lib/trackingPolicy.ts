import type { Campaign } from './types'
import { getUseCase } from './useCases'

export function isCampaignTrackingActive(
  campaign: Pick<Campaign, 'use_case' | 'destination_url'>,
): boolean {
  return (
    getUseCase(campaign.use_case).trackingEnabled
    && typeof campaign.destination_url === 'string'
    && campaign.destination_url.trim().length > 0
  )
}
