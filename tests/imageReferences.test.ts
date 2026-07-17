import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  imageGenerationContent,
  inlineImageReferences,
  orderImageReferences,
  orderPainterImageReferences,
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
