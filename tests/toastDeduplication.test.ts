import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendToast, type ToastItem } from '../src/lib/toast.ts'

const first: ToastItem = {
  id: 1,
  message: 'Poster ready',
  tone: 'success',
  dedupeKey: 'generation:notification-1',
}

test('toast deduplication keeps one visible outcome per notification', () => {
  const current = [first]
  const duplicate = appendToast(current, { ...first, id: 2 })
  assert.equal(duplicate, current)
  assert.equal(duplicate.length, 1)
})

test('toasts without a dedupe key remain independent', () => {
  const next = appendToast([first], {
    id: 2,
    message: 'Campaign saved',
    tone: 'info',
  })
  assert.equal(next.length, 2)
})
