import { test } from 'node:test'
import assert from 'node:assert/strict'
import { truncateForTrace } from '../functions/_shared.ts'

test('truncateForTrace leaves small strings and objects intact', () => {
  assert.equal(truncateForTrace('hello'), 'hello')
  assert.deepEqual(truncateForTrace({ a: 1, b: 'x', c: true }), { a: 1, b: 'x', c: true })
  assert.deepEqual(truncateForTrace([1, 2, 3]), [1, 2, 3])
})

test('truncateForTrace caps a long string with a marker', () => {
  const long = 'a'.repeat(20_000)
  const out = truncateForTrace(long, 100) as string
  assert.ok(out.startsWith('a'.repeat(100)))
  assert.ok(out.includes('…[+19900 chars]'))
  assert.ok(out.length < 200)
})

test('truncateForTrace caps long string fields inside nested objects', () => {
  const out = truncateForTrace(
    { system: 'ok', response: { error: 'x'.repeat(5000) } },
    50,
  ) as { system: string; response: { error: string } }
  assert.equal(out.system, 'ok')
  assert.ok(out.response.error.includes('…[+4950 chars]'))
})

test('truncateForTrace handles null and undefined', () => {
  assert.equal(truncateForTrace(null), null)
  assert.equal(truncateForTrace(undefined), null)
  assert.deepEqual(truncateForTrace({ a: null, b: undefined }), { a: null, b: null })
})

test('truncateForTrace caps very large arrays to keep rows bounded', () => {
  const big = Array.from({ length: 500 }, (_, i) => i)
  const out = truncateForTrace(big) as number[]
  assert.equal(out.length, 50)
})
