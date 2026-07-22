import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildCampaignDraftData,
  campaignDraftKey,
  isCampaignDraftDirty,
  parseCampaignDraft,
  restoreCampaignEagerCapture,
  serializeCampaignDraft,
} from '../src/lib/campaignDraft.ts'
import {
  clearAllLocalDrafts,
  LOCAL_DRAFT_MAX_AGE_MS,
  rehydrateLocalDraftReferences,
  type LocalDraftStorage,
} from '../src/lib/localDraft.ts'

const NOW_MS = Date.parse('2026-07-22T12:00:00.000Z')
const OWNER_ID = 'user/one'

test('campaign drafts round-trip serializable wizard state without file bytes', () => {
  const file = new File(['private image bytes'], 'product.png', {
    type: 'image/png',
  })
  const eagerCapture = {
    preview: {
      sourceUrl: 'https://example.com/product',
      captureId: '10000000-0000-4000-8000-000000000001',
      capturedAt: '2026-07-22T11:55:00.000Z',
      colorScheme: 'dark' as const,
      designTokens: {},
      styleBoardDataUrl: 'data:image/jpeg;base64,cHJpdmF0ZQ==',
      logoUrl: null,
      imageUrls: ['https://example.com/product.png'],
      colors: ['#ffffff'],
      fonts: ['Archivo'],
    },
    selection: {
      imageUrls: ['https://example.com/product.png'],
      logoExcluded: true,
    },
  }
  const data = buildCampaignDraftData({
    selectedUseCaseId: 'website_product',
    productUrl: 'https://example.com/product',
    productName: 'Signal Studio',
    tagline: 'Make it visible',
    ctaText: 'Try now',
    destinationUrl: 'https://example.com/start',
    posterFormat: 'a4_2x3',
    platformHint: '',
    referenceContext: 'Keep the approved headline.',
    pendingReferences: [
      { id: 'file-1', kind: 'file', file },
      {
        id: 'url-1',
        kind: 'url',
        url: 'https://assets.example/product.webp#preview',
        name: 'product.webp',
        previewStatus: 'ready',
      },
    ],
    serverCampaignId: 'campaign-draft',
    eagerCapture,
  })

  const serialized = serializeCampaignDraft(OWNER_ID, data, NOW_MS)
  const parsed = parseCampaignDraft(serialized, OWNER_ID, NOW_MS)

  assert.deepEqual(parsed?.data, {
    ...data,
    eagerCapture: {
      ...data.eagerCapture,
      sourceUrl: 'https://example.com/product',
    },
  })
  assert.equal(serialized.includes('private image bytes'), false)
  assert.equal(serialized.includes('data:image/jpeg'), false)
  assert.equal(serialized.includes('styleBoardDataUrl'), false)
  assert.deepEqual(parsed?.data.references[0], {
    kind: 'file',
    name: 'product.png',
    size: file.size,
    type: 'image/png',
  })

  const restored = rehydrateLocalDraftReferences(
    parsed?.data.references ?? [],
    () => 'fresh-url-id',
  )
  assert.deepEqual(restored.unrestorableFiles, [{
    kind: 'file',
    name: 'product.png',
    size: file.size,
    type: 'image/png',
  }])
  assert.deepEqual(restored.pendingReferences, [{
    id: 'fresh-url-id',
    kind: 'url',
    url: 'https://assets.example/product.webp',
    name: 'product.webp',
    previewStatus: 'loading',
  }])
  assert.equal(isCampaignDraftDirty(data), true)
  assert.equal(
    campaignDraftKey(OWNER_ID),
    'posterlytics.campaignDraft.v1:user%2Fone',
  )
  assert.equal(restoreCampaignEagerCapture({
    metadata: parsed?.data.eagerCapture ?? null,
    availableCapture: null,
    productUrl: 'https://example.com/product',
    useCase: 'website_product',
    colorScheme: 'dark',
    nowMs: NOW_MS,
  }), null)
  assert.deepEqual(restoreCampaignEagerCapture({
    metadata: parsed?.data.eagerCapture ?? null,
    availableCapture: eagerCapture,
    productUrl: 'https://example.com/product',
    useCase: 'website_product',
    colorScheme: 'dark',
    nowMs: NOW_MS,
  }), eagerCapture)
})

test('campaign draft round-trip preserves mixed reference insertion order', () => {
  const firstFile = new File(['first'], 'first.png', { type: 'image/png' })
  const secondFile = new File(['second'], 'second.webp', {
    type: 'image/webp',
  })
  const data = buildCampaignDraftData({
    selectedUseCaseId: 'website_product',
    productUrl: '',
    productName: '',
    tagline: '',
    ctaText: 'Get started',
    destinationUrl: '',
    posterFormat: 'a4_2x3',
    platformHint: '',
    referenceContext: '',
    pendingReferences: [
      { id: 'first-file', kind: 'file', file: firstFile },
      {
        id: 'middle-url',
        kind: 'url',
        url: 'https://assets.example/middle.png',
        name: 'middle.png',
        previewStatus: 'ready',
      },
      { id: 'second-file', kind: 'file', file: secondFile },
    ],
    serverCampaignId: null,
    eagerCapture: null,
  })

  const parsed = parseCampaignDraft(
    serializeCampaignDraft(OWNER_ID, data, NOW_MS),
    OWNER_ID,
    NOW_MS,
  )

  assert.deepEqual(parsed?.data.references, [
    {
      kind: 'file',
      name: 'first.png',
      size: firstFile.size,
      type: 'image/png',
    },
    {
      kind: 'url',
      url: 'https://assets.example/middle.png',
      name: 'middle.png',
    },
    {
      kind: 'file',
      name: 'second.webp',
      size: secondFile.size,
      type: 'image/webp',
    },
  ])
})

