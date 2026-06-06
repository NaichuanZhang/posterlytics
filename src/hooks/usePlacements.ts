import { useCallback, useEffect, useState } from 'react'
import { insforge } from '../lib/insforge'
import { mintCode } from '../lib/codes'
import type { Placement } from '../lib/types'

export function usePlacements(campaignId: string | undefined, userId: string | undefined) {
  const [placements, setPlacements] = useState<Placement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!campaignId) return
    setLoading(true)
    const { data, error } = await insforge.database
      .from('placements')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
    if (error) setError(error.message)
    else setPlacements((data ?? []) as Placement[])
    setLoading(false)
  }, [campaignId])

  useEffect(() => {
    void reload()
  }, [reload])

  // Insert a placement, retrying once on the (astronomically unlikely) code collision.
  const addPlacement = useCallback(
    async (label: string): Promise<string | null> => {
      if (!campaignId || !userId) return 'Missing campaign or user'
      for (let attempt = 0; attempt < 2; attempt++) {
        const { error } = await insforge.database
          .from('placements')
          .insert([{ campaign_id: campaignId, user_id: userId, label, code: mintCode() }])
        if (!error) {
          await reload()
          return null
        }
        if (!/duplicate|unique|23505/i.test(error.message)) return error.message
      }
      return 'Could not generate a unique code, please retry.'
    },
    [campaignId, userId, reload],
  )

  const removePlacement = useCallback(
    async (id: string) => {
      await insforge.database.from('placements').delete().eq('id', id)
      await reload()
    },
    [reload],
  )

  return { placements, loading, error, reload, addPlacement, removePlacement }
}
