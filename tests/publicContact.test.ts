import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ISSUE_TRACKER_LABEL,
  ISSUE_TRACKER_URL,
  OPERATOR_NAME,
  SOURCE_REPOSITORY_LABEL,
  SOURCE_REPOSITORY_URL,
} from '../src/lib/publicContact.ts'

// Order-153 asked the public surface to name an operator and offer a route that
// actually reaches someone. These assertions guard the two ways that promise can
// rot: a tracker URL that stops matching its repository, and a published label
// that stops matching the href a visitor is actually sent to.

test('the issue tracker is derived from the source repository', () => {
  assert.equal(ISSUE_TRACKER_URL, `${SOURCE_REPOSITORY_URL}/issues`)
  assert.equal(ISSUE_TRACKER_LABEL, `${SOURCE_REPOSITORY_LABEL}/issues`)
})

test('published link text matches the destination it sends visitors to', () => {
  // A label that disagrees with its href is a phishing pattern, and here it
  // would also be a support route the visitor cannot verify before clicking.
  assert.equal(ISSUE_TRACKER_URL, `https://${ISSUE_TRACKER_LABEL}`)
  assert.equal(SOURCE_REPOSITORY_URL, `https://${SOURCE_REPOSITORY_LABEL}`)
})

test('the contact route is an https GitHub URL, not an email address', () => {
  // No mailto is published: an unread address is worse than naming the tracker
  // that is actually watched.
  for (const url of [SOURCE_REPOSITORY_URL, ISSUE_TRACKER_URL]) {
    assert.ok(url.startsWith('https://github.com/'), `not an https GitHub URL: ${url}`)
    assert.ok(!url.includes('mailto:'), `unexpected mailto in ${url}`)
    assert.ok(!url.includes('@'), `unexpected address in ${url}`)
  }
})

test('an operator is actually named', () => {
  assert.ok(OPERATOR_NAME.trim().length > 0)
  // Guard against a placeholder shipping to a page meant to establish trust.
  for (const placeholder of ['TODO', 'TBD', 'example', 'your name']) {
    assert.ok(
      !OPERATOR_NAME.toLowerCase().includes(placeholder.toLowerCase()),
      `operator name looks like a placeholder: ${OPERATOR_NAME}`,
    )
  }
})
