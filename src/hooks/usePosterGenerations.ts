import { useCallback, useEffect, useState } from 'react'
import { insforge } from '../lib/insforge'
import type { PosterGeneration } from '../lib/types'

export function usePosterGenerations(campaignId: string | undefined) {
  const [generations, setGenerations] = useState<PosterGeneration[]>([])
  const [activeGenerations, setActiveGenerations] = useState<PosterGeneration[]>([])
  const [failedGenerations, setFailedGenerations] = useState<PosterGeneration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!campaignId) return
    setLoading(true)
    const { data, error: queryError } = await insforge.database
      .from('poster_generations')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })

    if (queryError) {
      setError(queryError.message)
    } else {
      setError(null)
      const rows = (data ?? []) as PosterGeneration[]
      setGenerations(
        rows
          .filter((generation) => generation.status === 'ready')
          .sort((a, b) => (b.version_number ?? 0) - (a.version_number ?? 0)),
      )
      setActiveGenerations(rows.filter((generation) =>
        ['created', 'analyzing', 'designing', 'painting'].includes(generation.status)
      ))
      setFailedGenerations(rows.filter((generation) => generation.status === 'failed'))
    }
    setLoading(false)
  }, [campaignId])

  useEffect(() => {
    void reload()
  }, [reload])

  return { generations, activeGenerations, failedGenerations, loading, error, reload }
}
