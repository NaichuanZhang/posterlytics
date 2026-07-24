import { useCallback, useEffect, useState } from 'react'
import { insforge } from '../lib/insforge'
import type { CampaignBreakdowns } from '../lib/types'

const EMPTY: CampaignBreakdowns = {
  visits: 0,
  unique_visitors: 0,
  devices: [],
  os: [],
  countries: [],
  bots_filtered: 0,
}

// Campaign-wide totals and audience breakdowns (device / OS / country). The
// campaign_breakdowns RPC returns a single JSONB object — not a row set — so we
// use `data` directly with an EMPTY fallback.
export function useCampaignBreakdowns(
  campaignId: string | undefined,
  enabled = true,
) {
  const [breakdowns, setBreakdowns] = useState<CampaignBreakdowns>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!campaignId || !enabled) {
      setBreakdowns(EMPTY)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    const { data, error } = await insforge.database.rpc('campaign_breakdowns', {
      p_campaign_id: campaignId,
    })
    if (error) {
      setError(error.message)
    } else {
      const raw = (data ?? {}) as Record<string, unknown>
      const normalize = (value: unknown) =>
        (Array.isArray(value) ? value : []).map((bucket: Record<string, unknown>) => ({
          key: String(bucket.key ?? 'Unknown'),
          visits: Number(bucket.visits ?? bucket.scans ?? 0),
        }))
      setBreakdowns({
        visits: Number(raw.visits ?? 0),
        unique_visitors: Number(raw.unique_visitors ?? 0),
        devices: normalize(raw.devices),
        os: normalize(raw.os),
        countries: normalize(raw.countries),
        bots_filtered: Number(raw.bots_filtered ?? 0),
      })
      setError(null)
    }
    setLoading(false)
  }, [campaignId, enabled])

  useEffect(() => {
    void reload()
  }, [reload])

  return { breakdowns, loading, error, reload }
}
