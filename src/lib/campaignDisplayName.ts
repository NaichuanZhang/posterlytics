import type { Campaign } from './types'

/**
 * The human label for a campaign whose title may be absent.
 *
 * Uses `||`, not `??`: a legacy row can hold `''` as well as NULL, and both mean
 * untitled. This mirrors the existing fallback in the creation wizard.
 *
 * Deliberately NOT used for poster transcripts or alt text — the placeholder is
 * not text the artwork contains.
 */
export function displayNameOrUntitled(
  name: string | null | undefined,
  untitled: string,
): string {
  return name?.trim() || untitled
}

/**
 * Narrow `Pick` on purpose: several callers pass a projection rather than a whole
 * campaign row.
 */
export function campaignDisplayName(
  campaign: Pick<Campaign, 'product_name'>,
  untitled: string,
): string {
  return displayNameOrUntitled(campaign.product_name, untitled)
}
