import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { insforge } from '../lib/insforge'
import { useAuth } from '../auth/AuthProvider'

export function SignInPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const { refresh } = useAuth()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error } = await insforge.auth.signUp({ email, password })
        if (error) throw new Error(error.message)
        if (!data?.accessToken) {
          // verification is off, but guard anyway
          const si = await insforge.auth.signInWithPassword({ email, password })
          if (si.error) throw new Error(si.error.message)
        }
      } else {
        const { error } = await insforge.auth.signInWithPassword({ email, password })
        if (error) throw new Error(error.message)
      }
      await refresh()
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card card">
        <div className="center" style={{ marginBottom: 22 }}>
          <div className="brand" style={{ fontSize: '1.5rem', fontWeight: 800 }}>
            Poster<span style={{ color: 'var(--primary)' }}>lytics</span>
          </div>
          <p className="muted" style={{ marginTop: 6, fontSize: '0.9rem' }}>
            On-brand product posters with visits attributed to each placement.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Email</label>
            <input
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              className="input"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </div>

          {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

          <button className="btn" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p className="center muted" style={{ marginTop: 16, fontSize: '0.9rem' }}>
          {mode === 'signin' ? "No account yet? " : 'Already have an account? '}
          <button
            className="link-btn"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setError(null)
            }}
          >
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}
