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

test('campaign drafts round-trip serializable creation state without file bytes', () => {
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
    sourceUrls: ['https://example.com/product'],
    productName: 'Signal Studio',
    tagline: 'Make it visible',
    destinationUrl: 'https://example.com/start',
    posterFormat: 'a4_2x3',
    outputKind: 'poster',
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
    'posterlytics.campaignDraft.v2:user%2Fone',
  )
  assert.equal(restoreCampaignEagerCapture({
    metadata: parsed?.data.eagerCapture ?? null,
    availableCapture: null,
    sourceUrls: ['https://example.com/product'],
    outputKind: 'poster',
    colorScheme: 'dark',
    nowMs: NOW_MS,
  }), null)
  assert.deepEqual(restoreCampaignEagerCapture({
    metadata: parsed?.data.eagerCapture ?? null,
    availableCapture: eagerCapture,
    sourceUrls: ['https://example.com/product'],
    outputKind: 'poster',
    colorScheme: 'dark',
    nowMs: NOW_MS,
  }), eagerCapture)
})

test('a pristine unified form is not dirty; each field flips it', () => {
  const pristine = buildCampaignDraftData({
    sourceUrls: [],
    productName: '',
    tagline: '',
    destinationUrl: '',
    posterFormat: 'a4_2x3',
    outputKind: 'poster',
    referenceContext: '',
    pendingReferences: [],
    serverCampaignId: null,
    eagerCapture: null,
  })
  assert.equal(isCampaignDraftDirty(pristine), false)

  assert.equal(isCampaignDraftDirty({ ...pristine, sourceUrls: ['https://a.example'] }), true)
  assert.equal(isCampaignDraftDirty({ ...pristine, productName: 'Named' }), true)
  assert.equal(isCampaignDraftDirty({ ...pristine, outputKind: 'post' }), true)
  assert.equal(isCampaignDraftDirty({ ...pristine, posterFormat: 'luma_1x1' }), true)
  assert.equal(isCampaignDraftDirty({ ...pristine, referenceContext: 'x' }), true)
})

test('the source URL list normalizes on build and round-trips', () => {
  const data = buildCampaignDraftData({
    sourceUrls: ['  https://a.example ', '', 'https://a.example', 'https://b.example', 'https://c.example', 'https://d.example'],
    productName: '',
    tagline: '',
    destinationUrl: '',
    posterFormat: 'a4_2x3',
    outputKind: 'poster',
    referenceContext: '',
    pendingReferences: [],
    serverCampaignId: null,
    eagerCapture: null,
  })
  // Trimmed, de-duplicated and capped at three.
  assert.deepEqual(data.sourceUrls, [
    'https://a.example',
    'https://b.example',
    'https://c.example',
  ])
  const parsed = parseCampaignDraft(
    serializeCampaignDraft(OWNER_ID, data, NOW_MS),
    OWNER_ID,
    NOW_MS,
  )
  assert.deepEqual(parsed?.data.sourceUrls, data.sourceUrls)
})

test('campaign draft round-trip preserves mixed reference insertion order', () => {
  const firstFile = new File(['first'], 'first.png', { type: 'image/png' })
  const secondFile = new File(['second'], 'second.webp', {
    type: 'image/webp',
  })
  const data = buildCampaignDraftData({
    sourceUrls: [],
    productName: '',
    tagline: '',
    destinationUrl: '',
    posterFormat: 'a4_2x3',
    outputKind: 'poster',
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

test('a QR-on draft round-trips its banded format and destination', () => {
  const data = buildCampaignDraftData({
    sourceUrls: [],
    productName: 'Summer signals',
    tagline: '',
    destinationUrl: 'https://example.com/social',
    posterFormat: 'rednote_3x4',
    outputKind: 'poster',
    referenceContext: 'Keep the diagonal light.',
    pendingReferences: [],
    serverCampaignId: null,
    eagerCapture: null,
  })

  const parsed = parseCampaignDraft(
    serializeCampaignDraft(OWNER_ID, data, NOW_MS),
    OWNER_ID,
    NOW_MS,
  )

  assert.equal(parsed?.data.posterFormat, 'rednote_3x4')
  assert.equal(parsed?.data.destinationUrl, 'https://example.com/social')
})

test('restoring a multi-page-post draft clears a stale destination', () => {
  const envelope = validEnvelope()
  envelope.data.outputKind = 'post'
  envelope.data.posterFormat = 'rednote_cover_3x4'
  envelope.data.destinationUrl = 'https://example.com/stale'

  const parsed = parseCampaignDraft(JSON.stringify(envelope), OWNER_ID, NOW_MS)

  assert.equal(parsed?.data.outputKind, 'post')
  assert.equal(parsed?.data.destinationUrl, '')
})

test('a v1 envelope restores nothing and does not throw', () => {
  // The v1 payload shape (selectedUseCaseId/ctaText/platformHint, no sourceUrls).
  const v1Data = {
    selectedUseCaseId: 'website_product',
    productUrl: 'https://example.com/product',
    productName: 'Legacy',
    tagline: '',
    ctaText: 'Get started',
    destinationUrl: 'https://example.com/start',
    posterFormat: 'a4_2x3',
    platformHint: '',
    referenceContext: '',
    references: [],
    serverCampaignId: null,
    eagerCapture: null,
  }
  const v1Envelope = JSON.parse(serializeCampaignDraft(
    OWNER_ID,
    // Cast through unknown: this is deliberately the OLD shape.
    v1Data as never,
    NOW_MS,
  ))
  // Missing sourceUrls => parse returns null rather than throwing or half-restoring.
  assert.equal(parseCampaignDraft(JSON.stringify(v1Envelope), OWNER_ID, NOW_MS), null)

  // And the v1 storage key is never even read: the version suffix changed.
  assert.equal(
    campaignDraftKey(OWNER_ID).startsWith('posterlytics.campaignDraft.v2:'),
    true,
  )
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
    data: { ...valid.data, sourceUrls: undefined },
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

test('campaign draft reader filters URLs and repairs an unknown format', () => {
  const envelope = validEnvelope()
  envelope.data.posterFormat = 'not-a-format'
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

  const parsed = parseCampaignDraft(JSON.stringify(envelope), OWNER_ID, NOW_MS)
  // Unknown format falls back to the A4 default.
  assert.equal(parsed?.data.posterFormat, 'a4_2x3')
  assert.deepEqual(parsed?.data.references, [{
    kind: 'url',
    url: 'https://assets.example/one.png',
    name: 'one.png',
  }])
})

test('clearAllLocalDrafts removes campaign and editor drafts without touching preferences', () => {
  const storage = new MemoryStorage([
    ['posterlytics.campaignDraft.v2:user', 'campaign'],
    ['posterlytics.editorDraft.v1:user:campaign', 'editor'],
    ['posterlytics.workspacePreferences.v1', 'preferences'],
  ])

  clearAllLocalDrafts(storage)

  assert.equal(storage.getItem('posterlytics.campaignDraft.v2:user'), null)
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
    sourceUrls: [],
    productName: '',
    tagline: '',
    destinationUrl: '',
    posterFormat: 'a4_2x3',
    outputKind: 'poster',
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
