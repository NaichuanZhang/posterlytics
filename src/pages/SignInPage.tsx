import { ArrowRight } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { InlineNotice } from '../components/ui/Feedback'
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await insforge.auth.signUp({ email, password })
        if (signUpError) throw new Error(signUpError.message)
        if (!data?.accessToken) {
          const signIn = await insforge.auth.signInWithPassword({ email, password })
          if (signIn.error) throw new Error(signIn.error.message)
        }
      } else {
        const { error: signInError } = await insforge.auth.signInWithPassword({ email, password })
        if (signInError) throw new Error(signInError.message)
      }
      await refresh()
      navigate('/')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-shell">
      <header className="auth-brand">
        <span className="auth-mark">P</span>
        <strong>Posterlytics</strong>
      </header>

      <section className="auth-panel" aria-labelledby="auth-heading">
        <div className="auth-heading">
          <span>Poster attribution workspace</span>
          <h1 id="auth-heading">{mode === 'signin' ? 'Sign in' : 'Create an account'}</h1>
        </div>

        <div className="segmented-control auth-mode" aria-label="Authentication mode">
          <button
            type="button"
            className={mode === 'signin' ? 'is-active' : ''}
            aria-pressed={mode === 'signin'}
            onClick={() => {
              setMode('signin')
              setError(null)
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === 'signup' ? 'is-active' : ''}
            aria-pressed={mode === 'signup'}
            onClick={() => {
              setMode('signup')
              setError(null)
            }}
          >
            Create account
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 6 characters"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </div>

          {error && <InlineNotice tone="error">{error}</InlineNotice>}

          <button className="button button-primary auth-submit" disabled={busy}>
            {busy ? 'Please wait' : mode === 'signup' ? 'Create account' : 'Sign in'}
            {!busy && <ArrowRight size={16} aria-hidden="true" />}
          </button>
        </form>
      </section>
    </main>
  )
}
