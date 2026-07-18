import { lazy, Suspense } from 'react'
import { Spinner } from './components/ui/Spinner'
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
    <Suspense fallback={<Spinner full />}>
      <SessionApp />
    </Suspense>
  )
}
