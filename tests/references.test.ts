import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createPendingUrlReference,
  normalizeReferenceContext,
  normalizeReferenceImages,
  parseDroppedReferenceUrls,
  partitionReferenceUrls,
  partitionReferenceFiles,
  pendingReferencesReady,
  referenceNameFromUrl,
  safeReferenceFilename,
  validateReferenceUrl,
} from '../src/lib/references.ts'

const image = (name = 'image.png', type = 'image/png', size = 1000) => ({ name, type, size })

test('reference file partition accepts valid files from a mixed batch', () => {
  const result = partitionReferenceFiles(0, [
    image('first.png'),
    image('notes.pdf', 'application/pdf'),
    image('second.webp', 'image/webp'),
    image('large.jpg', 'image/jpeg', 11 * 1024 * 1024),
  ])

  assert.deepEqual(result.accepted.map((file) => file.name), ['first.png', 'second.webp'])
  assert.deepEqual(result.rejected, [
    { filename: 'notes.pdf', reason: 'type' },
    { filename: 'large.jpg', reason: 'size' },
  ])
})

test('reference file partition reports unsupported formats per file', () => {
  const result = partitionReferenceFiles(0, [
    image('animation.gif', 'image/gif'),
    image('document.pdf', 'application/pdf'),
  ])

  assert.deepEqual(result.accepted, [])
  assert.deepEqual(result.rejected, [
    { filename: 'animation.gif', reason: 'type' },
    { filename: 'document.pdf', reason: 'type' },
  ])
})

test('reference file partition rejects empty and oversized images', () => {
  const result = partitionReferenceFiles(0, [
    image('empty.png', 'image/png', 0),
    image('large.png', 'image/png', 10 * 1024 * 1024 + 1),
    image('limit.png', 'image/png', 10 * 1024 * 1024),
  ])

  assert.deepEqual(result.accepted.map((file) => file.name), ['limit.png'])
  assert.deepEqual(result.rejected, [
    { filename: 'empty.png', reason: 'size' },
    { filename: 'large.png', reason: 'size' },
  ])
})

test('reference file partition fills remaining capacity in input order', () => {
  const result = partitionReferenceFiles(3, [
    image('first.jpg', 'image/jpeg'),
    image('second.png'),
    image('third.webp', 'image/webp'),
    image('fourth.png'),
  ])

  assert.deepEqual(result.accepted.map((file) => file.name), ['first.jpg', 'second.png'])
  assert.deepEqual(result.rejected, [
    { filename: 'third.webp', reason: 'capacity' },
    { filename: 'fourth.png', reason: 'capacity' },
  ])
})

test('reference file partition preserves valid input ordering around rejections', () => {
  const first = image('one.webp', 'image/webp')
  const second = image('two.jpg', 'image/jpeg')
  const result = partitionReferenceFiles(1, [
    image('skip.txt', 'text/plain'),
    first,
    image('empty.png', 'image/png', 0),
    second,
  ])

  assert.deepEqual(result.accepted, [first, second])
})

test('reference file partition rejects valid files at full capacity', () => {
  const result = partitionReferenceFiles(5, [
    image('first.png'),
    image('second.jpg', 'image/jpeg'),
  ])

  assert.deepEqual(result.accepted, [])
  assert.deepEqual(result.rejected, [
    { filename: 'first.png', reason: 'capacity' },
    { filename: 'second.jpg', reason: 'capacity' },
  ])
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

test('reference URLs normalize HTTPS syntax and derive a readable name', () => {
  assert.deepEqual(
    validateReferenceUrl('  https://EXAMPLE.com:443/assets/Brand%20Hero.PNG#preview  '),
    {
      ok: true,
      url: 'https://example.com/assets/Brand%20Hero.PNG',
      name: 'Brand-Hero.PNG',
    },
  )
  assert.equal(referenceNameFromUrl('https://images.example.com/'), 'images.example.com-image')
})

test('reference URL validation rejects invalid, non-HTTPS, and credentialed URLs', () => {
  assert.deepEqual(validateReferenceUrl('not a URL'), { ok: false, reason: 'invalid' })
  assert.deepEqual(
    validateReferenceUrl('http://example.com/image.png'),
    { ok: false, reason: 'protocol' },
  )
  assert.deepEqual(
    validateReferenceUrl('https://user:secret@example.com/image.png'),
    { ok: false, reason: 'credentials' },
  )
})

test('reference URL partition rejects normalized duplicates and shares file capacity', () => {
  const result = partitionReferenceUrls(3, ['https://example.com/one.png#old'], [
    'https://EXAMPLE.com:443/one.png#new',
    'https://example.com/two.webp',
    'https://example.com/three.jpg',
    'https://example.com/four.png',
  ])

  assert.deepEqual(result.accepted.map((item) => item.url), [
    'https://example.com/two.webp',
    'https://example.com/three.jpg',
  ])
  assert.deepEqual(result.rejected.map((item) => item.reason), ['duplicate', 'capacity'])
})

test('dropped URI lists ignore comments and preserve link ordering', () => {
  assert.deepEqual(
    parseDroppedReferenceUrls(
      '# browser metadata\nhttps://example.com/first.png\n\nhttps://example.com/second.webp\r\n',
    ),
    ['https://example.com/first.png', 'https://example.com/second.webp'],
  )
})

test('pending URL references are ready only after their preview loads', () => {
  const reference = createPendingUrlReference({
    url: 'https://example.com/image.png',
    name: 'image.png',
  })
  assert.equal(pendingReferencesReady([reference]), false)
  assert.equal(pendingReferencesReady([{ ...reference, previewStatus: 'ready' }]), true)
  assert.equal(pendingReferencesReady([{ ...reference, previewStatus: 'error' }]), false)
})
