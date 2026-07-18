import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resetCodeErrorMessage,
  resetEmailErrorMessage,
  resetPasswordErrorMessage,
  shouldMaskResetEmailError,
  validateResetCode,
  validateResetEmail,
  validateResetPassword,
} from '../src/lib/passwordReset.ts'

test('password reset validation accepts only complete recovery inputs', () => {
  assert.equal(validateResetEmail(' person@example.com '), null)
  assert.equal(validateResetEmail('not-an-email'), 'Enter a valid email address.')
  assert.equal(validateResetCode('123456'), null)
  assert.equal(validateResetCode('12345'), 'Enter the 6-digit code from the email.')
  assert.equal(validateResetCode('12345a'), 'Enter the 6-digit code from the email.')
  assert.equal(validateResetPassword('new-password', 'new-password'), null)
  assert.equal(
    validateResetPassword('short', 'short'),
    'Password must be at least 6 characters.',
  )
  assert.equal(
    validateResetPassword('new-password', 'different-password'),
    'Passwords do not match.',
  )
})

test('reset email account errors are masked without hiding rate limits', () => {
  assert.equal(shouldMaskResetEmailError({ statusCode: 400 }), true)
  assert.equal(shouldMaskResetEmailError({ statusCode: 404 }), true)
  assert.equal(shouldMaskResetEmailError({ statusCode: 429 }), false)
  assert.equal(shouldMaskResetEmailError({ statusCode: 500 }), false)
  assert.equal(
    resetEmailErrorMessage({ statusCode: 429 }),
    'Too many reset requests. Wait a moment before trying again.',
  )
})

test('reset code and password errors use actionable messages', () => {
  assert.equal(
    resetCodeErrorMessage({ statusCode: 400 }),
    'That code is invalid or has expired. Check the email or request a new code.',
  )
  assert.equal(
    resetPasswordErrorMessage({
      statusCode: 400,
      message: 'Password is too weak',
    }),
    'Password must be at least 6 characters.',
  )
  assert.equal(
    resetPasswordErrorMessage({ statusCode: 400, message: 'Invalid reset token' }),
    'Your reset session has expired. Request a new code and try again.',
  )
})

test('password reset helpers return Chinese validation and operational copy', () => {
  assert.equal(
    validateResetEmail('not-an-email', 'zh-CN'),
    '请输入有效的邮箱地址。',
  )
  assert.equal(
    validateResetCode('123', 'zh-CN'),
    '输入邮件中的 6 位验证码。',
  )
  assert.equal(
    validateResetPassword('short', 'short', 'zh-CN'),
    '密码至少需要 6 个字符。',
  )
  assert.equal(
    resetEmailErrorMessage({ statusCode: 429 }, 'zh-CN'),
    '重置请求过于频繁，请稍后再试。',
  )
})
