import { useCallback, useEffect, useState } from 'react'
import { insforge } from '../lib/insforge'
import type { PlacementStat } from '../lib/types'

export function usePlacementStats(campaignId: string | undefined) {
  const [stats, setStats] = useState<PlacementStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!campaignId) return
    setLoading(true)
    const { data, error } = await insforge.database.rpc('placement_stats', {
      p_campaign_id: campaignId,
    })
    if (error) setError(error.message)
    else setStats((data ?? []) as PlacementStat[])
    setLoading(false)
  }, [campaignId])

  useEffect(() => {
    void reload()
  }, [reload])

  return { stats, loading, error, reload }
}
