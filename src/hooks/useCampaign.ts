import { useCallback, useEffect, useState } from 'react'
import { insforge } from '../lib/insforge'
import { collectCampaignAssetKeys } from '../lib/generations'
import type { Campaign, PosterGeneration } from '../lib/types'

export function useCampaign(id: string | undefined) {
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const { data, error } = await insforge.database
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) setError(error.message)
    else setCampaign(data as Campaign | null)
    setLoading(false)
  }, [id])

  useEffect(() => {
    void reload()
  }, [reload])

  // Database children cascade. Storage objects do not, so collect every
  // generation's keys before deleting the campaign and clean them up afterward.
  const remove = useCallback(async () => {
    if (!campaign) return

    const { data: generationData, error: generationError } = await insforge.database
      .from('poster_generations')
      .select('hero_image_key, screenshot_key, brand_assets, event_details, reference_images')
      .eq('campaign_id', campaign.id)
    if (generationError) throw new Error(generationError.message)

    const generations = (generationData ?? []) as Array<Pick<
      PosterGeneration,
      'hero_image_key' | 'screenshot_key' | 'brand_assets' | 'event_details' | 'reference_images'
    >>
    const keys = collectCampaignAssetKeys(campaign, generations)

    const { error } = await insforge.database.from('campaigns').delete().eq('id', campaign.id)
    if (error) throw new Error(error.message)

    await Promise.allSettled(keys.map((key) => insforge.storage.from('assets').remove(key)))
  }, [campaign])

  return { campaign, loading, error, reload, remove }
}
