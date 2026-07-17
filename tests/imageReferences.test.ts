import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTraceContentManifest,
  imageGenerationContent,
  inlineImageReferences,
  orderImageReferences,
  orderPainterImageReferences,
  prepareImageReferences,
  type TypedImageReference,
} from '../functions/_shared.ts'

function reference(
  kind: TypedImageReference['kind'],
  url: string,
): TypedImageReference {
  return { kind, url, purpose: `${kind} purpose` }
}

test('source references are ordered style board, users, logo, then product', () => {
  const ordered = orderImageReferences([
    reference('product', 'product'),
    reference('logo', 'logo'),
    reference('user-reference', 'user-1'),
    reference('style-board', 'board'),
    reference('user-reference', 'user-2'),
  ])
  assert.deepEqual(ordered.map((item) => item.url), [
    'board',
    'user-1',
    'user-2',
    'logo',
    'product',
  ])
})

test('painter references prioritize previous poster, new references, authentic assets, then style board', () => {
  const ordered = orderPainterImageReferences([
    reference('style-board', 'board'),
    reference('product', 'product'),
    reference('logo', 'logo'),
    reference('user-reference', 'user-1'),
    reference('previous-poster', 'previous'),
    reference('user-reference', 'user-2'),
  ])
  assert.deepEqual(ordered.map((item) => item.url), [
    'previous',
    'user-1',
    'user-2',
    'logo',
    'product',
    'board',
  ])
})

test('duplicate URLs retain the highest-priority reference purpose', () => {
  const selected = orderImageReferences([
    reference('product', 'shared'),
    reference('style-board', 'shared'),
    reference('logo', 'logo'),
  ])
  assert.equal(selected[0].kind, 'style-board')
  assert.deepEqual(selected.map((item) => item.url), ['shared', 'logo'])
})

test('painter reference selection caps at six before lower-priority evidence', () => {
  const selected = orderPainterImageReferences([
    reference('previous-poster', 'previous'),
    reference('logo', 'logo'),
    reference('product', 'product'),
    ...Array.from({ length: 5 }, (_, index) =>
      reference('user-reference', `user-${index}`)
    ),
    reference('style-board', 'board'),
  ], 6)
  assert.equal(selected.length, 6)
  assert.equal(selected[0].kind, 'previous-poster')
  assert.ok(selected.slice(1).every((item) => item.kind === 'user-reference'))
})

test('failed higher-priority references allow later logo/product fallbacks', async () => {
  const selected = await inlineImageReferences([
    reference('style-board', 'data:image/svg+xml;base64,PHN2Zy8+'),
    reference('user-reference', 'data:image/png;base64,AAAA'),
    reference('logo', 'data:image/jpeg;base64,BBBB'),
  ], { maxImages: 2 })
  assert.deepEqual(selected.map((item) => item.kind), ['user-reference', 'logo'])
})

test('typed painter content labels every purpose and keeps six image parts', () => {
  const content = imageGenerationContent('paint it', [
    reference('previous-poster', 'previous'),
    reference('logo', 'logo'),
    ...Array.from({ length: 4 }, (_, index) =>
      reference('user-reference', `user-${index}`)
    ),
    reference('style-board', 'board'),
  ], 6, 'painter') as Array<Record<string, unknown>>
  const labels = content.filter((part) => part.type === 'text')
  const images = content.filter((part) => part.type === 'image_url')
  assert.equal(images.length, 6)
  assert.equal(labels.length, 7)
  assert.match(String(labels[1].text), /PREVIOUS-POSTER/)
  assert.match(String(labels[2].text), /USER-REFERENCE/)
})

