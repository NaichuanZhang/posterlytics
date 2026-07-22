import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  canonicalLocalDraftContent,
  getBrowserLocalDraftStorage,
  type LocalDraftStorage,
} from '../lib/localDraft'

export type DraftPersistenceState =
  | 'pristine'
  | 'pending'
  | 'saved'
  | 'error'

interface UseDebouncedLocalDraftOptions<T> {
  storageKey: string | null
  value: T
  ready: boolean
  dirty: boolean
  initialPersistedCanonical?: string | null
  guardBeforeUnload: boolean
  serialize: (value: T, nowMs: number) => string
  storage?: LocalDraftStorage | null
  debounceMs?: number
}

interface LatestDraft<T> {
  storageKey: string | null
  value: T
  canonical: string
  ready: boolean
  dirty: boolean
}

export function useDebouncedLocalDraft<T>({
  storageKey,
  value,
  ready,
  dirty,
  initialPersistedCanonical = null,
  guardBeforeUnload,
  serialize,
  storage,
  debounceMs = 500,
}: UseDebouncedLocalDraftOptions<T>) {
  const canonical = canonicalLocalDraftContent(value)
  const [status, setStatus] = useState<DraftPersistenceState>('pristine')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeKeyRef = useRef<string | null>(null)
  const seededRef = useRef(false)
  const lastSavedCanonicalRef = useRef<string | null>(null)
  const clearedCanonicalRef = useRef<string | null>(null)
  const latestRef = useRef<LatestDraft<T>>({
    storageKey,
    value,
    canonical,
    ready,
    dirty,
  })
  latestRef.current = { storageKey, value, canonical, ready, dirty }
  if (
    clearedCanonicalRef.current !== null
    && clearedCanonicalRef.current !== canonical
  ) {
    clearedCanonicalRef.current = null
  }

  const resolveStorage = useCallback(
    () => storage === undefined ? getBrowserLocalDraftStorage() : storage,
    [storage],
  )

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const flush = useCallback((): boolean => {
    cancelTimer()
    const latest = latestRef.current
    if (
      !latest.ready
      || !latest.dirty
      || !latest.storageKey
      || clearedCanonicalRef.current === latest.canonical
    ) {
      return true
    }
    if (lastSavedCanonicalRef.current === latest.canonical) {
      setStatus('saved')
      return true
    }

    try {
      const target = resolveStorage()
      if (!target) {
        setStatus('error')
        return false
      }
      target.setItem(
        latest.storageKey,
        serialize(latest.value, Date.now()),
      )
      lastSavedCanonicalRef.current = latest.canonical
      setStatus('saved')
      return true
    } catch {
      setStatus('error')
      return false
    }
  }, [cancelTimer, resolveStorage, serialize])

  const flushRef = useRef(flush)
  flushRef.current = flush

  useEffect(() => {
    cancelTimer()

    if (activeKeyRef.current !== storageKey) {
      activeKeyRef.current = storageKey
      seededRef.current = false
      lastSavedCanonicalRef.current = null
      clearedCanonicalRef.current = null
      setStatus('pristine')
    }
    if (!ready || !storageKey) return

    if (!seededRef.current) {
      seededRef.current = true
      lastSavedCanonicalRef.current = initialPersistedCanonical
    }

    if (!dirty) {
      try {
        resolveStorage()?.removeItem(storageKey)
      } catch {
        // A pristine form has no draft content that needs persistence.
      }
      lastSavedCanonicalRef.current = null
      setStatus('pristine')
      return
    }

    if (clearedCanonicalRef.current === canonical) {
      setStatus('pristine')
      return
    }
    if (lastSavedCanonicalRef.current === canonical) {
      setStatus('saved')
      return
    }

    setStatus('pending')
    timerRef.current = setTimeout(() => flushRef.current(), debounceMs)
    return cancelTimer
  }, [
    cancelTimer,
    canonical,
    debounceMs,
    dirty,
    initialPersistedCanonical,
    ready,
    resolveStorage,
    storageKey,
  ])

  useEffect(() => {
    if (!guardBeforeUnload) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      flushRef.current()
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [guardBeforeUnload])

  useEffect(() => cancelTimer, [cancelTimer])

  const clear = useCallback(() => {
    cancelTimer()
    const latest = latestRef.current
    clearedCanonicalRef.current = latest.canonical
    lastSavedCanonicalRef.current = null
    if (latest.storageKey) {
      try {
        resolveStorage()?.removeItem(latest.storageKey)
      } catch {
        // Clearing in-memory state remains valid when storage is unavailable.
      }
    }
    setStatus('pristine')
  }, [cancelTimer, resolveStorage])

  return { status, flush, clear }
}
