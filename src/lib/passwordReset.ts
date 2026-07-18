import {
  DEFAULT_LOCALE,
  translate,
  type SupportedLocale,
} from './i18n'

export const PASSWORD_RESET_MIN_LENGTH = 6
export const PASSWORD_RESET_CODE_LENGTH = 6
export const PASSWORD_RESET_RESEND_DELAY_SECONDS = 30

interface AuthErrorLike {
  message?: unknown
  statusCode?: unknown
}

function authErrorDetails(error: unknown) {
  if (!error || typeof error !== 'object') {
    return { message: '', statusCode: null }
  }

  const candidate = error as AuthErrorLike
  return {
    message: typeof candidate.message === 'string' ? candidate.message : '',
    statusCode: typeof candidate.statusCode === 'number' ? candidate.statusCode : null,
  }
}

export function shouldMaskResetEmailError(error: unknown): boolean {
  const { statusCode } = authErrorDetails(error)
  return statusCode !== null
    && statusCode >= 400
    && statusCode < 500
    && statusCode !== 429
}

export function resetEmailErrorMessage(
  error: unknown,
  locale: SupportedLocale = DEFAULT_LOCALE,
): string {
  const { statusCode } = authErrorDetails(error)
  if (statusCode === 429) {
    return translate(locale, 'Too many reset requests. Wait a moment before trying again.')
  }
  return translate(locale, 'We could not send a reset code right now. Check your connection and try again.')
}

export function resetCodeErrorMessage(
  error: unknown,
  locale: SupportedLocale = DEFAULT_LOCALE,
): string {
  const { statusCode } = authErrorDetails(error)
  if ([400, 401, 403, 404, 410].includes(statusCode ?? 0)) {
    return translate(locale, 'That code is invalid or has expired. Check the email or request a new code.')
  }
  if (statusCode === 429) {
    return translate(locale, 'Too many verification attempts. Wait a moment before trying again.')
  }
  return translate(locale, 'We could not verify that code. Try again or request a new one.')
}

export function resetPasswordErrorMessage(
  error: unknown,
  locale: SupportedLocale = DEFAULT_LOCALE,
): string {
  const { message, statusCode } = authErrorDetails(error)
  if (
    /(at least|minimum|too short|weak.{0,20}password|password.{0,20}(weak|length|characters))/i
      .test(message)
  ) {
    return translate(locale, 'Password must be at least {count} characters.', {
      count: PASSWORD_RESET_MIN_LENGTH,
    })
  }
  if ([400, 401, 403, 404, 410].includes(statusCode ?? 0)) {
    return translate(locale, 'Your reset session has expired. Request a new code and try again.')
  }
  if (statusCode === 429) {
    return translate(locale, 'Too many reset attempts. Wait a moment before trying again.')
  }
  return translate(locale, 'We could not reset your password right now. Try again.')
}

export function validateResetEmail(
  email: string,
  locale: SupportedLocale = DEFAULT_LOCALE,
): string | null {
  if (!/^[^\s@]+@[^\s@]+$/.test(email.trim())) {
    return translate(locale, 'Enter a valid email address.')
  }
  return null
}

export function validateResetCode(
  code: string,
  locale: SupportedLocale = DEFAULT_LOCALE,
): string | null {
  const codePattern = new RegExp(`^\\d{${PASSWORD_RESET_CODE_LENGTH}}$`)
  if (!codePattern.test(code)) {
    return translate(locale, 'Enter the {count}-digit code from the email.', {
      count: PASSWORD_RESET_CODE_LENGTH,
    })
  }
  return null
}

export function validateResetPassword(
  newPassword: string,
  confirmPassword: string,
  locale: SupportedLocale = DEFAULT_LOCALE,
): string | null {
  if (newPassword.length < PASSWORD_RESET_MIN_LENGTH) {
    return translate(locale, 'Password must be at least {count} characters.', {
      count: PASSWORD_RESET_MIN_LENGTH,
    })
  }
  if (newPassword !== confirmPassword) {
    return translate(locale, 'Passwords do not match.')
  }
  return null
}
