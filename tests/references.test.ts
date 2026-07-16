import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeReferenceContext,
  normalizeReferenceImages,
  partitionReferenceFiles,
  safeReferenceFilename,
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
