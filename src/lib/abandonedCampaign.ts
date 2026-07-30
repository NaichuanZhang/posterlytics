import { insforge } from './insforge'

/**
 * Deletes a campaign row created by the wizard that the user then discarded.
 *
 * The wizard persists the campaign BEFORE it uploads references and enqueues
 * generation, so a failure after that insert leaves a real row behind. The
 * submit path already rolls back the reference uploads it made, and discarding
 * the local draft used to drop `serverCampaignId` — the only remaining pointer
 * to that row — leaving an indistinguishable 'Draft' the user never chose to
 * keep. This is the cleanup named as a follow-up in
 * docs/decisions/2026-07-22-local-draft-autosave.md.
 *
 * Deliberately best-effort and non-throwing: it runs from a discard action whose
 * job is to clear local state, and that must still succeed if the network is
 * down. A surviving row is the pre-existing behaviour, not a regression, so it
 * is logged rather than surfaced.
 *
 * Storage objects do not cascade, so the campaign's own capture key is removed
 * before the row. Only keys reachable from the campaign row are considered: a
 * discarded draft has no generations, because the wizard clears the draft on a
 * successful enqueue and nothing else can create one for an unstarted campaign.
 */
export async function deleteAbandonedCampaign(campaignId: string): Promise<void> {
  try {
    const { data, error: readError } = await insforge.database
      .from('campaigns')
      .select('screenshot_key')
      .eq('id', campaignId)
      .maybeSingle()
    if (readError) throw new Error(readError.message)

    // Already gone (or not ours): nothing to clean up.
    if (!data) return

    const { error } = await insforge.database
      .from('campaigns')
      .delete()
      .eq('id', campaignId)
    if (error) throw new Error(error.message)

    const screenshotKey = (data as { screenshot_key: string | null }).screenshot_key
    if (screenshotKey) {
      await insforge.storage.from('assets').remove(screenshotKey)
    }
  } catch (cause) {
    console.warn('Abandoned campaign row was not cleaned up', {
      campaignId,
      error: cause instanceof Error ? cause.message : String(cause),
    })
  }
}
