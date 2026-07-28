import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useToast } from '../components/ui/Toast'
import { displayNameOrUntitled } from '../lib/campaignDisplayName'
import { useI18n } from '../i18n/I18nProvider'
import {
  fetchGenerationActivity,
  markGenerationNotificationsRead,
  retryPosterGeneration,
} from '../lib/generationApi'
import { isActiveGenerationJob } from '../lib/generationActivity'
import { insforge } from '../lib/insforge'
import type { GenerationActivityItem } from '../lib/types'
import { GenerationActivitySheet } from './GenerationActivitySheet'

interface GenerationActivityContextValue {
  items: GenerationActivityItem[]
  unreadCount: number
  loading: boolean
  error: string | null
  sheetOpen: boolean
  openSheet: () => void
  closeSheet: () => void
  refresh: () => Promise<void>
  openItem: (item: GenerationActivityItem) => void
  markAllRead: () => Promise<void>
  retry: (item: GenerationActivityItem) => Promise<void>
}

const GenerationActivityContext = createContext<GenerationActivityContextValue | null>(null)

export function GenerationActivityProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const { notify } = useToast()
  const { locale, t } = useI18n()
  const navigate = useNavigate()
  const [items, setItems] = useState<GenerationActivityItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const initializedRef = useRef(false)
  const knownNotificationsRef = useRef(new Set<string>())
  const inFlightRef = useRef<Promise<void> | null>(null)

  const refresh = useCallback(async () => {
    if (!user) return
    if (inFlightRef.current) return inFlightRef.current

    const request = (async () => {
      setLoading((current) => current || !initializedRef.current)
      try {
        const activity = await fetchGenerationActivity()
        const terminal = activity.items.filter((item) => item.notification_id)
        if (initializedRef.current) {
          for (const item of terminal) {
            const notificationId = item.notification_id
            if (
              !notificationId
              || item.read_at
              || knownNotificationsRef.current.has(notificationId)
            ) {
              continue
            }
            notify(
              item.status === 'succeeded'
                ? t('{name} poster is ready.', {
                    name: displayNameOrUntitled(
                      item.campaign_name,
                      t('Untitled campaign'),
                    ),
                  })
                : t('{name} generation failed.', {
                    name: displayNameOrUntitled(
                      item.campaign_name,
                      t('Untitled campaign'),
                    ),
                  }),
              item.status === 'succeeded' ? 'success' : 'error',
              {
                dedupeKey: `generation-notification:${notificationId}`,
                action: {
                  label: item.status === 'succeeded' ? t('Open') : t('Review'),
                  onClick: () => {
                    void markGenerationNotificationsRead([notificationId])
                    navigate(`/campaigns/${item.campaign_id}`)
                  },
                },
              },
            )
          }
        }

        for (const item of terminal) {
          if (item.notification_id) {
            knownNotificationsRef.current.add(item.notification_id)
          }
        }
        initializedRef.current = true
        setItems(activity.items)
        setUnreadCount(activity.unread_count)
        setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('Generation activity could not be loaded.'))
      } finally {
        setLoading(false)
        inFlightRef.current = null
      }
    })()
    inFlightRef.current = request
    return request
  }, [navigate, notify, t, user])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      initializedRef.current = false
      knownNotificationsRef.current.clear()
      setItems([])
      setUnreadCount(0)
      setSheetOpen(false)
      return
    }
    void refresh()
  }, [authLoading, refresh, user])

  useEffect(() => {
    if (!user) return
    const channel = `generation:${user.id}`
    const handleActivity = (payload: unknown) => {
      const meta = payload && typeof payload === 'object'
        ? (payload as { meta?: { channel?: string } }).meta
        : undefined
      if (!meta?.channel || meta.channel === channel) void refresh()
    }
    const handleConnect = () => {
      void insforge.realtime.subscribe(channel).then(() => refresh())
    }

    let cancelled = false
    insforge.realtime.on('generation_activity_changed', handleActivity)
    insforge.realtime.on('connect', handleConnect)
    void insforge.realtime.connect()
      .then(async () => {
        if (cancelled) return
        await insforge.realtime.subscribe(channel)
      })
      .catch(() => {
        // Polling remains authoritative when realtime is unavailable.
      })

    return () => {
      cancelled = true
      insforge.realtime.off('generation_activity_changed', handleActivity)
      insforge.realtime.off('connect', handleConnect)
      insforge.realtime.unsubscribe(channel)
    }
  }, [refresh, user])

  useEffect(() => {
    if (!user) return
    const pollingMs = items.some(isActiveGenerationJob) ? 5000 : 30000
    const timer = window.setInterval(() => void refresh(), pollingMs)
    return () => window.clearInterval(timer)
  }, [items, refresh, user])

  useEffect(() => {
    if (!user) return
    const handleFocus = () => void refresh()
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refresh, user])

  const openItem = useCallback((item: GenerationActivityItem) => {
    if (item.notification_id && !item.read_at) {
      setItems((current) => current.map((candidate) =>
        candidate.notification_id === item.notification_id
          ? { ...candidate, read_at: new Date().toISOString() }
          : candidate
      ))
      setUnreadCount((count) => Math.max(0, count - 1))
      void markGenerationNotificationsRead([item.notification_id])
        .then(refresh)
        .catch((cause) => {
          setError(cause instanceof Error ? cause.message : t('Notification could not be marked read.'))
        })
    }
    setSheetOpen(false)
    navigate(item.status === 'awaiting_review'
      ? `/campaigns/${item.campaign_id}/generations/${item.generation_id}/assets`
      : `/campaigns/${item.campaign_id}`)
  }, [navigate, refresh, t])

  const markAllRead = useCallback(async () => {
    try {
      await markGenerationNotificationsRead(null)
      setItems((current) => current.map((item) =>
        item.notification_id && !item.read_at
          ? { ...item, read_at: new Date().toISOString() }
          : item
      ))
      setUnreadCount(0)
      await refresh()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t('Notifications could not be marked read.')
      setError(message)
      notify(t('Notifications could not be marked read.'), 'error')
    }
  }, [notify, refresh, t])

  const retry = useCallback(async (item: GenerationActivityItem) => {
    try {
      const result = await retryPosterGeneration(item.job_id, locale)
      notify(t('Generation restarted with the same inputs.'), 'success')
      setSheetOpen(false)
      await refresh()
      navigate(result.generation.asset_selection_mode === 'editor'
        ? `/campaigns/${result.generation.campaign_id}/generations/${result.generation.id}/assets`
        : `/campaigns/${result.generation.campaign_id}`)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t('Generation could not be retried.')
      setError(message)
      notify(t('Generation could not be retried.'), 'error')
    }
  }, [locale, navigate, notify, refresh, t])

  const value = useMemo<GenerationActivityContextValue>(() => ({
    items,
    unreadCount,
    loading,
    error,
    sheetOpen,
    openSheet: () => setSheetOpen(true),
    closeSheet: () => setSheetOpen(false),
    refresh,
    openItem,
    markAllRead,
    retry,
  }), [
    error,
    items,
    loading,
    markAllRead,
    openItem,
    refresh,
    retry,
    sheetOpen,
    unreadCount,
  ])

  return (
    <GenerationActivityContext.Provider value={value}>
      {children}
      {sheetOpen && (
        <GenerationActivitySheet
          items={items}
          unreadCount={unreadCount}
          loading={loading}
          error={error}
          onClose={() => setSheetOpen(false)}
          onOpen={openItem}
          onMarkAllRead={() => void markAllRead()}
          onRetry={(item) => void retry(item)}
        />
      )}
    </GenerationActivityContext.Provider>
  )
}

export function useGenerationActivity() {
  const context = useContext(GenerationActivityContext)
  if (!context) {
    throw new Error('useGenerationActivity must be used inside GenerationActivityProvider')
  }
  return context
}
