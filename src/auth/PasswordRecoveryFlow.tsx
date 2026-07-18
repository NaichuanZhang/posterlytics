import { ArrowLeft, ArrowRight, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { InlineNotice } from '../components/ui/Feedback'
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

const RESET_SENT_MESSAGE = 'If an account exists, a code was sent. Check your inbox and spam folder.'

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
    const validationError = validateResetEmail(normalizedEmail)
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
        setError(resetEmailErrorMessage(requestError))
        return
      }

      setEmail(normalizedEmail)
      onEmailChange(normalizedEmail)
      setCode('')
      setStatusMessage(RESET_SENT_MESSAGE)
      setResendSeconds(PASSWORD_RESET_RESEND_DELAY_SECONDS)
      setStep('code')
    } catch (cause) {
      setError(resetEmailErrorMessage(cause))
    } finally {
      setPendingAction(null)
    }
  }

  async function verifyResetCode(event: FormEvent) {
    event.preventDefault()
    const validationError = validateResetCode(code)
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
        setError(resetCodeErrorMessage(exchangeError))
        return
      }
      if (!data?.token) {
        setError(resetCodeErrorMessage(null))
        return
      }

      setResetToken(data.token)
      setStatusMessage(null)
      setStep('password')
    } catch (cause) {
      setError(resetCodeErrorMessage(cause))
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
        setError(resetEmailErrorMessage(resendError))
        return
      }

      setStatusMessage(RESET_SENT_MESSAGE)
      setResendSeconds(PASSWORD_RESET_RESEND_DELAY_SECONDS)
    } catch (cause) {
      setError(resetEmailErrorMessage(cause))
    } finally {
      setPendingAction(null)
    }
  }

  async function updatePassword(event: FormEvent) {
    event.preventDefault()
    const validationError = validateResetPassword(newPassword, confirmPassword)
    if (validationError) {
      setError(validationError)
      return
    }
    if (!resetToken) {
      setError('Your reset session has expired. Request a new code and try again.')
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
        setError(resetPasswordErrorMessage(updateError))
        return
      }

      setResetToken('')
      setNewPassword('')
      setConfirmPassword('')
      setStep('success')
    } catch (cause) {
      setError(resetPasswordErrorMessage(cause))
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
          eyebrow="Account recovery / Complete"
          title="Password updated"
          description="Sign in with your new password to return to your campaigns."
        />
        <div className="public-auth-form public-auth-success">
          <InlineNotice tone="success">Your password has been changed.</InlineNotice>
          <button
            type="button"
            className="public-button public-button-primary public-auth-submit"
            onClick={() => onReturnToSignIn(email)}
          >
            Sign in with new password
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
          eyebrow="Account recovery / 3 of 3"
          title="Create a new password"
          description={`Use at least ${PASSWORD_RESET_MIN_LENGTH} characters.`}
        />
        <form
          className="public-auth-form public-auth-recovery-form"
          onSubmit={updatePassword}
          noValidate
        >
          <div className="public-auth-field">
            <label htmlFor="reset-new-password">New password</label>
            <input
              id="reset-new-password"
              type="password"
              required
              minLength={PASSWORD_RESET_MIN_LENGTH}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder={`At least ${PASSWORD_RESET_MIN_LENGTH} characters`}
              autoComplete="new-password"
              disabled={busy}
              autoFocus
            />
          </div>
          <div className="public-auth-field">
            <label htmlFor="reset-confirm-password">Confirm new password</label>
            <input
              id="reset-confirm-password"
              type="password"
              required
              minLength={PASSWORD_RESET_MIN_LENGTH}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repeat your new password"
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
                Updating password
              </>
            ) : (
              <>
                Reset password
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
            Start over
          </button>
        </form>
      </>
    )
  }

  if (step === 'code') {
    return (
      <>
        <RecoveryHeading
          eyebrow="Account recovery / 2 of 3"
          title="Enter the code"
          description="Enter the 6-digit code from the reset email."
        />
        <form
          className="public-auth-form public-auth-recovery-form"
          onSubmit={verifyResetCode}
          noValidate
        >
          <div className="public-auth-field">
            <label htmlFor="reset-code">Reset code</label>
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
              Change email
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
              {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : 'Resend code'}
            </button>
          </div>

          <button
            className="public-button public-button-primary public-auth-submit"
            disabled={busy}
          >
            {pendingAction === 'verify' ? (
              <>
                <LoaderCircle className="is-spinning" size={16} aria-hidden="true" />
                Verifying code
              </>
            ) : (
              <>
                Verify code
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
        eyebrow="Account recovery / 1 of 3"
        title="Reset your password"
        description="Enter the email address you use for Posterlytics."
      />
      <form className="public-auth-form public-auth-recovery-form" onSubmit={requestResetCode} noValidate>
        <div className="public-auth-field">
          <label htmlFor="reset-email">Email</label>
          <input
            id="reset-email"
            type="email"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              onEmailChange(event.target.value)
            }}
            placeholder="you@company.com"
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
              Sending code
            </>
          ) : (
            <>
              Send reset code
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
