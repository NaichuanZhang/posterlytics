import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { moveFocusToView } from '../hooks/useViewFocus'

const ROUTE_FOCUS_TIMEOUT_MS = 2000

/**
 * True when focus inside the view was placed by the user rather than by mount.
 *
 * Any focus inside `#main-content` used to count, which meant a content-rich
 * view (the poster editor, whose versions panel takes focus on mount) suppressed
 * the heading focus entirely: the heading never received focus, so Tab resumed
 * from mid-page and the skip link sat ~28 stops away. Requiring a real
 * interaction since the route change keeps the original intent — never stomp a
 * focus the user chose — without letting auto-focused content defeat it.
 */
function hasMeaningfulMainFocus(main: HTMLElement, interacted: boolean): boolean {
  if (!interacted) return false
  const activeElement = document.activeElement
  return (
    activeElement instanceof HTMLElement
    && activeElement !== document.body
    && activeElement !== document.documentElement
    && activeElement.isConnected
    && main.contains(activeElement)
  )
}

const USER_INTERACTION_EVENTS = [
  'pointerdown',
  'keydown',
  'mousedown',
  'touchstart',
] as const

export function RouteFocusManager() {
  const { pathname } = useLocation()

  useEffect(() => {
    let disposed = false
    let observer: MutationObserver | null = null
    let timeout = 0
    let cancelFocus: (() => void) | null = null
    // Reset per route change: focus the user placed on the *previous* view must
    // not suppress focusing the new view's heading.
    let interacted = false

    function markInteracted() {
      interacted = true
    }

    for (const eventName of USER_INTERACTION_EVENTS) {
      window.addEventListener(eventName, markInteracted, { capture: true, passive: true })
    }

    function stopWatching() {
      observer?.disconnect()
      observer = null
      if (timeout) window.clearTimeout(timeout)
      timeout = 0
    }

    function focusRoute(): boolean {
      if (disposed || document.querySelector('[aria-modal="true"]')) return true

      const main = document.getElementById('main-content')
      if (!(main instanceof HTMLElement)) return false
      if (hasMeaningfulMainFocus(main, interacted)) return true

      const target = main.querySelector<HTMLElement>('h1')
        ?? main.querySelector<HTMLElement>('h2')
        ?? main
      cancelFocus = moveFocusToView(target)
      return true
    }

    const frame = window.requestAnimationFrame(() => {
      if (focusRoute()) return

      observer = new MutationObserver(() => {
        if (!focusRoute()) return
        stopWatching()
      })
      observer.observe(document.body, { childList: true, subtree: true })
      timeout = window.setTimeout(stopWatching, ROUTE_FOCUS_TIMEOUT_MS)
    })

    return () => {
      disposed = true
      for (const eventName of USER_INTERACTION_EVENTS) {
        window.removeEventListener(eventName, markInteracted, { capture: true })
      }
      window.cancelAnimationFrame(frame)
      cancelFocus?.()
      stopWatching()
    }
  }, [pathname])

  return null
}
