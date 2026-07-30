import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  campaignDisplayName,
  campaignTitleWriteChanged,
  displayNameOrUntitled,
  normalizeCampaignTitleWrite,
} from '../src/lib/campaignDisplayName.ts'

const UNTITLED = 'Untitled campaign'

test('an absent or blank title renders the untitled placeholder', () => {
  assert.equal(displayNameOrUntitled(null, UNTITLED), UNTITLED)
  assert.equal(displayNameOrUntitled(undefined, UNTITLED), UNTITLED)
  // A legacy row can hold '' as well as NULL; both mean untitled.
  assert.equal(displayNameOrUntitled('', UNTITLED), UNTITLED)
  assert.equal(displayNameOrUntitled('   ', UNTITLED), UNTITLED)
  assert.equal(campaignDisplayName({ product_name: null }, UNTITLED), UNTITLED)
})

test('a real title renders trimmed, including non-Latin', () => {
  assert.equal(displayNameOrUntitled('Northstar', UNTITLED), 'Northstar')
  assert.equal(displayNameOrUntitled('  Northstar  ', UNTITLED), 'Northstar')
  assert.equal(displayNameOrUntitled('中文标题', UNTITLED), '中文标题')
})

test('the writer persists NULL, never an empty string', () => {
  // '' would pass a ?? guard downstream and produce a blank prompt identity, an
  // export filename beginning with '-', and a squatted empty utm_campaign.
  assert.equal(normalizeCampaignTitleWrite(''), null)
  assert.equal(normalizeCampaignTitleWrite('   '), null)
  assert.equal(normalizeCampaignTitleWrite('\t\n '), null)
  assert.equal(normalizeCampaignTitleWrite('Northstar'), 'Northstar')
  assert.equal(normalizeCampaignTitleWrite('  Northstar  '), 'Northstar')
  assert.equal(normalizeCampaignTitleWrite('中文标题'), '中文标题')
})

test('a rename is a no-op unless the normalized value differs', () => {
  assert.equal(campaignTitleWriteChanged(null, ''), false)
  assert.equal(campaignTitleWriteChanged(null, '   '), false)
  assert.equal(campaignTitleWriteChanged(undefined, ''), false)
  // A legacy '' row equals NULL, so opening and saving must not write.
  assert.equal(campaignTitleWriteChanged('', '  '), false)
  assert.equal(campaignTitleWriteChanged('A', 'A'), false)
  // Trimming an otherwise unchanged title is not a change.
  assert.equal(campaignTitleWriteChanged('A', ' A '), false)
  assert.equal(campaignTitleWriteChanged(' A ', 'A'), false)

  assert.equal(campaignTitleWriteChanged(null, 'A'), true)
  assert.equal(campaignTitleWriteChanged('A', 'B'), true)
  // Clearing a real title back to untitled IS a change.
  assert.equal(campaignTitleWriteChanged('A', ''), true)
})
