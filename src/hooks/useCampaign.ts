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

  return { campaign, setCampaign, loading, error, reload }
}
