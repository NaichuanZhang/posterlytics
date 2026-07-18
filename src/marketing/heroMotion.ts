import { animate } from 'motion'

export function startHeroMotion(hero: HTMLElement) {
  const left = hero.querySelector<HTMLElement>('.hero-poster-left')
  const right = hero.querySelector<HTMLElement>('.hero-poster-right')

  hero.classList.remove('hero-motion-pending')
  if (!left || !right) return () => {}

  const leftAnimation = animate(
    left,
    { opacity: [0.92, 1], x: [56, 0], rotate: [-3, -8] },
    {
      type: 'spring',
      stiffness: 260,
      damping: 32,
      mass: 0.45,
      delay: 0.04,
    },
  )
  const rightAnimation = animate(
    right,
    { opacity: [0.92, 1], x: [-52, 0], rotate: [4, 10] },
    {
      type: 'spring',
      stiffness: 250,
      damping: 31,
      mass: 0.45,
      delay: 0.08,
    },
  )

  return () => {
    leftAnimation.stop()
    rightAnimation.stop()
  }
}
