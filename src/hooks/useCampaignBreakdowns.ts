import { useCallback, useEffect, useState } from 'react'
import { insforge } from '../lib/insforge'
import type { CampaignBreakdowns } from '../lib/types'

const EMPTY: CampaignBreakdowns = { devices: [], os: [], countries: [] }

// Campaign-wide audience breakdowns (device / OS / country). The
// campaign_breakdowns RPC returns a single JSONB object — not a row set — so we
// use `data` directly with an EMPTY fallback.
export function useCampaignBreakdowns(campaignId: string | undefined) {
  const [breakdowns, setBreakdowns] = useState<CampaignBreakdowns>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!campaignId) return
    setLoading(true)
    const { data, error } = await insforge.database.rpc('campaign_breakdowns', {
      p_campaign_id: campaignId,
    })
    if (error) setError(error.message)
    else setBreakdowns((data as CampaignBreakdowns | null) ?? EMPTY)
    setLoading(false)
  }, [campaignId])

  useEffect(() => {
    void reload()
  }, [reload])

  return { breakdowns, loading, error, reload }
}
