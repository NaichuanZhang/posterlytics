import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildPosterEditorDraftData,
  isPosterEditorDraftDirty,
  parsePosterEditorDraft,
  posterEditorDraftKey,
  restorePosterEditorDraft,
  serializePosterEditorDraft,
} from '../src/lib/posterEditorDraft.ts'
import { rehydrateLocalDraftReferences } from '../src/lib/localDraft.ts'

const NOW_MS = Date.parse('2026-07-22T12:00:00.000Z')
const OWNER_ID = 'user-one'
const CAMPAIGN_ID = 'campaign-one'

test('editor drafts round-trip instructions, settings, and reference metadata', () => {
  const file = new File(['pixels'], 'fresh.jpg', { type: 'image/jpeg' })
  const data = buildPosterEditorDraftData({
    campaignId: CAMPAIGN_ID,
    instruction: 'Make the approved headline larger.',
    platformHint: 'RedNote',
    platformHintBaseline: null,
    refreshWebsite: true,
    pendingReferences: [
      { id: 'file', kind: 'file', file },
      {
        id: 'url',
        kind: 'url',
        url: 'https://assets.example/fresh.jpg',
        name: 'fresh-url.jpg',
        previewStatus: 'error',
      },
    ],
  })
  const serialized = serializePosterEditorDraft(OWNER_ID, data, NOW_MS)
  const parsed = parsePosterEditorDraft(
    serialized,
    OWNER_ID,
    CAMPAIGN_ID,
    NOW_MS,
  )

  assert.deepEqual(parsed?.data, data)
  assert.equal(serialized.includes('pixels'), false)
  assert.equal(serialized.includes('previewStatus'), false)
  assert.equal(
    posterEditorDraftKey('user/one', 'campaign:one'),
    'posterlytics.editorDraft.v1:user%2Fone:campaign%3Aone',
  )
  assert.equal(isPosterEditorDraftDirty(data), true)

  const restoredReferences = rehydrateLocalDraftReferences(
    parsed?.data.references ?? [],
    () => 'new-id',
  )
  assert.equal(restoredReferences.unrestorableFiles.length, 1)
  assert.deepEqual(restoredReferences.pendingReferences, [{
    id: 'new-id',
    kind: 'url',
    url: 'https://assets.example/fresh.jpg',
    name: 'fresh-url.jpg',
    previewStatus: 'loading',
  }])
})

test('editor restore keeps a local platform hint only while its server baseline matches', () => {
  const data = buildPosterEditorDraftData({
    campaignId: CAMPAIGN_ID,
    instruction: 'Keep this instruction.',
    platformHint: 'RedNote',
    platformHintBaseline: 'Instagram',
    refreshWebsite: false,
    pendingReferences: [],
  })

  assert.deepEqual(restorePosterEditorDraft(data, 'Instagram'), {
    instruction: 'Keep this instruction.',
    platformHint: 'RedNote',
    platformHintBaseline: 'Instagram',
    refreshWebsite: false,
    references: [],
  })
  assert.deepEqual(restorePosterEditorDraft(data, 'YouTube'), {
    instruction: 'Keep this instruction.',
    platformHint: 'YouTube',
    platformHintBaseline: 'YouTube',
    refreshWebsite: false,
    references: [],
  })
})

test('editor reader rejects garbage, partial data, wrong versions, owners, campaigns, and future timestamps', () => {
  const valid = validEnvelope()
  assert.equal(
    parsePosterEditorDraft('null', OWNER_ID, CAMPAIGN_ID, NOW_MS),
    null,
  )
  assert.equal(parsePosterEditorDraft(JSON.stringify({
    ...valid,
    data: { ...valid.data, instruction: undefined },
  }), OWNER_ID, CAMPAIGN_ID, NOW_MS), null)
  assert.equal(parsePosterEditorDraft(JSON.stringify({
    ...valid,
    data: { ...valid.data, references: undefined },
  }), OWNER_ID, CAMPAIGN_ID, NOW_MS), null)
  assert.equal(parsePosterEditorDraft(
    JSON.stringify({ ...valid, version: 0 }),
    OWNER_ID,
    CAMPAIGN_ID,
    NOW_MS,
  ), null)
  assert.equal(parsePosterEditorDraft(
    JSON.stringify({ ...valid, ownerId: 'other-user' }),
    OWNER_ID,
    CAMPAIGN_ID,
    NOW_MS,
  ), null)
  assert.equal(parsePosterEditorDraft(
    JSON.stringify(valid),
    OWNER_ID,
    'other-campaign',
    NOW_MS,
  ), null)
  assert.equal(parsePosterEditorDraft(JSON.stringify({
    ...valid,
    updatedAt: new Date(NOW_MS + 60_000).toISOString(),
  }), OWNER_ID, CAMPAIGN_ID, NOW_MS), null)
})

test('editor reader filters invalid URLs and recognizes a server-baseline default', () => {
  const envelope = validEnvelope()
  envelope.data.references = [
    {
      kind: 'url',
      url: 'https://user:secret@assets.example/private.png',
      name: 'private',
    },
    {
      kind: 'url',
      url: 'https://assets.example/public.png#preview',
      name: 'public.png',
    },
  ]
  const parsed = parsePosterEditorDraft(
    JSON.stringify(envelope),
    OWNER_ID,
    CAMPAIGN_ID,
    NOW_MS,
  )
  assert.deepEqual(parsed?.data.references, [{
    kind: 'url',
    url: 'https://assets.example/public.png',
    name: 'public.png',
  }])

  const pristine = buildPosterEditorDraftData({
    campaignId: CAMPAIGN_ID,
    instruction: '',
    platformHint: 'RedNote',
    platformHintBaseline: 'RedNote',
    refreshWebsite: false,
    pendingReferences: [],
  })
  assert.equal(isPosterEditorDraftDirty(pristine), false)
})

function validEnvelope() {
  return JSON.parse(serializePosterEditorDraft(
    OWNER_ID,
    buildPosterEditorDraftData({
      campaignId: CAMPAIGN_ID,
      instruction: '',
      platformHint: '',
      platformHintBaseline: null,
      refreshWebsite: false,
      pendingReferences: [],
    }),
    NOW_MS,
  ))
}
