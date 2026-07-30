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

  /**
   * Resolves to whether this load actually succeeded. Mirrors
   * useCampaignBreakdowns: the error is still captured into state to drive the
   * degraded display, and the boolean exists only so a caller can distinguish a
   * real success from a swallowed failure.
   */
  const reload = useCallback(async (): Promise<boolean> => {
    if (!campaignId || !enabled) {
      setStats([])
      setLoading(false)
      setError(null)
      // Nothing was requested, so there is nothing to report as refreshed.
      return false
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
    return !error
  }, [campaignId, enabled])

  useEffect(() => {
    void reload()
  }, [reload])

  return { stats, loading, error, reload }
}
