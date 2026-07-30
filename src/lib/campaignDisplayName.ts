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

/**
 * The single normalizer for every writer of `campaigns.product_name`.
 *
 * NULL, never `''` — see 2026-07-28-optional-campaign-title. The wizard and the
 * editor's rename both go through this so a title cleared on one surface cannot
 * persist differently from one cleared on the other.
 */
export function normalizeCampaignTitleWrite(name: string): string | null {
  return name.trim() || null
}

/**
 * Whether a rename would actually change the stored value.
 *
 * Compares the NORMALIZED forms, so trimming whitespace off an otherwise
 * unchanged title is correctly treated as a no-op, and a legacy `''` row counts
 * as equal to NULL rather than inviting a pointless write.
 */
export function campaignTitleWriteChanged(
  current: string | null | undefined,
  next: string,
): boolean {
  return normalizeCampaignTitleWrite(next) !== (current?.trim() || null)
}
