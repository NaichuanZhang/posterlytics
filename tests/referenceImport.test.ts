import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ReferenceImportError,
  assertPublicHttpsUrl,
  fetchPublicReferenceImage,
  importedReferenceFilename,
  isPrivateOrReservedAddress,
} from '../functions/_shared.ts'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb])
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
])
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
const resolvePublic = async () => ['93.184.216.34']

test('private and reserved IPv4 and IPv6 targets are blocked', () => {
  for (const address of [
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.20.0.1',
    '192.0.2.1',
    '192.168.1.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
  ]) {
    assert.equal(isPrivateOrReservedAddress(address), true, address)
  }
  assert.equal(isPrivateOrReservedAddress('8.8.8.8'), false)
  assert.equal(isPrivateOrReservedAddress('2606:4700:4700::1111'), false)
})

test('public URL validation requires HTTPS, no credentials, and public DNS', async () => {
  await assert.rejects(
    assertPublicHttpsUrl('http://example.com/image.png', resolvePublic),
    (error: unknown) => error instanceof ReferenceImportError && error.code === 'https_required',
  )
  await assert.rejects(
    assertPublicHttpsUrl('https://user:secret@example.com/image.png', resolvePublic),
    (error: unknown) =>
      error instanceof ReferenceImportError && error.code === 'credentials_not_allowed',
  )
  await assert.rejects(
    assertPublicHttpsUrl('https://private.example/image.png', async () => ['10.0.0.8']),
    (error: unknown) => error instanceof ReferenceImportError && error.code === 'unsafe_target',
  )
  const url = await assertPublicHttpsUrl('https://example.com/image.png', resolvePublic)
  assert.equal(url.hostname, 'example.com')
})

test('image fetch validates every redirect and preserves the final URL', async () => {
  const calls: string[] = []
  const result = await fetchPublicReferenceImage('https://origin.example/start', {
    resolveHostname: resolvePublic,
    fetchImpl: async (url) => {
      calls.push(String(url))
      if (String(url).includes('origin.example')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example/final%20image.png' },
        })
      }
      return new Response(PNG, { status: 200, headers: { 'content-type': 'text/plain' } })
    },
  })

  assert.deepEqual(calls, [
    'https://origin.example/start',
    'https://cdn.example/final%20image.png',
  ])
  assert.equal(result.mimeType, 'image/png')
  assert.equal(result.finalUrl.hostname, 'cdn.example')
})

test('image fetch blocks a redirect to a private network before requesting it', async () => {
  let fetchCount = 0
  await assert.rejects(
    fetchPublicReferenceImage('https://origin.example/start', {
      resolveHostname: resolvePublic,
      fetchImpl: async () => {
        fetchCount += 1
        return new Response(null, {
          status: 302,
          headers: { location: 'https://127.0.0.1/metadata' },
        })
      },
    }),
    (error: unknown) => error instanceof ReferenceImportError && error.code === 'unsafe_target',
  )
  assert.equal(fetchCount, 1)
})

test('image fetch rejects credentials and non-HTTPS protocols introduced by redirects', async () => {
  for (const location of [
    'https://user:secret@example.com/image.png',
    'http://example.com/image.png',
  ]) {
    await assert.rejects(
      fetchPublicReferenceImage('https://origin.example/start', {
        resolveHostname: resolvePublic,
        fetchImpl: async () => new Response(null, {
          status: 302,
          headers: { location },
        }),
      }),
      ReferenceImportError,
    )
  }
})

test('image fetch allows three redirects and rejects a fourth', async () => {
  let redirect = 0
  await assert.rejects(
    fetchPublicReferenceImage('https://one.example/image', {
      resolveHostname: resolvePublic,
      fetchImpl: async () => {
        redirect += 1
        return new Response(null, {
          status: 302,
          headers: { location: `https://hop-${redirect}.example/image` },
        })
      },
    }),
    (error: unknown) =>
      error instanceof ReferenceImportError && error.code === 'too_many_redirects',
  )
  assert.equal(redirect, 4)
})

test('image fetch accepts JPEG, PNG, and WebP by magic bytes and rejects GIF', async () => {
  for (const [bytes, expected] of [
    [JPEG, 'image/jpeg'],
    [PNG, 'image/png'],
    [WEBP, 'image/webp'],
  ] as const) {
    const result = await fetchPublicReferenceImage('https://example.com/image', {
      resolveHostname: resolvePublic,
      fetchImpl: async () => new Response(bytes),
    })
    assert.equal(result.mimeType, expected)
  }

  await assert.rejects(
    fetchPublicReferenceImage('https://example.com/image.gif', {
      resolveHostname: resolvePublic,
      fetchImpl: async () => new Response(GIF),
    }),
    (error: unknown) => error instanceof ReferenceImportError && error.code === 'unsupported_image',
  )
})

test('image fetch enforces declared and streamed size limits', async () => {
  await assert.rejects(
    fetchPublicReferenceImage('https://example.com/large.png', {
      resolveHostname: resolvePublic,
      maxBytes: 8,
      fetchImpl: async () => new Response(PNG, {
        headers: { 'content-length': '9' },
      }),
    }),
    (error: unknown) => error instanceof ReferenceImportError && error.code === 'image_too_large',
  )
  await assert.rejects(
    fetchPublicReferenceImage('https://example.com/large.png', {
      resolveHostname: resolvePublic,
      maxBytes: 7,
      fetchImpl: async () => new Response(PNG),
    }),
    (error: unknown) => error instanceof ReferenceImportError && error.code === 'image_too_large',
  )
})

test('image fetch applies its timeout to DNS resolution', async () => {
  await assert.rejects(
    fetchPublicReferenceImage('https://slow.example/image.png', {
      timeoutMs: 5,
      resolveHostname: async () => new Promise<string[]>(() => {}),
      fetchImpl: async () => new Response(PNG),
    }),
    (error: unknown) => error instanceof ReferenceImportError && error.code === 'download_timeout',
  )
})

test('imported image names are URL-derived and corrected to the detected MIME', () => {
  assert.equal(
    importedReferenceFilename(
      new URL('https://cdn.example/assets/Brand%20Hero.jpeg?version=2'),
      'image/png',
    ),
    'Brand-Hero.png',
  )
  assert.equal(
    importedReferenceFilename(new URL('https://cdn.example/assets/'), 'image/webp'),
    'reference-image.webp',
  )
})
