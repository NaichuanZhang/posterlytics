import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { insforge } from '../lib/insforge'
import {
  hasAuthHydrationSignal,
  type SignInReason,
} from '../lib/authRouting'
import { clearAllLocalDrafts } from '../lib/localDraft'
import {
  clearSessionExpiry,
  consumeSessionExpired,
  subscribeToSessionExpiry,
} from '../lib/sessionExpiry'

interface AuthUser {
  id: string
  email: string
}

interface AuthSnapshot {
  user: AuthUser | null
  loading: boolean
  signInReason: SignInReason | null
}

interface AuthState extends AuthSnapshot {
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  clearSignInReason: () => void
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  signInReason: null,
  refresh: async () => {},
  signOut: async () => {},
  clearSignInReason: () => {},
})

function initialAuthLoading() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return true
  return hasAuthHydrationSignal(document.cookie, window.location.search)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthSnapshot>(() => ({
    user: null,
    loading: initialAuthLoading(),
    signInReason: null,
  }))

  const hydrate = useCallback(async () => {
    const { data, error } = await insforge.auth.getCurrentUser()
    const u = error ? null : data?.user
    if (!error) clearSessionExpiry()
    setAuthState((current) => ({
      user: u ? { id: u.id, email: u.email } : null,
      loading: false,
      signInReason: error ? current.signInReason : null,
    }))
  }, [])

  const clearSignInReason = useCallback(() => {
    setAuthState((current) => ({
      ...current,
      signInReason: null,
    }))
  }, [])

  useEffect(() => subscribeToSessionExpiry(() => {
    if (!consumeSessionExpired()) return
    setAuthState((current) => ({
      ...current,
      user: null,
      loading: false,
      signInReason: 'session_expired',
    }))
  }), [])

  useEffect(() => {
    if (!initialAuthLoading()) {
      setAuthState((current) => ({
        ...current,
        loading: false,
      }))
      return
    }

    let cancelled = false
    insforge.auth.getCurrentUser().then(({ data, error }) => {
      if (cancelled) return
      const u = error ? null : data?.user
      if (!error) clearSessionExpiry()
      setAuthState((current) => ({
        user: u ? { id: u.id, email: u.email } : null,
        loading: false,
        signInReason: error ? current.signInReason : null,
      }))
    })
    return () => {
      cancelled = true
    }
  }, [])

  const signOut = useCallback(async () => {
    await insforge.auth.signOut()
    clearAllLocalDrafts()
    clearSessionExpiry()
    setAuthState({
      user: null,
      loading: false,
      signInReason: null,
    })
  }, [])

  return (
    <AuthContext.Provider
      value={{
        ...authState,
        refresh: hydrate,
        signOut,
        clearSignInReason,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
