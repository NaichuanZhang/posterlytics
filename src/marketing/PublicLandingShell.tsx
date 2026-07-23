import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { ArrowDownRight, ArrowRight } from 'lucide-react'
import { LanguageSelect } from '../components/LanguageSelect'
import { useI18n } from '../i18n/I18nProvider'
import { signInPath } from '../lib/authRouting'
import { SamplePoster } from './SamplePoster'
import './public.css'

const LandingSections = lazy(() => import('../pages/LandingPage'))
const CREATE_ACCOUNT_PATH = signInPath('/campaigns/new', 'signup')
const SIGN_IN_PATH = signInPath('/')

export function PublicLandingShell() {
  const { t } = useI18n()
  const [showLandingSections, setShowLandingSections] = useState(false)

  useEffect(() => {
    const timeout = window.setTimeout(() => setShowLandingSections(true), 650)
    return () => window.clearTimeout(timeout)
  }, [])

  return (
    <div className="public-surface">
      <a className="public-skip-link" href="#public-main">{t('Skip to content')}</a>
      <PublicNavigation />
      <main id="public-main">
        <StaticHero />
        {showLandingSections ? (
          <Suspense fallback={<LandingSectionPreview />}>
            <LandingSections />
          </Suspense>
        ) : (
          <LandingSectionPreview />
        )}
      </main>
    </div>
  )
}

function LandingSectionPreview() {
  return (
    <section
      id="workflow"
      className="public-section public-section-preview"
      aria-hidden="true"
    />
  )
}

function PublicNavigation() {
  const { t } = useI18n()
  return (
    <header className="public-nav-shell">
      <a href="/" className="public-brand" aria-label={t('Posterlytics home')}>
        <span className="public-brand-mark" aria-hidden="true">P</span>
        <strong>Posterlytics</strong>
      </a>
      <nav className="public-nav" aria-label={t('Landing page')}>
        <a href="#workflow">{t('Workflow')}</a>
        <a href="#versions">{t('Versions')}</a>
        <a href="#attribution">{t('Attribution')}</a>
        <LanguageSelect variant="public" />
        <a href={SIGN_IN_PATH}>{t('Sign in')}</a>
        <a className="public-nav-cta" href={CREATE_ACCOUNT_PATH}>{t('Create account')}</a>
      </nav>
    </header>
  )
}

function StaticHero() {
  const { t } = useI18n()
  const heroRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const hero = heroRef.current
    if (!hero) return

    const staticMotion = window.matchMedia(
      '(max-width: 767px), (prefers-reduced-motion: reduce)',
    ).matches
    if (staticMotion) {
      hero.classList.remove('hero-motion-pending')
      return
    }

    let cancelled = false
    let dispose: (() => void) | undefined
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        void import('./heroMotion').then(({ startHeroMotion }) => {
          if (cancelled) return
          dispose = startHeroMotion(hero)
        }).catch(() => {
          if (!cancelled) hero.classList.remove('hero-motion-pending')
        })
      })
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
      dispose?.()
    }
  }, [])

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (window.matchMedia(
      '(max-width: 767px), (prefers-reduced-motion: reduce)',
    ).matches) return

    const bounds = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
    const y = ((event.clientY - bounds.top) / bounds.height) * 2 - 1
    event.currentTarget.style.setProperty('--hero-left-x', `${x * 10}px`)
    event.currentTarget.style.setProperty('--hero-left-y', `${y * 5}px`)
    event.currentTarget.style.setProperty('--hero-right-x', `${x * -7}px`)
    event.currentTarget.style.setProperty('--hero-right-y', `${y * -13}px`)
  }

  function resetPointer() {
    const hero = heroRef.current
    if (!hero) return
    hero.style.removeProperty('--hero-left-x')
    hero.style.removeProperty('--hero-left-y')
    hero.style.removeProperty('--hero-right-x')
    hero.style.removeProperty('--hero-right-y')
  }

  return (
    <section
      ref={heroRef}
      className="public-hero hero-motion-pending"
      aria-labelledby="hero-heading"
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
    >
      <div className="public-hero-grid">
        <div className="public-hero-copy">
          <span className="public-overline">{t('Website in / poster out / signal back')}</span>
          <h1 id="hero-heading">Posterlytics</h1>
          <p>{t('Turn any product website into an on-brand poster, then track every scan by placement.')}</p>
          <div className="public-hero-actions">
            <a className="public-button public-button-primary" href={CREATE_ACCOUNT_PATH}>
              {t('Create account')}
              <ArrowRight size={17} aria-hidden="true" />
            </a>
            <a className="public-text-link" href="#workflow">
              {t('See the workflow')}
              <ArrowDownRight size={17} aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className="hero-poster-stage" aria-label={t('Three sample product posters')}>
          <div className="hero-poster hero-poster-left">
            <div className="hero-poster-parallax">
              <SamplePoster variant="routes" />
            </div>
          </div>
          <div className="hero-poster hero-poster-center">
            <SamplePoster variant="field" priority />
          </div>
          <div className="hero-poster hero-poster-right">
            <div className="hero-poster-parallax">
              <SamplePoster variant="signal" />
            </div>
          </div>
        </div>
      </div>
      <div className="public-hero-index" aria-hidden="true">
        <span>PL / 001</span>
        <span>PRINT TO SIGNAL</span>
      </div>
    </section>
  )
}
