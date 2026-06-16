import { useCallback, useEffect, useRef, useState } from 'react'
import { insforge } from '../lib/insforge'
import { mintCode } from '../lib/codes'
import type { Placement } from '../lib/types'

export function usePlacements(campaignId: string | undefined, userId: string | undefined) {
  const [placements, setPlacements] = useState<Placement[]>([])

  const reload = useCallback(async () => {
    if (!campaignId) return
    const { data, error } = await insforge.database
      .from('placements')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
    if (!error) setPlacements((data ?? []) as Placement[])
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

  // Ensure a campaign always has at least one placement, so its poster's QR
  // encodes a real (trackable, once published) code rather than a dead preview.
  // Idempotent: re-reads first and only inserts when truly empty.
  const ensuredFor = useRef<string | null>(null)
  const ensureDefault = useCallback(async () => {
    if (!campaignId || !userId) return
    if (ensuredFor.current === campaignId) return
    ensuredFor.current = campaignId
    const { data } = await insforge.database
      .from('placements')
      .select('id')
      .eq('campaign_id', campaignId)
      .limit(1)
    if (data && data.length > 0) return
    await addPlacement('Primary')
  }, [campaignId, userId, addPlacement])

  return { placements, reload, addPlacement, removePlacement, ensureDefault }
}