test('prepared image audit exactly matches painter order and strips request-only data URLs', async () => {
  const prepared = await prepareImageReferences([
    reference('style-board', 'https://cdn.example/board.jpg?token=private'),
    reference('product', 'https://cdn.example/product.png'),
    reference('previous-poster', 'https://cdn.example/previous.png'),
    reference('user-reference', 'https://cdn.example/support.png'),
  ], {
    ordering: 'painter',
    fetcher: async (url) => ({
      ok: true,
      dataUrl: `data:image/png;base64,${url.length.toString(16).padStart(4, '0')}`,
      mimeType: 'image/png',
      sizeBytes: 100,
    }),
  })

  assert.deepEqual(prepared.attachedImages.map((image) => image.source), [
    'previous-poster',
    'user-reference',
    'product',
    'style-board',
  ])
  assert.deepEqual(prepared.attachedImages.map((image) => image.model_position), [1, 2, 3, 4])
  assert.ok(prepared.providerReferences.every((image) => image.url.startsWith('data:image/')))
  assert.ok(prepared.attachedImages.every((image) => !image.url?.includes('token=')))
})

test('prepared image audit records missing, duplicate, candidate, and fetch skip reasons', async () => {
  const prepared = await prepareImageReferences([
    reference('previous-poster', ''),
    reference('style-board', 'shared'),
    reference('product', 'shared'),
    reference('user-reference', 'fetch-failed'),
    reference('logo', 'unsupported'),
    reference('product', 'empty'),
    reference('product', 'too-large'),
    reference('product', 'beyond-candidates'),
  ], {
    maxCandidates: 5,
    maxImages: 6,
    fetcher: async (url) => {
      if (url === 'fetch-failed') {
        return { ok: false, reason: 'fetch_failed', detail: 'failed' }
      }
      if (url === 'unsupported') {
        return { ok: false, reason: 'unsupported_format', detail: 'unsupported' }
      }
      if (url === 'empty') {
        return { ok: false, reason: 'empty_image', detail: 'empty' }
      }
      if (url === 'too-large') {
        return { ok: false, reason: 'image_too_large', detail: 'large', sizeBytes: 99 }
      }
      return { ok: true, dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png', sizeBytes: 3 }
    },
  })

  assert.deepEqual(new Set(prepared.skippedImages.map((skip) => skip.reason)), new Set([
    'missing_url',
    'duplicate',
    'candidate_limit',
    'fetch_failed',
    'unsupported_format',
    'empty_image',
    'image_too_large',
  ]))
})

test('prepared image audit applies model count and total byte budgets from the same result', async () => {
  const fetcher = async () => ({
    ok: true as const,
    dataUrl: 'data:image/png;base64,AAAA',
    mimeType: 'image/png',
    sizeBytes: 60,
  })
  const countLimited = await prepareImageReferences([
    reference('user-reference', 'one'),
    reference('user-reference', 'two'),
    reference('logo', 'three'),
  ], { maxImages: 2, fetcher })
  assert.equal(countLimited.attachedImages.length, 2)
  assert.equal(countLimited.skippedImages.at(-1)?.reason, 'image_limit')

  const byteLimited = await prepareImageReferences([
    reference('user-reference', 'one'),
    reference('logo', 'two'),
  ], { maxImages: 2, maxTotalBytes: 100, fetcher })
  assert.equal(byteLimited.attachedImages.length, 1)
  assert.equal(byteLimited.skippedImages.at(-1)?.reason, 'byte_budget')
})

test('trace manifest mirrors provider content order without inline images or authorization data', async () => {
  const prepared = await prepareImageReferences([
    {
      ...reference('logo', 'https://cdn.example/logo.png?signature=secret'),
      key: 'brand/logo.png',
    },
  ], {
    fetcher: async () => ({
      ok: true,
      dataUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/png',
      sizeBytes: 3,
    }),
  })
  const content = imageGenerationContent(
    'Paint it. Authorization: Bearer top-secret-token',
    prepared.providerReferences,
    6,
    'painter',
  ) as unknown[]
  const manifest = buildTraceContentManifest(
    [{ role: 'user', content }],
    prepared.attachedImages,
  )

  assert.deepEqual(
    manifest.map((part) => part.type),
    (content as Array<{ type: string }>).map((part) =>
      part.type === 'image_url' ? 'image' : 'text'
    ),
  )
  const serialized = JSON.stringify(manifest)
  assert.doesNotMatch(serialized, /data:image/)
  assert.doesNotMatch(serialized, /top-secret-token/)
  assert.doesNotMatch(serialized, /signature=secret/)
  assert.match(serialized, /brand\/logo\.png/)
})
