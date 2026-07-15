import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeReferenceContext,
  normalizeReferenceImages,
  safeReferenceFilename,
  validateReferenceFiles,
} from '../src/lib/references.ts'

const image = (name = 'image.png', type = 'image/png', size = 1000) => ({ name, type, size })

test('reference validation accepts supported images within the count and size limits', () => {
  assert.equal(validateReferenceFiles(2, [image(), image('photo.webp', 'image/webp')]), null)
})

test('reference validation rejects excess, unsupported, empty, and oversized files', () => {
  assert.match(validateReferenceFiles(5, [image()]) ?? '', /up to 5/i)
  assert.match(validateReferenceFiles(0, [image('notes.pdf', 'application/pdf')]) ?? '', /JPEG, PNG, or WebP/)
  assert.match(validateReferenceFiles(0, [image('empty.png', 'image/png', 0)]) ?? '', /smaller than 10 MB/)
  assert.match(validateReferenceFiles(0, [image('large.png', 'image/png', 11 * 1024 * 1024)]) ?? '', /smaller than 10 MB/)
})

test('reference context trims, bounds, and nulls empty input', () => {
  assert.equal(normalizeReferenceContext('  launch audience  '), 'launch audience')
  assert.equal(normalizeReferenceContext('   '), null)
  assert.equal(normalizeReferenceContext('x'.repeat(5000))?.length, 4000)
})

test('reference image metadata is defensive and capped', () => {
  const values = Array.from({ length: 7 }, (_, i) => ({
    key: `key-${i}`,
    url: `https://example.com/${i}.png`,
    name: `image-${i}.png`,
    mime_type: 'image/png',
    size_bytes: 100,
  }))
  assert.equal(normalizeReferenceImages(values).length, 5)
  assert.deepEqual(normalizeReferenceImages([{ nope: true }]), [])
  assert.deepEqual(normalizeReferenceImages(null), [])
})

test('safeReferenceFilename removes path and punctuation noise', () => {
  assert.equal(safeReferenceFilename('../../Brand Mood (final).png'), 'Brand-Mood-final-.png')
  assert.equal(safeReferenceFilename('***'), 'reference-image')
})
