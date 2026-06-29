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

  // Delete the campaign and its data. Placements/scans/conversions cascade away
  // at the DB level (ON DELETE CASCADE), and the owner RLS policy enforces
  // ownership. Storage objects are NOT cascaded, so we best-effort remove the
  // campaign's assets first — one failed/missing key never blocks the rest or
  // the row delete (Promise.allSettled). Throws on the row-delete error so the
  // caller can surface it.
  const remove = useCallback(async () => {
    if (!campaign) return
    const assets = campaign.brand_assets
    const keys = [
      campaign.hero_image_key,
      campaign.screenshot_key,
      assets?.logo_key,
      ...(assets?.images ?? []).map((img) => img.key),
    ].filter((k): k is string => !!k)
    await Promise.allSettled(keys.map((key) => insforge.storage.from('assets').remove(key)))

    const { error } = await insforge.database.from('campaigns').delete().eq('id', campaign.id)
    if (error) throw new Error(error.message)
  }, [campaign])

  return { campaign, loading, error, reload, remove }
}
