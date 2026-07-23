import { lazy, Suspense } from 'react'
import { FirstPaintLoadingShell } from './components/ui/FirstPaintLoadingShell'
import { shouldLoadSessionApp } from './lib/authRouting'
import { PublicLandingShell } from './marketing/PublicLandingShell'

const SessionApp = lazy(() => import('./SessionApp'))

export default function App() {
  const needsSession = typeof window === 'undefined'
    || typeof document === 'undefined'
    || shouldLoadSessionApp(
      window.location.pathname,
      document.cookie,
      window.location.search,
    )

  if (!needsSession) return <PublicLandingShell />

  return (
    <Suspense fallback={<FirstPaintLoadingShell />}>
      <SessionApp />
    </Suspense>
  )
}
