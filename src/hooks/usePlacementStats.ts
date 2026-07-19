import { useCallback, useEffect, useState } from 'react'
import { insforge } from '../lib/insforge'
import type { PlacementStat } from '../lib/types'

export function usePlacementStats(
  campaignId: string | undefined,
  enabled = true,
) {
  const [stats, setStats] = useState<PlacementStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!campaignId || !enabled) {
      setStats([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    const { data, error } = await insforge.database.rpc('placement_stats', {
      p_campaign_id: campaignId,
    })
    if (error) {
      setError(error.message)
    } else {
      // `scans` is accepted during the staged rollout; the final RPC returns
      // `visits` only.
      const normalized = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        placement_id: String(row.placement_id ?? ''),
        label: String(row.label ?? ''),
        code: String(row.code ?? ''),
        visits: Number(row.visits ?? row.scans ?? 0),
        unique_visitors: Number(row.unique_visitors ?? 0),
      }))
      setStats(normalized as PlacementStat[])
      setError(null)
    }
    setLoading(false)
  }, [campaignId, enabled])

  useEffect(() => {
    void reload()
  }, [reload])

  return { stats, loading, error, reload }
}
