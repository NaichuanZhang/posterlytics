import { test } from 'node:test'
import assert from 'node:assert/strict'
import { materializePendingReferences } from '../src/lib/referenceMaterialization.ts'
import type { PendingReference } from '../src/lib/references.ts'
import type { ReferenceImage } from '../src/lib/types.ts'

function stored(name: string): ReferenceImage {
  return {
    key: `references/${name}`,
    url: `https://cdn.example.com/${name}`,
    name,
    mime_type: 'image/png',
    size_bytes: 8,
  }
}

const references: PendingReference[] = [
  {
    id: 'file-1',
    kind: 'file',
    file: { name: 'first.png' } as File,
  },
  {
    id: 'url-1',
    kind: 'url',
    url: 'https://example.com/second.png',
    name: 'second.png',
    previewStatus: 'ready',
  },
  {
    id: 'file-2',
    kind: 'file',
    file: { name: 'third.png' } as File,
  },
]

test('mixed references materialize sequentially in display order', async () => {
  const calls: string[] = []
  const result = await materializePendingReferences(references, {
    uploadFile: async ({ file }) => {
      calls.push(`file:${file.name}`)
      return stored(file.name)
    },
    importUrl: async ({ name }) => {
      calls.push(`url:${name}`)
      return stored(name)
    },
    remove: async () => {
      calls.push('remove')
    },
  })

  assert.deepEqual(calls, ['file:first.png', 'url:second.png', 'file:third.png'])
  assert.deepEqual(result.map((image) => image.name), ['first.png', 'second.png', 'third.png'])
})

test('materialization removes every completed object when a later import fails', async () => {
  const removed: string[][] = []
  await assert.rejects(
    materializePendingReferences(references, {
      uploadFile: async ({ file }) => stored(file.name),
      importUrl: async () => {
        throw new Error('import failed')
      },
      remove: async (images) => {
        removed.push(images.map((image) => image.name))
      },
    }),
    /import failed/,
  )

  assert.deepEqual(removed, [['first.png']])
})
