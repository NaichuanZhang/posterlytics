import { useEffect, useRef } from 'react'

// Scroll-entry reveal via IntersectionObserver (never scroll listeners).
// Attach the returned ref to a container; any descendant with class `reveal`
// gets `in` added when it scrolls into view, triggering the CSS transition.
// Pass `deps` (e.g. async-loaded data) so targets rendered later get observed.
export function useReveal<T extends HTMLElement = HTMLDivElement>(deps: unknown[] = []) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const targets = Array.from(root.querySelectorAll<HTMLElement>('.reveal:not(.in)'))
    if (targets.length === 0) return

    // Respect reduced motion / no-IO environments: just show everything.
    if (typeof IntersectionObserver === 'undefined') {
      targets.forEach((t) => t.classList.add('in'))
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in')
            io.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )

    targets.forEach((t, i) => {
      // Stagger entries slightly for a cascade.
      t.style.transitionDelay = `${Math.min(i * 60, 300)}ms`
      io.observe(t)
    })
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return ref
}
