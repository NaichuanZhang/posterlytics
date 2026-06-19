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
    // Seed immediately so the first paint isn't 0. Measure the CONTENT box (not
    // getBoundingClientRect, which is the border box) so the seed matches what
    // the ResizeObserver later reports — otherwise the first frame is too wide
    // (border box includes padding) and the preview visibly shrinks to fit.
    const cs = getComputedStyle(node)
    const inner =
      node.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0')
    if (inner > 0) setWidth(inner)
  }, [])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  return [ref, width]
}
