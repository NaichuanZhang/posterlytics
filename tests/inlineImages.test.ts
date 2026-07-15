import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sniffImageMime, fetchImageAsDataUrl } from '../functions/_shared.ts'

// Magic-byte constants — sourced from actual PNG/JPEG/WebP/GIF headers.
const PNG_HEADER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_HEADER = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])
const WEBP_HEADER = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
])
const GIF_HEADER = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])

test('sniffImageMime recognizes PNG magic bytes', () => {
  assert.equal(sniffImageMime(PNG_HEADER), 'image/png')
})

test('sniffImageMime recognizes JPEG magic bytes', () => {
  assert.equal(sniffImageMime(JPEG_HEADER), 'image/jpeg')
})

test('sniffImageMime recognizes WebP RIFF/WEBP magic bytes', () => {
  assert.equal(sniffImageMime(WEBP_HEADER), 'image/webp')
})

test('sniffImageMime recognizes GIF magic bytes', () => {
  assert.equal(sniffImageMime(GIF_HEADER), 'image/gif')
})

test('sniffImageMime returns null for SVG/XML/text bytes', () => {
  const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')
  const xmlBytes = new TextEncoder().encode('<?xml version="1.0"?>')
  const textBytes = new TextEncoder().encode('this is not an image')
  assert.equal(sniffImageMime(svgBytes), null)
  assert.equal(sniffImageMime(xmlBytes), null)
  assert.equal(sniffImageMime(textBytes), null)
})

test('sniffImageMime returns null for empty input', () => {
  assert.equal(sniffImageMime(new Uint8Array()), null)
})

test('fetchImageAsDataUrl passes through raster data URLs unchanged', async () => {
  // 1x1 transparent PNG.
  const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  assert.equal(await fetchImageAsDataUrl(src), src)
})

test('fetchImageAsDataUrl rejects SVG data URLs (image models cannot consume SVG)', async () => {
  const svgSrc = 'data:image/svg+xml;utf8,<svg/>'
  assert.equal(await fetchImageAsDataUrl(svgSrc), null)
})

test('fetchImageAsDataUrl rejects non-image data URLs', async () => {
  const textSrc = 'data:text/plain;base64,aGVsbG8='
  assert.equal(await fetchImageAsDataUrl(textSrc), null)
})
