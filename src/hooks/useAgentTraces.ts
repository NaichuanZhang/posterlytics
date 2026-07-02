import { useCallback, useEffect, useState } from 'react'
import { insforge } from '../lib/insforge'
import type { AgentTrace } from '../lib/types'

// Loads the failure/degrade traces for a campaign (agent_traces, db/15), newest
// first. Owner RLS scopes it to the caller. Mirrors useCampaign's shape.
export function useAgentTraces(campaignId: string | undefined) {
  const [traces, setTraces] = useState<AgentTrace[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!campaignId) return
    setLoading(true)
    const { data } = await insforge.database
      .from('agent_traces')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
    setTraces((data ?? []) as AgentTrace[])
    setLoading(false)
  }, [campaignId])

  useEffect(() => {
    void reload()
  }, [reload])

  return { traces, loading, reload }
}
