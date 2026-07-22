import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { insforge } from '../lib/insforge'
import { hasAuthHydrationSignal } from '../lib/authRouting'
import { clearAllLocalDrafts } from '../lib/localDraft'

interface AuthUser {
  id: string
  email: string
}

interface AuthState {
  user: AuthUser | null
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  refresh: async () => {},
  signOut: async () => {},
})

function initialAuthLoading() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return true
  return hasAuthHydrationSignal(document.cookie, window.location.search)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(initialAuthLoading)

  async function hydrate() {
    const { data, error } = await insforge.auth.getCurrentUser()
    const u = error ? null : data?.user
    setUser(u ? { id: u.id, email: u.email } : null)
    setLoading(false)
  }

  useEffect(() => {
    if (!initialAuthLoading()) {
      setLoading(false)
      return
    }

    let cancelled = false
    insforge.auth.getCurrentUser().then(({ data, error }) => {
      if (cancelled) return
      const u = error ? null : data?.user
      setUser(u ? { id: u.id, email: u.email } : null)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function signOut() {
    await insforge.auth.signOut()
    clearAllLocalDrafts()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, refresh: hydrate, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
