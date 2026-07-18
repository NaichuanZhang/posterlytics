import { ArrowLeft, ArrowRight, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { InlineNotice } from '../components/ui/Feedback'
import { useI18n } from '../i18n/I18nProvider'
import { insforge } from '../lib/insforge'
import {
  PASSWORD_RESET_CODE_LENGTH,
  PASSWORD_RESET_MIN_LENGTH,
  PASSWORD_RESET_RESEND_DELAY_SECONDS,
  resetCodeErrorMessage,
  resetEmailErrorMessage,
  resetPasswordErrorMessage,
  shouldMaskResetEmailError,
  validateResetCode,
  validateResetEmail,
  validateResetPassword,
} from '../lib/passwordReset'

type RecoveryStep = 'email' | 'code' | 'password' | 'success'
type PendingAction = 'request' | 'verify' | 'resend' | 'reset'

interface PasswordRecoveryFlowProps {
  initialEmail: string
  onEmailChange: (email: string) => void
  onReturnToSignIn: (email: string) => void
}

export function PasswordRecoveryFlow({
  initialEmail,
  onEmailChange,
  onReturnToSignIn,
}: PasswordRecoveryFlowProps) {
  const { locale, t } = useI18n()
  const [step, setStep] = useState<RecoveryStep>('email')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [resendSeconds, setResendSeconds] = useState(0)
  const busy = pendingAction !== null

  useEffect(() => {
    if (resendSeconds <= 0) return
    const timer = window.setTimeout(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [resendSeconds])

  async function requestResetCode(event: FormEvent) {
    event.preventDefault()
    const normalizedEmail = email.trim()
    const validationError = validateResetEmail(normalizedEmail, locale)
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setStatusMessage(null)
    setPendingAction('request')
    try {
      const { error: requestError } = await insforge.auth.sendResetPasswordEmail({
        email: normalizedEmail,
      })
      if (requestError && !shouldMaskResetEmailError(requestError)) {
        setError(resetEmailErrorMessage(requestError, locale))
        return
      }

      setEmail(normalizedEmail)
      onEmailChange(normalizedEmail)
      setCode('')
      setStatusMessage(t('If an account exists, a code was sent. Check your inbox and spam folder.'))
      setResendSeconds(PASSWORD_RESET_RESEND_DELAY_SECONDS)
      setStep('code')
    } catch (cause) {
      setError(resetEmailErrorMessage(cause, locale))
    } finally {
      setPendingAction(null)
    }
  }

  async function verifyResetCode(event: FormEvent) {
    event.preventDefault()
    const validationError = validateResetCode(code, locale)
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setPendingAction('verify')
    try {
      const { data, error: exchangeError } = await insforge.auth.exchangeResetPasswordToken({
        email,
        code,
      })
      if (exchangeError) {
        setError(resetCodeErrorMessage(exchangeError, locale))
        return
      }
      if (!data?.token) {
        setError(resetCodeErrorMessage(null, locale))
        return
      }

      setResetToken(data.token)
      setStatusMessage(null)
      setStep('password')
    } catch (cause) {
      setError(resetCodeErrorMessage(cause, locale))
    } finally {
      setPendingAction(null)
    }
  }

  async function resendResetCode() {
    if (busy || resendSeconds > 0) return

    setError(null)
    setStatusMessage(null)
    setPendingAction('resend')
    try {
      const { error: resendError } = await insforge.auth.sendResetPasswordEmail({ email })
      if (resendError && !shouldMaskResetEmailError(resendError)) {
        setError(resetEmailErrorMessage(resendError, locale))
        return
      }

      setStatusMessage(t('If an account exists, a code was sent. Check your inbox and spam folder.'))
      setResendSeconds(PASSWORD_RESET_RESEND_DELAY_SECONDS)
    } catch (cause) {
      setError(resetEmailErrorMessage(cause, locale))
    } finally {
      setPendingAction(null)
    }
  }

  async function updatePassword(event: FormEvent) {
    event.preventDefault()
    const validationError = validateResetPassword(newPassword, confirmPassword, locale)
    if (validationError) {
      setError(validationError)
      return
    }
    if (!resetToken) {
      setError(t('Your reset session has expired. Request a new code and try again.'))
      return
    }

    setError(null)
    setPendingAction('reset')
    try {
      const { error: updateError } = await insforge.auth.resetPassword({
        newPassword,
        otp: resetToken,
      })
      if (updateError) {
        setError(resetPasswordErrorMessage(updateError, locale))
        return
      }

      setResetToken('')
      setNewPassword('')
      setConfirmPassword('')
      setStep('success')
    } catch (cause) {
      setError(resetPasswordErrorMessage(cause, locale))
    } finally {
      setPendingAction(null)
    }
  }

  function returnToEmailStep() {
    setStep('email')
    setCode('')
    setResetToken('')
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
    setStatusMessage(null)
  }

  if (step === 'success') {
    return (
      <>
        <RecoveryHeading
          eyebrow={t('Account recovery / Complete')}
          title={t('Password updated')}
          description={t('Sign in with your new password to return to your campaigns.')}
        />
        <div className="public-auth-form public-auth-success">
          <InlineNotice tone="success">{t('Your password has been changed.')}</InlineNotice>
          <button
            type="button"
            className="public-button public-button-primary public-auth-submit"
            onClick={() => onReturnToSignIn(email)}
          >
            {t('Sign in with new password')}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </>
    )
  }

  if (step === 'password') {
    return (
      <>
        <RecoveryHeading
          eyebrow={t('Account recovery / 3 of 3')}
          title={t('Create a new password')}
          description={t('Use at least {count} characters.', {
            count: PASSWORD_RESET_MIN_LENGTH,
          })}
        />
        <form
          className="public-auth-form public-auth-recovery-form"
          onSubmit={updatePassword}
          noValidate
        >
          <div className="public-auth-field">
            <label htmlFor="reset-new-password">{t('New password')}</label>
            <input
              id="reset-new-password"
              type="password"
              required
              minLength={PASSWORD_RESET_MIN_LENGTH}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder={t('At least {count} characters', {
                count: PASSWORD_RESET_MIN_LENGTH,
              })}
              autoComplete="new-password"
              disabled={busy}
              autoFocus
            />
          </div>
          <div className="public-auth-field">
            <label htmlFor="reset-confirm-password">{t('Confirm new password')}</label>
            <input
              id="reset-confirm-password"
              type="password"
              required
              minLength={PASSWORD_RESET_MIN_LENGTH}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder={t('Repeat your new password')}
              autoComplete="new-password"
              disabled={busy}
            />
          </div>

          {error && <InlineNotice tone="error">{error}</InlineNotice>}

          <button
            className="public-button public-button-primary public-auth-submit"
            disabled={busy}
          >
            {pendingAction === 'reset' ? (
              <>
                <LoaderCircle className="is-spinning" size={16} aria-hidden="true" />
                {t('Updating password')}
              </>
            ) : (
              <>
                {t('Reset password')}
                <ArrowRight size={16} aria-hidden="true" />
              </>
            )}
          </button>
          <button
            type="button"
            className="public-auth-inline-button public-auth-back-step"
            onClick={returnToEmailStep}
            disabled={busy}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            {t('Start over')}
          </button>
        </form>
      </>
    )
  }

  if (step === 'code') {
    return (
      <>
        <RecoveryHeading
          eyebrow={t('Account recovery / 2 of 3')}
          title={t('Enter the code')}
          description={t('Enter the {count}-digit code from the reset email.', {
            count: PASSWORD_RESET_CODE_LENGTH,
          })}
        />
        <form
          className="public-auth-form public-auth-recovery-form"
          onSubmit={verifyResetCode}
          noValidate
        >
          <div className="public-auth-field">
            <label htmlFor="reset-code">{t('Reset code')}</label>
            <input
              id="reset-code"
              type="text"
              required
              inputMode="numeric"
              pattern={`[0-9]{${PASSWORD_RESET_CODE_LENGTH}}`}
              maxLength={PASSWORD_RESET_CODE_LENGTH}
              value={code}
              onChange={(event) => {
                setCode(
                  event.target.value
                    .replace(/\D/g, '')
                    .slice(0, PASSWORD_RESET_CODE_LENGTH),
                )
              }}
              placeholder="000000"
              autoComplete="one-time-code"
              disabled={busy}
              autoFocus
            />
          </div>

          {statusMessage && <InlineNotice tone="info">{statusMessage}</InlineNotice>}
          {error && <InlineNotice tone="error">{error}</InlineNotice>}

          <div className="public-auth-recovery-meta">
            <button
              type="button"
              className="public-auth-inline-button"
              onClick={returnToEmailStep}
              disabled={busy}
            >
              {t('Change email')}
            </button>
            <button
              type="button"
              className="public-auth-inline-button"
              onClick={resendResetCode}
              disabled={busy || resendSeconds > 0}
            >
              <RefreshCw
                className={pendingAction === 'resend' ? 'is-spinning' : ''}
                size={13}
                aria-hidden="true"
              />
              {resendSeconds > 0
                ? t('Resend in {count}s', { count: resendSeconds })
                : t('Resend code')}
            </button>
          </div>

          <button
            className="public-button public-button-primary public-auth-submit"
            disabled={busy}
          >
            {pendingAction === 'verify' ? (
              <>
                <LoaderCircle className="is-spinning" size={16} aria-hidden="true" />
                {t('Verifying code')}
              </>
            ) : (
              <>
                {t('Verify code')}
                <ArrowRight size={16} aria-hidden="true" />
              </>
            )}
          </button>
        </form>
      </>
    )
  }

  return (
    <>
      <RecoveryHeading
        eyebrow={t('Account recovery / 1 of 3')}
        title={t('Reset your password')}
        description={t('Enter the email address you use for Posterlytics.')}
      />
      <form className="public-auth-form public-auth-recovery-form" onSubmit={requestResetCode} noValidate>
        <div className="public-auth-field">
          <label htmlFor="reset-email">{t('Email')}</label>
          <input
            id="reset-email"
            type="email"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              onEmailChange(event.target.value)
            }}
            placeholder={t('you@company.com')}
            autoComplete="email"
            disabled={busy}
            autoFocus
          />
        </div>

        {error && <InlineNotice tone="error">{error}</InlineNotice>}

        <button
          className="public-button public-button-primary public-auth-submit"
          disabled={busy}
        >
          {pendingAction === 'request' ? (
            <>
              <LoaderCircle className="is-spinning" size={16} aria-hidden="true" />
              {t('Sending code')}
            </>
          ) : (
            <>
              {t('Send reset code')}
              <ArrowRight size={16} aria-hidden="true" />
            </>
          )}
        </button>
      </form>
    </>
  )
}

function RecoveryHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="public-auth-heading">
      <span>{eyebrow}</span>
      <h1 id="auth-heading">{title}</h1>
      <p>{description}</p>
    </div>
  )
}
