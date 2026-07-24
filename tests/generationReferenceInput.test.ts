import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveGenerationReferenceInput } from '../src/lib/generationReferenceInput.ts'

test('first required version without pending references does not meet the minimum', () => {
  assert.deepEqual(resolveGenerationReferenceInput({
    requirement: 'required',
    minimumCount: 1,
    firstVersion: true,
    allowPersistedReuse: true,
    persistedCount: 2,
    pendingCount: 0,
  }), {
    requiredCount: 1,
    effectiveCount: 0,
    reusePersisted: false,
    minimumMet: false,
  })
})

test('first required version meets the minimum with a pending reference', () => {
  assert.deepEqual(resolveGenerationReferenceInput({
    requirement: 'required',
    minimumCount: 1,
    firstVersion: true,
    allowPersistedReuse: true,
    persistedCount: 0,
    pendingCount: 1,
  }), {
    requiredCount: 1,
    effectiveCount: 1,
    reusePersisted: false,
    minimumMet: true,
  })
})

test('later required version reuses persisted references when no replacement is pending', () => {
  assert.deepEqual(resolveGenerationReferenceInput({
    requirement: 'required',
    minimumCount: 1,
    firstVersion: false,
    allowPersistedReuse: true,
    persistedCount: 2,
    pendingCount: 0,
  }), {
    requiredCount: 1,
    effectiveCount: 2,
    reusePersisted: true,
    minimumMet: true,
  })
})

test('later required version without persisted or pending references remains blocked', () => {
  assert.deepEqual(resolveGenerationReferenceInput({
    requirement: 'required',
    minimumCount: 1,
    firstVersion: false,
    allowPersistedReuse: true,
    persistedCount: 0,
    pendingCount: 0,
  }), {
    requiredCount: 1,
    effectiveCount: 0,
    reusePersisted: false,
    minimumMet: false,
  })
})

test('pending references replace persisted references instead of adding to them', () => {
  assert.deepEqual(resolveGenerationReferenceInput({
    requirement: 'required',
    minimumCount: 1,
    firstVersion: false,
    allowPersistedReuse: true,
    persistedCount: 4,
    pendingCount: 2,
  }), {
    requiredCount: 1,
    effectiveCount: 2,
    reusePersisted: false,
    minimumMet: true,
  })
})

test('optional references with a zero minimum always meet the minimum', () => {
  for (const { input, expected } of [
    {
      input: { firstVersion: true, persistedCount: 0, pendingCount: 0 },
      expected: { requiredCount: 0, effectiveCount: 0, reusePersisted: false, minimumMet: true },
    },
    {
      input: { firstVersion: false, persistedCount: 0, pendingCount: 0 },
      expected: { requiredCount: 0, effectiveCount: 0, reusePersisted: false, minimumMet: true },
    },
    {
      input: { firstVersion: false, persistedCount: 3, pendingCount: 2 },
      expected: { requiredCount: 0, effectiveCount: 2, reusePersisted: false, minimumMet: true },
    },
  ]) {
    assert.deepEqual(resolveGenerationReferenceInput({
      requirement: 'optional',
      minimumCount: 0,
      allowPersistedReuse: true,
      ...input,
    }), expected)
  }
})

test('an effective count below a larger configured minimum remains blocked', () => {
  assert.deepEqual(resolveGenerationReferenceInput({
    requirement: 'required',
    minimumCount: 2,
    firstVersion: false,
    allowPersistedReuse: true,
    persistedCount: 1,
    pendingCount: 0,
  }), {
    requiredCount: 2,
    effectiveCount: 1,
    reusePersisted: true,
    minimumMet: false,
  })
})
