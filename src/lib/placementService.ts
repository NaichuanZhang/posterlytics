import { mintCode } from './codes'
import { insforge } from './insforge'

export async function ensureDefaultCampaignPlacement({
  campaignId,
  userId,
  label,
}: {
  campaignId: string
  userId: string
  label: string
}): Promise<string | null> {
  try {
    const { data, error: lookupError } = await insforge.database
      .from('placements')
      .select('id')
      .eq('campaign_id', campaignId)
      .limit(1)
    if (lookupError) return lookupError.message
    if (data && data.length > 0) return null

    let collisionError: string | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      const { error } = await insforge.database
        .from('placements')
        .insert([{ campaign_id: campaignId, user_id: userId, label, code: mintCode() }])
      if (!error) return null
      if (!/duplicate|unique|23505/i.test(error.message)) return error.message
      collisionError = error.message
    }
    return collisionError
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  }
}
