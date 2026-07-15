import { useCallback, useEffect, useState } from 'react'
import { insforge } from '../lib/insforge'
import type { Campaign } from '../lib/types'

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

  // Database children cascade. Storage objects do not, so remove known keys
  // best-effort before deleting the owner-scoped campaign row.
  const remove = useCallback(async () => {
    if (!campaign) return
    const assets = campaign.brand_assets
    const keys = [
      campaign.hero_image_key,
      campaign.screenshot_key,
      assets?.logo_key,
      ...(assets?.images ?? []).map((img) => img.key),
      ...(campaign.reference_images ?? []).map((image) => image.key),
    ].filter((k): k is string => !!k)
    await Promise.allSettled(keys.map((key) => insforge.storage.from('assets').remove(key)))

    const { error } = await insforge.database.from('campaigns').delete().eq('id', campaign.id)
    if (error) throw new Error(error.message)
  }, [campaign])

  return { campaign, loading, error, reload, remove }
}
