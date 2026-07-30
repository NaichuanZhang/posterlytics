import type { Campaign } from './types'

/**
 * Whether a campaign has ever finished producing a poster.
 *
 * `current_generation_id` is written only by `complete_poster_generation`
 * (db/schema.sql), so it is NULL both for a campaign that never started a
 * generation AND for one whose first generation is still running. Callers must
 * therefore combine this with the live activity signal to tell those apart,
 * which is why the "in flight" input is explicit rather than inferred here.
 */
export function hasCompletedPoster(
  campaign: Pick<Campaign, 'current_generation_id'>,
): boolean {
  return !!campaign.current_generation_id
}

/**
 * True when a campaign has no poster and nothing is being generated for it.
 *
 * This is the state a failed creation leaves behind: the wizard persists the
 * campaign before it enqueues, so an enqueue failure yields a real row that
 * never produced artwork. It was previously indistinguishable from a draft the
 * user created deliberately, which is the display half of Order-139.
 *
 * Deliberately derived rather than stored. `is_generating` in the campaign list
 * is already computed per render from live activity, so no column, migration, or
 * new `status` value is needed — and nothing can drift out of sync with the row.
 */
export function isCampaignAwaitingFirstPoster({
  campaign,
  isGenerating,
}: {
  campaign: Pick<Campaign, 'current_generation_id'>
  isGenerating: boolean
}): boolean {
  return !isGenerating && !hasCompletedPoster(campaign)
}
