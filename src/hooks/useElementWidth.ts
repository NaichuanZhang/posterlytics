import { useState, useCallback, useRef, useEffect } from 'react'

// Tracks the live pixel width of an element via ResizeObserver. Returns a ref
// callback to attach and the current width (0 until first measured). Used so a
// preview can size itself to fit its grid cell at any window width — no fixed
// widths, no overflow.
export function useElementWidth(): [(node: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(0)
  const observerRef = useRef<ResizeObserver | null>(null)

  const ref = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect()
    if (!node) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w > 0) setWidth(w)
    })
    ro.observe(node)
    observerRef.current = ro
    // Seed immediately so the first paint isn't 0.
    setWidth(node.getBoundingClientRect().width)
  }, [])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  return [ref, width]
}
