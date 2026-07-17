import { useCallback, useEffect, useState } from 'react'
import { insforge } from '../lib/insforge'
import type { PosterGeneration } from '../lib/types'

export function usePosterGenerations(campaignId: string | undefined) {
  const [generations, setGenerations] = useState<PosterGeneration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!campaignId) return
    setLoading(true)
    const { data, error: queryError } = await insforge.database
      .from('poster_generations')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('status', 'ready')
      .order('version_number', { ascending: false })

    if (queryError) {
      setError(queryError.message)
    } else {
      setError(null)
      setGenerations((data ?? []) as PosterGeneration[])
    }
    setLoading(false)
  }, [campaignId])

  useEffect(() => {
    void reload()
  }, [reload])

  return { generations, loading, error, reload }
}
