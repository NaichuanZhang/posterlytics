import { useCallback, useEffect, useRef, useState } from 'react'
import { insforge } from '../lib/insforge'
import { mintCode } from '../lib/codes'
import { ensureDefaultCampaignPlacement } from '../lib/placementService'
import type { Placement } from '../lib/types'
import { useI18n } from '../i18n/I18nProvider'

export function usePlacements(
  campaignId: string | undefined,
  userId: string | undefined,
  enabled = true,
) {
  const { t } = useI18n()
  const [placements, setPlacements] = useState<Placement[]>([])
  const [defaultPlacementError, setDefaultPlacementError] =
    useState<string | null>(null)

  const reload = useCallback(async (force = false): Promise<string | null> => {
    if (!campaignId || (!enabled && !force)) {
      setPlacements([])
      return null
    }
    const { data, error } = await insforge.database
      .from('placements')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
    if (error) return error.message
    setPlacements((data ?? []) as Placement[])
    return null
  }, [campaignId, enabled])

  useEffect(() => {
    void reload()
  }, [reload])

  // Insert a placement, retrying once on the (astronomically unlikely) code collision.
  const addPlacement = useCallback(
    async (label: string): Promise<string | null> => {
      if (!enabled || !campaignId || !userId) return t('Missing campaign or user')
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
      return t('Could not generate a unique code, please retry.')
    },
    [campaignId, enabled, userId, reload, t],
  )

  const removePlacement = useCallback(
    async (id: string): Promise<string | null> => {
      const { error } = await insforge.database.from('placements').delete().eq('id', id)
      if (error) return error.message
      await reload()
      return null
    },
    [reload],
  )

  // Ensure a campaign always has at least one placement, so its poster's QR
  // encodes a real (trackable, once published) code rather than a dead preview.
  // Idempotent: re-reads first and only inserts when truly empty.
  const ensuredFor = useRef<string | null>(null)
  const ensureInFlight = useRef<Promise<string | null> | null>(null)
  const ensureDefault = useCallback((
    force = false,
  ): Promise<string | null> => {
    if ((!enabled && !force) || !campaignId || !userId) {
      return Promise.resolve(null)
    }
    if (!force && ensuredFor.current === campaignId) {
      return Promise.resolve(null)
    }
    if (ensureInFlight.current) return ensureInFlight.current

    setDefaultPlacementError(null)
    const operation = (async () => {
      try {
        const placementError = await ensureDefaultCampaignPlacement({
          campaignId,
          userId,
          label: t('Primary'),
        })
        const reloadError = await reload(true)
        const error = placementError ?? reloadError
        if (!error) {
          ensuredFor.current = campaignId
          return null
        }
        ensuredFor.current = null
        setDefaultPlacementError(error)
        return error
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause)
        ensuredFor.current = null
        setDefaultPlacementError(error)
        return error
      }
    })()
    ensureInFlight.current = operation
    void operation.finally(() => {
      if (ensureInFlight.current === operation) ensureInFlight.current = null
    })
    return operation
  }, [campaignId, enabled, reload, t, userId])

  useEffect(() => {
    ensuredFor.current = null
    ensureInFlight.current = null
    setDefaultPlacementError(null)
  }, [campaignId])

  return {
    placements,
    reload,
    addPlacement,
    removePlacement,
    ensureDefault,
    defaultPlacementError,
  }
}
