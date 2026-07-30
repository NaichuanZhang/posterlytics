import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  CAPTURE_PREVIEW_LIMIT_PER_10_MINUTES,
  CAPTURE_PREVIEW_LIMIT_PER_DAY,
} from '../src/lib/publicLimits.ts'

const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')

test('the publicly stated capture quota is the one the server enforces', () => {
  // The terms page quotes these numbers. If someone retunes the RPC without
  // updating the constants, the public page would state a limit that is not
  // real — so bind the copy's source of truth to the SQL that admits work.
  assert.match(
    baseline,
    new RegExp(
      `IF v_short_count < ${CAPTURE_PREVIEW_LIMIT_PER_10_MINUTES}`
      + ` AND v_daily_count < ${CAPTURE_PREVIEW_LIMIT_PER_DAY} THEN`,
    ),
  )
  // And that those counts are measured over the windows the copy names.
  assert.match(baseline, /attempted_at > v_now - INTERVAL '10 minutes'/)
  assert.match(baseline, /attempted_at > v_now - INTERVAL '24 hours'/)
})

test('no paid-plan claim is smuggled into the limits module', () => {
  const source = readFileSync(
    new URL('../src/lib/publicLimits.ts', import.meta.url),
    'utf8',
  )
  // There is no price, tier, or payment path in this product. Keeping the module
  // free of them means the public copy cannot imply one.
  for (const forbidden of [/\$\d/, /\bper month\b/i, /\bsubscription\b/i]) {
    assert.doesNotMatch(source, forbidden)
  }
})
