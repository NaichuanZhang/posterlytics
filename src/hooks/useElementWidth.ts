import { useState, useCallback, useEffect } from 'react'

// Tracks the live pixel width of an element via ResizeObserver. Returns a ref
// callback to attach and the current width (0 until first measured). Used so a
// preview can size itself to fit its grid cell at any window width — no fixed
// widths, no overflow.
export function useElementWidth(): [(node: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(0)
  const [node, setNode] = useState<HTMLElement | null>(null)

  const ref = useCallback((nextNode: HTMLElement | null) => {
    setNode(nextNode)
  }, [])

  useEffect(() => {
    if (!node) return

    const measure = () => {
      const cs = getComputedStyle(node)
      const inner =
        node.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0')
      if (inner > 0) setWidth(inner)
    }
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w > 0) setWidth(w)
    })
    ro.observe(node)
    // Seed immediately so the first paint isn't 0. Measure the CONTENT box (not
    // getBoundingClientRect, which is the border box) so the seed matches what
    // the ResizeObserver later reports — otherwise the first frame is too wide
    // (border box includes padding) and the preview visibly shrinks to fit.
    measure()

    return () => ro.disconnect()
  }, [node])

  return [ref, width]
}
