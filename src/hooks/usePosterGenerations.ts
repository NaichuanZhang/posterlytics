import { useCallback, useEffect, useRef, useState } from 'react'
import { insforge } from '../lib/insforge'
import { jsonDeepEqual } from '../lib/jsonDeepEqual'
import type { PosterGeneration } from '../lib/types'

export function usePosterGenerations(campaignId: string | undefined) {
  const [generations, setGenerations] = useState<PosterGeneration[]>([])
  const [activeGenerations, setActiveGenerations] = useState<PosterGeneration[]>([])
  const [failedGenerations, setFailedGenerations] = useState<PosterGeneration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadedIdRef = useRef<string | null>(null)

  const reload = useCallback(async () => {
    if (!campaignId) return
    if (loadedIdRef.current !== campaignId) setLoading(true)
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
      const ready = rows
        .filter((generation) => generation.status === 'ready')
        .sort((a, b) => (b.version_number ?? 0) - (a.version_number ?? 0))
      const active = rows.filter((generation) =>
        ['created', 'analyzing', 'reviewing', 'designing', 'painting'].includes(generation.status)
      )
      const failed = rows.filter((generation) =>
        generation.status === 'failed' || generation.status === 'canceled'
      )
      setGenerations((current) => jsonDeepEqual(current, ready) ? current : ready)
      setActiveGenerations((current) => jsonDeepEqual(current, active) ? current : active)
      setFailedGenerations((current) => jsonDeepEqual(current, failed) ? current : failed)
    }
    loadedIdRef.current = campaignId
    setLoading(false)
  }, [campaignId])

  useEffect(() => {
    void reload()
  }, [reload])

  return { generations, activeGenerations, failedGenerations, loading, error, reload }
}
