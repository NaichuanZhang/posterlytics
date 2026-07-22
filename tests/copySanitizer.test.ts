import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  sanitizeModelCopy,
  sanitizeModelCopyList,
  type ModelCopyPolicy,
} from '../functions/_copySanitizer.ts'

test('sanitizeModelCopy is idempotent and preserves CJK copy', () => {
  const source = '城市咖啡地图，今天出发'
  const once = sanitizeModelCopy(source)

  assert.equal(once, source)
  assert.equal(sanitizeModelCopy(once), once)
})

test('sanitizeModelCopy preserves text-default pictographic symbols', () => {
  const source = '™ © ® ㊗ ㊙ 〰 〽 Brand®'

  assert.equal(sanitizeModelCopy(source), source)
  assert.equal(sanitizeModelCopy('Brand®'), 'Brand®')
  assert.equal(sanitizeModelCopy('™️ ©️ ®️ ㊗️ ㊙️ 〰️ 〽️'), '')
})

test('sanitizeModelCopy removes only unapproved color-emoji sequences', () => {
  const source = 'Launch 🚀 ❤️ 1️⃣ 🇺🇸 👩🏽‍💻 👍🏽 ™ © ® ㊗ ㊙'

  assert.equal(sanitizeModelCopy(source), 'Launch ™ © ® ㊗ ㊙')
})

test('sanitizeModelCopy preserves emoji sourced from campaign copy', () => {
  const policy: ModelCopyPolicy = {
    emojiSourceTexts: ['Café ☕ Roasters'],
  }

  assert.equal(
    sanitizeModelCopy('Visit Café ☕ Roasters ☕ 🚀', 280, policy),
    'Visit Café ☕ Roasters ☕',
  )
})

test('sanitizeModelCopy protects embedded doubled source names', () => {
  const policy: ModelCopyPolicy = {
    verbatimTexts: [
      'Plan a week in Bora Bora',
      'The Sirius Sirius launch',
      'Fresh mahi mahi daily',
      'Music by Duran Duran',
      'Meet us in Walla Walla',
    ],
  }

  assert.equal(
    sanitizeModelCopy('Bora Bora escapes, booked in seconds', 280, policy),
    'Bora Bora escapes, booked in seconds',
  )
  assert.equal(
    sanitizeModelCopy('Meet Sirius Sirius tonight', 280, policy),
    'Meet Sirius Sirius tonight',
  )
  assert.equal(
    sanitizeModelCopy('Try our mahi mahi plate', 280, policy),
    'Try our mahi mahi plate',
  )
  assert.equal(
    sanitizeModelCopy('Duran Duran plays Walla Walla', 280, policy),
    'Duran Duran plays Walla Walla',
  )
})

test('sanitizeModelCopy collapses genuine adjacent Latin duplication', () => {
  assert.equal(sanitizeModelCopy('Fast Fast checkout'), 'Fast checkout')
  assert.equal(sanitizeModelCopy('Very Fast Fast checkout'), 'Very Fast checkout')
  assert.equal(sanitizeModelCopy('Fast Fast Fast checkout'), 'Fast checkout')
})

test('sanitizeModelCopy collapses repeated separators and trims trailing ones', () => {
  assert.equal(
    sanitizeModelCopy('Fast · · simple || reliable — —'),
    'Fast · simple | reliable',
  )
})

test('sanitizeModelCopy preserves CJK-adjacent punctuation', () => {
  assert.equal(
    sanitizeModelCopy('秋日限定——现磨咖啡'),
    '秋日限定——现磨咖啡',
  )
  assert.equal(sanitizeModelCopy('值得一试——'), '值得一试——')
  assert.equal(sanitizeModelCopy('乔治·华盛顿'), '乔治·华盛顿')
  assert.equal(sanitizeModelCopy('好看·好用·好价'), '好看·好用·好价')
})

const PLACEHOLDERS = [
  'headline',
  '{headline}',
  '[headline]',
  'YOUR HEADLINE',
  'subheadline',
  'tagline',
  'title',
  'subtitle',
  'body copy',
  'copy',
  'CTA',
  'call to action',
  'button text',
  'description',
  'feature',
  'features',
  'logo',
  'your logo',
  'brand logo',
  'company logo',
  'get started',
  'sign up',
  'product name',
  'brand name',
  'company name',
  'placeholder',
  'TBD',
  'TODO',
  'Lorem ipsum',
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
] as const

test('sanitizeModelCopy rejects sole-content placeholders after NFKC', () => {
  for (const placeholder of PLACEHOLDERS) {
    assert.equal(
      sanitizeModelCopy(placeholder),
      '',
      `expected placeholder rejection for ${placeholder}`,
    )
  }
  assert.equal(sanitizeModelCopy('［headline］'), '')
  assert.equal(sanitizeModelCopy('Logo'), '')
  assert.equal(sanitizeModelCopy('Get Started'), '')
  assert.equal(sanitizeModelCopy('{Get Started}'), '')
  assert.equal(sanitizeModelCopy('A headline for builders'), 'A headline for builders')
  assert.equal(sanitizeModelCopy('Our logo shines'), 'Our logo shines')
  assert.equal(sanitizeModelCopy('Learn more'), 'Learn more')
})

test('sanitizeModelCopyList drops rejected items and bounds each item', () => {
  assert.deepEqual(
    sanitizeModelCopyList(
      ['[headline]', 'Ready 🚀', 'Fast Fast setup', 'Third item'],
      3,
      10,
    ),
    ['Ready', 'Fast setup', 'Third item'],
  )
})

test('sanitizeModelCopy bounds Unicode by code point', () => {
  const policy = {
    verbatimTexts: ['A😀B'],
    emojiSourceTexts: ['A😀B'],
  }
  const bounded = sanitizeModelCopy('A😀B', 2, policy)

  assert.equal(bounded, 'A😀')
  assert.equal(Array.from(bounded).length, 2)
})

test('sanitizeModelCopy is idempotent when bounding after a separator', () => {
  const once = sanitizeModelCopy('Fast — checkout', 7)

  assert.equal(sanitizeModelCopy(once, 7), once)
  assert.doesNotMatch(once, /[·|—\s]$/u)
})
