import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './AuthProvider'
import { Spinner } from '../components/ui/Spinner'

// Gate protected routes on the cold-load auth state.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner full />
  if (!user) return <Navigate to="/signin" replace />
  return <>{children}</>
}
