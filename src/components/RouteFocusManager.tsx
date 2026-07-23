import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { moveFocusToView } from '../hooks/useViewFocus'

const ROUTE_FOCUS_TIMEOUT_MS = 2000

function hasMeaningfulMainFocus(main: HTMLElement): boolean {
  const activeElement = document.activeElement
  return (
    activeElement instanceof HTMLElement
    && activeElement !== document.body
    && activeElement !== document.documentElement
    && activeElement.isConnected
    && main.contains(activeElement)
  )
}

export function RouteFocusManager() {
  const { pathname } = useLocation()

  useEffect(() => {
    let disposed = false
    let observer: MutationObserver | null = null
    let timeout = 0
    let cancelFocus: (() => void) | null = null

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
      if (hasMeaningfulMainFocus(main)) return true

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
      window.cancelAnimationFrame(frame)
      cancelFocus?.()
      stopWatching()
    }
  }, [pathname])

  return null
}
