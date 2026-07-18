import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  nextWorkerStage,
  responseFailure,
  thrownFailure,
} from '../functions/_workerPolicy.ts'

test('worker stage routing skips deterministic event layout work', () => {
  assert.equal(nextWorkerStage('analyze', 'product'), 'designer')
  assert.equal(nextWorkerStage('analyze', 'event'), 'hero')
  assert.equal(nextWorkerStage('designer', 'product'), 'hero')
  assert.equal(nextWorkerStage('hero', 'product'), null)
})

test('explicit stage retry classification overrides wrapper HTTP status', () => {
  assert.equal(responseFailure(502, {
    error: 'invalid model JSON',
    retryable: false,
  }).retryable, false)
  assert.equal(responseFailure(502, {
    error: 'upstream unavailable',
    retryable: true,
  }).retryable, true)
})

test('unclassified worker failures retry only network, 408, 429, and 5xx errors', () => {
  assert.equal(responseFailure(408, null).retryable, true)
  assert.equal(responseFailure(429, null).retryable, true)
  assert.equal(responseFailure(503, null).retryable, true)
  assert.equal(responseFailure(400, null).retryable, false)
  assert.equal(thrownFailure(new TypeError('fetch failed')).retryable, true)
  assert.equal(thrownFailure({ message: 'bad input', status: 400 }).retryable, false)
  assert.equal(thrownFailure({
    message: 'permanent provider failure',
    status: 503,
    retryable: false,
  }).retryable, false)
})