test('campaign draft reader rejects malformed, partial, incompatible, foreign, and expired envelopes', () => {
  const valid = validEnvelope()
  assert.equal(parseCampaignDraft('{broken', OWNER_ID, NOW_MS), null)
  assert.equal(parseCampaignDraft(JSON.stringify({
    ...valid,
    data: { ...valid.data, productName: undefined },
  }), OWNER_ID, NOW_MS), null)
  assert.equal(parseCampaignDraft(JSON.stringify({
    ...valid,
    data: { ...valid.data, selectedUseCaseId: undefined },
  }), OWNER_ID, NOW_MS), null)
  assert.equal(parseCampaignDraft(JSON.stringify({
    ...valid,
    data: { ...valid.data, references: undefined },
  }), OWNER_ID, NOW_MS), null)
  assert.equal(parseCampaignDraft(JSON.stringify({
    ...valid,
    version: 2,
  }), OWNER_ID, NOW_MS), null)
  assert.equal(parseCampaignDraft(
    JSON.stringify({ ...valid, ownerId: 'someone-else' }),
    OWNER_ID,
    NOW_MS,
  ), null)
  assert.equal(parseCampaignDraft(JSON.stringify({
    ...valid,
    updatedAt: new Date(NOW_MS + 1).toISOString(),
  }), OWNER_ID, NOW_MS), null)
  assert.equal(parseCampaignDraft(JSON.stringify({
    ...valid,
    updatedAt: new Date(NOW_MS - LOCAL_DRAFT_MAX_AGE_MS - 1).toISOString(),
  }), OWNER_ID, NOW_MS), null)
  assert.ok(parseCampaignDraft(JSON.stringify({
    ...valid,
    updatedAt: new Date(NOW_MS - LOCAL_DRAFT_MAX_AGE_MS).toISOString(),
  }), OWNER_ID, NOW_MS))
})

test('campaign draft reader filters URLs and repairs disabled use cases and formats', () => {
  const envelope = validEnvelope()
  envelope.data.selectedUseCaseId = 'event'
  envelope.data.posterFormat = 'yt_thumb_16x9'
  envelope.data.references = [
    { kind: 'url', url: 'http://assets.example/insecure.png', name: 'bad' },
    {
      kind: 'url',
      url: 'https://assets.example/one.png#first',
      name: 'one.png',
    },
    {
      kind: 'url',
      url: 'https://assets.example/one.png#duplicate',
      name: 'duplicate.png',
    },
    { kind: 'file', name: 'script.svg', size: 12, type: 'image/svg+xml' },
  ]

  const disabled = parseCampaignDraft(
    JSON.stringify(envelope),
    OWNER_ID,
    NOW_MS,
  )
  assert.equal(disabled?.data.selectedUseCaseId, null)
  assert.equal(disabled?.data.posterFormat, 'yt_thumb_16x9')
  assert.deepEqual(disabled?.data.references, [{
    kind: 'url',
    url: 'https://assets.example/one.png',
    name: 'one.png',
  }])

  envelope.data.selectedUseCaseId = 'social_cover'
  const repaired = parseCampaignDraft(
    JSON.stringify(envelope),
    OWNER_ID,
    NOW_MS,
  )
  assert.equal(repaired?.data.posterFormat, 'rednote_cover_3x4')
})

test('clearAllLocalDrafts removes campaign and editor drafts without touching preferences', () => {
  const storage = new MemoryStorage([
    ['posterlytics.campaignDraft.v1:user', 'campaign'],
    ['posterlytics.editorDraft.v1:user:campaign', 'editor'],
    ['posterlytics.workspacePreferences.v1', 'preferences'],
  ])

  clearAllLocalDrafts(storage)

  assert.equal(storage.getItem('posterlytics.campaignDraft.v1:user'), null)
  assert.equal(storage.getItem('posterlytics.editorDraft.v1:user:campaign'), null)
  assert.equal(
    storage.getItem('posterlytics.workspacePreferences.v1'),
    'preferences',
  )
  assert.doesNotThrow(() => clearAllLocalDrafts({
    get length() {
      throw new Error('blocked')
    },
    key: () => null,
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }))
})

function validEnvelope() {
  return JSON.parse(serializeCampaignDraft(OWNER_ID, buildCampaignDraftData({
    selectedUseCaseId: 'website_product',
    productUrl: '',
    productName: '',
    tagline: '',
    ctaText: 'Get started',
    destinationUrl: '',
    posterFormat: 'a4_2x3',
    platformHint: '',
    referenceContext: '',
    pendingReferences: [],
    serverCampaignId: null,
    eagerCapture: null,
  }), NOW_MS))
}

class MemoryStorage implements LocalDraftStorage {
  private readonly values: Map<string, string>

  constructor(entries: Array<[string, string]> = []) {
    this.values = new Map(entries)
  }

  get length() {
    return this.values.size
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}
