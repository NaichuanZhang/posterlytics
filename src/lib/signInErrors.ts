import {
  isOfflineLikeError,
  readClientError,
} from './clientErrors'
import type { TranslationKey } from '../i18n/messages'
import type { AuthMode } from './authRouting'

export const SIGN_IN_ERROR_KINDS = [
  'credentials',
  'email_exists',
  'rate_limited',
  'weak_password',
  'offline',
  'unknown',
] as const

export type SignInErrorKind = (typeof SIGN_IN_ERROR_KINDS)[number]
export type SignInErrorAction = 'sign_in' | 'forgot_password'

export interface SignInErrorPresentation {
  messageKey: TranslationKey
  actions: readonly SignInErrorAction[]
}

const CREDENTIAL_ERROR_CODES = new Set([
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_USER_NOT_FOUND',
  'INVALID_CREDENTIALS',
])

const EMAIL_EXISTS_ERROR_CODES = new Set([
  'AUTH_EMAIL_EXISTS',
  'DATABASE_DUPLICATE',
  'ALREADY_EXISTS',
])

const RATE_LIMIT_ERROR_CODES = new Set([
  'TOO_MANY_REQUESTS',
  'RATE_LIMITED',
])

const WEAK_PASSWORD_ERROR_CODES = new Set([
  'AUTH_WEAK_PASSWORD',
])

const WEAK_PASSWORD_MESSAGE_PATTERN =
  /weak.{0,20}password|password.{0,20}(?:weak|short|length|characters|requirement)/i

const SIGN_IN_ERROR_PRESENTATIONS = {
  signin: {
    credentials: {
      messageKey: 'Invalid email or password.',
      actions: ['forgot_password'],
    },
    email_exists: {
      messageKey: 'Invalid email or password.',
      actions: ['forgot_password'],
    },
    rate_limited: {
      messageKey: 'Too many attempts. Wait a moment and try again.',
      actions: [],
    },
    weak_password: {
      messageKey: 'Authentication failed.',
      actions: [],
    },
    offline: {
      messageKey: 'Posterlytics could not connect. Check your internet connection and try again.',
      actions: [],
    },
    unknown: {
      messageKey: 'Authentication failed.',
      actions: [],
    },
  },
  signup: {
    credentials: {
      messageKey: 'Invalid email or password.',
      actions: [],
    },
    email_exists: {
      messageKey: 'An account with this email is already registered. Sign in or reset your password.',
      actions: ['sign_in', 'forgot_password'],
    },
    rate_limited: {
      messageKey: 'Too many attempts. Wait a moment and try again.',
      actions: [],
    },
    weak_password: {
      messageKey: 'This password was rejected. Choose a stronger password and try again.',
      actions: [],
    },
    offline: {
      messageKey: 'Posterlytics could not connect. Check your internet connection and try again.',
      actions: [],
    },
    unknown: {
      messageKey: 'Authentication failed.',
      actions: [],
    },
  },
} as const satisfies Record<
  AuthMode,
  Record<SignInErrorKind, SignInErrorPresentation>
>

export function classifySignInError(error: unknown): SignInErrorKind {
  const details = readClientError(error)
  if (
    CREDENTIAL_ERROR_CODES.has(details.code)
    || details.statusCode === 401
    || /invalid (?:login )?credentials|invalid email or password|incorrect email or password/i
      .test(details.message)
  ) {
    return 'credentials'
  }

  if (EMAIL_EXISTS_ERROR_CODES.has(details.code)) return 'email_exists'

  if (
    RATE_LIMIT_ERROR_CODES.has(details.code)
    || details.statusCode === 429
  ) {
    return 'rate_limited'
  }

  if (
    WEAK_PASSWORD_ERROR_CODES.has(details.code)
    || WEAK_PASSWORD_MESSAGE_PATTERN.test(details.message)
  ) {
    return 'weak_password'
  }

  if (isOfflineLikeError(error)) return 'offline'

  return 'unknown'
}

export function getSignInErrorPresentation(
  kind: SignInErrorKind,
  mode: AuthMode,
): SignInErrorPresentation {
  return SIGN_IN_ERROR_PRESENTATIONS[mode][kind]
}
