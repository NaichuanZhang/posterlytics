import { ArrowLeft, ArrowRight, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { PasswordRecoveryFlow } from '../auth/PasswordRecoveryFlow'
import { LanguageSelect } from '../components/LanguageSelect'
import { InlineNotice } from '../components/ui/Feedback'
import { useDocumentMetadata } from '../hooks/useDocumentMetadata'
import { useI18n } from '../i18n/I18nProvider'
import { useFocusOnChange } from '../hooks/useViewFocus'
import { insforge } from '../lib/insforge'
import { useAuth } from '../auth/AuthProvider'
import {
  parseAuthMode,
  parseSignInReason,
  safeNextPath,
} from '../lib/authRouting'
import {
  classifySignInError,
  getSignInErrorPresentation,
  type SignInErrorKind,
} from '../lib/signInErrors'
import { SamplePoster } from '../marketing/SamplePoster'
import '../marketing/public.css'

export function SignInPage() {
  const { t } = useI18n()
  useDocumentMetadata({
    title: t('{page} | Posterlytics', { page: t('Sign in') }),
    description: t('Sign in to your Posterlytics campaigns, posters, and placement data.'),
    canonical: 'https://posterlytics.insforge.site/signin',
  })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorKind, setErrorKind] = useState<SignInErrorKind | null>(null)
  const [busy, setBusy] = useState(false)
  const [recoveringPassword, setRecoveringPassword] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const sessionReasonSeededRef = useRef(false)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    user,
    loading,
    refresh,
    signInReason,
    clearSignInReason,
  } = useAuth()
  const mode = parseAuthMode(searchParams.get('mode'))
  const querySignInReason = parseSignInReason(searchParams.get('reason'))
  const noticeReason = querySignInReason ?? signInReason
  const nextPath = safeNextPath(searchParams.get('next'))

  useFocusOnChange(headingRef, recoveringPassword, {
    enabled: !recoveringPassword,
    focusOnMount: true,
  })

  useEffect(() => {
    if (!loading && user) navigate(nextPath, { replace: true })
  }, [loading, navigate, nextPath, user])

  useEffect(() => {
    if (!signInReason || sessionReasonSeededRef.current) return
    sessionReasonSeededRef.current = true
    if (!querySignInReason) {
      const params = new URLSearchParams(searchParams)
      params.set('reason', signInReason)
      setSearchParams(params, { replace: true })
    }
    clearSignInReason()
  }, [
    clearSignInReason,
    querySignInReason,
    searchParams,
    setSearchParams,
    signInReason,
  ])

  function changeMode(nextMode: 'signin' | 'signup') {
    const params = new URLSearchParams(searchParams)
    params.set('mode', nextMode)
    if (searchParams.has('next')) params.set('next', nextPath)
    setSearchParams(params, { replace: true })
    setRecoveringPassword(false)
    setErrorKind(null)
  }

  function returnToSignIn(recoveryEmail: string) {
    setEmail(recoveryEmail)
    setPassword('')
    changeMode('signin')
  }

  function startPasswordRecovery() {
    setErrorKind(null)
    setRecoveringPassword(true)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setErrorKind(null)
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await insforge.auth.signUp({ email, password })
        if (signUpError) throw signUpError
        if (!data?.accessToken) {
          const signIn = await insforge.auth.signInWithPassword({ email, password })
          if (signIn.error) throw signIn.error
        }
      } else {
        const { error: signInError } = await insforge.auth.signInWithPassword({ email, password })
        if (signInError) throw signInError
      }
      await refresh()
      navigate(nextPath, { replace: true })
    } catch (cause) {
      console.error('Authentication request failed', cause)
      setErrorKind(classifySignInError(cause))
    } finally {
      setBusy(false)
    }
  }

  const errorPresentation = errorKind
    ? getSignInErrorPresentation(errorKind, mode)
    : null

  return (
    <div className="public-auth">
      <Link to="/" className="public-brand public-auth-brand" aria-label={t('Posterlytics home')}>
        <span className="public-brand-mark" aria-hidden="true">P</span>
        <strong>Posterlytics</strong>
      </Link>
      <div className="public-auth-language">
        <LanguageSelect variant="public" />
      </div>

      <aside className="public-auth-visual" aria-label={t('Sample Posterlytics poster')}>
        <div className="public-auth-poster">
          <SamplePoster variant="field" priority />
        </div>
        <div className="public-auth-visual-note" aria-hidden="true">
          <span>WEBSITE / POSTER / SIGNAL</span>
          <span>PL / 001</span>
        </div>
      </aside>

      <main className="public-auth-main">
        <section className="public-auth-panel" aria-labelledby="auth-heading">
          {recoveringPassword ? (
            <button
              type="button"
              className="public-auth-back public-auth-back-button"
              onClick={() => returnToSignIn(email)}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              {t('Back to sign in')}
            </button>
          ) : (
            <Link to="/" className="public-auth-back">
              <ArrowLeft size={15} aria-hidden="true" />
              {t('Back to Posterlytics')}
            </Link>
          )}

          {recoveringPassword ? (
            <PasswordRecoveryFlow
              initialEmail={email}
              onEmailChange={setEmail}
              onReturnToSignIn={returnToSignIn}
            />
          ) : (
            <>
              <div className="public-auth-heading">
                <span>{t('Poster attribution workspace')}</span>
                <h1 ref={headingRef} id="auth-heading">
                  {mode === 'signin' ? t('Sign in') : t('Create an account')}
                </h1>
                <p>
                  {mode === 'signin'
                    ? t('Return to your campaigns, posters, and placement data.')
                    : t('Start with a product website and build the first campaign.')}
                </p>
              </div>

              <div className="public-auth-mode" aria-label={t('Authentication mode')}>
                <button
                  type="button"
                  className={mode === 'signin' ? 'is-active' : ''}
                  aria-pressed={mode === 'signin'}
                  onClick={() => changeMode('signin')}
                >
                  {t('Sign in')}
                </button>
                <button
                  type="button"
                  className={mode === 'signup' ? 'is-active' : ''}
                  aria-pressed={mode === 'signup'}
                  onClick={() => changeMode('signup')}
                >
                  {t('Create account')}
                </button>
              </div>

              {noticeReason === 'session_expired' && (
                <InlineNotice tone="warning">
                  {t('Your session ended. Sign in to continue.')}
                </InlineNotice>
              )}

              {loading || user ? (
                <div className="public-auth-loading" aria-label={t('Loading account')} aria-busy="true">
                  <span className="public-auth-skeleton" />
                  <span className="public-auth-skeleton" />
                  <span className="public-auth-skeleton" />
                </div>
              ) : (
                <form className="public-auth-form" onSubmit={handleSubmit}>
                  <div className="public-auth-field">
                    <label htmlFor="email">{t('Email')}</label>
                    <input
                      id="email"
                      type="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder={t('you@company.com')}
                      autoComplete="email"
                    />
                  </div>
                  <div className="public-auth-field">
                    <div className="public-auth-field-heading">
                      <label htmlFor="password">{t('Password')}</label>
                      {mode === 'signin' && (
                        <button
                          type="button"
                          className="public-auth-inline-button"
                          onClick={startPasswordRecovery}
                        >
                          {t('Forgot password?')}
                        </button>
                      )}
                    </div>
                    <input
                      id="password"
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={t('At least 6 characters')}
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    />
                  </div>

                  {errorPresentation && (
                    <InlineNotice tone="error">
                      <span>{t(errorPresentation.messageKey)}</span>
                      {errorPresentation.actions.map((action) => (
                        <button
                          key={action}
                          type="button"
                          className="public-auth-inline-button"
                          onClick={action === 'sign_in'
                            ? () => changeMode('signin')
                            : startPasswordRecovery}
                        >
                          {action === 'sign_in'
                            ? t('Sign in')
                            : t('Forgot password?')}
                        </button>
                      ))}
                    </InlineNotice>
                  )}

                  <button
                    className="public-button public-button-primary public-auth-submit"
                    disabled={busy}
                  >
                    {busy ? (
                      <>
                        <LoaderCircle className="is-spinning" size={16} aria-hidden="true" />
                        {mode === 'signup' ? t('Creating account') : t('Signing in')}
                      </>
                    ) : (
                      <>
                        {mode === 'signup' ? t('Create account') : t('Sign in')}
                        <ArrowRight size={16} aria-hidden="true" />
                      </>
                    )}
                  </button>
                  {mode === 'signup' && (
                    <>
                      {/* The cost answer belongs where the credentials are asked
                          for, not only on /terms. Order-153's complaint is that
                          signup requested an email and password without ever
                          saying what it costs. */}
                      <p className="public-auth-cost">
                        {t('Free, and no payment details. It is a personal demo project.')}
                      </p>
                      <p className="public-auth-consent">
                        {t('By creating an account, you agree to:')}{' '}
                        <Link to="/terms">{t('Terms of Service')}</Link>
                        <span aria-hidden="true"> / </span>
                        <Link to="/privacy">{t('Privacy Policy')}</Link>
                      </p>
                    </>
                  )}
                </form>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  )
}
