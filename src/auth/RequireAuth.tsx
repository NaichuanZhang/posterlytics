import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './AuthProvider'
import { Spinner } from '../components/ui/Spinner'
import { signInPath } from '../lib/authRouting'

// Gate protected routes on the cold-load auth state.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, signInReason } = useAuth()
  const location = useLocation()
  if (loading) return <Spinner full />
  if (!user) {
    const nextPath = `${location.pathname}${location.search}${location.hash}`
    return (
      <Navigate
        to={signInPath(nextPath, 'signin', signInReason ?? undefined)}
        replace
      />
    )
  }
  return <>{children}</>
}
