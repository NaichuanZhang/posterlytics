import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterCampaigns } from '../src/lib/campaignFilters.ts'

const campaigns = [
  {
    product_name: 'Northstar Reports',
    product_url: 'https://northstar.example/reports',
    status: 'published' as const,
  },
  {
    product_name: 'Field Notes',
    product_url: 'https://fieldnotes.example',
    status: 'draft' as const,
  },
  {
    product_name: 'Transit Board',
    product_url: 'https://transit.example/north',
    status: 'analyzing' as const,
    is_generating: true,
  },
]

test('filterCampaigns matches names and URLs case-insensitively', () => {
  assert.deepEqual(
    filterCampaigns(campaigns, ' NORTH ', 'all').map((campaign) => campaign.product_name),
    ['Northstar Reports', 'Transit Board'],
  )
})

test('filterCampaigns applies status and query together', () => {
  assert.deepEqual(
    filterCampaigns(campaigns, 'field', 'draft').map((campaign) => campaign.product_name),
    ['Field Notes'],
  )
  assert.deepEqual(filterCampaigns(campaigns, 'field', 'published'), [])
})

test('filterCampaigns preserves source ordering for an empty all filter', () => {
  assert.deepEqual(filterCampaigns(campaigns, '', 'all'), campaigns)
})

test('filterCampaigns uses durable activity for the Generating filter', () => {
  assert.deepEqual(
    filterCampaigns(campaigns, '', 'generating').map((campaign) => campaign.product_name),
    ['Transit Board'],
  )
  assert.deepEqual(
    filterCampaigns(campaigns, 'generating', 'all').map((campaign) => campaign.product_name),
    ['Transit Board'],
  )
})

test('filterCampaigns accepts URL-less campaigns', () => {
  const socialCover = {
    product_name: 'Summer launch cover',
    product_url: null,
    status: 'draft' as const,
  }

  assert.deepEqual(filterCampaigns([socialCover], 'summer', 'all'), [socialCover])
  assert.deepEqual(filterCampaigns([socialCover], 'example.com', 'all'), [])
})

test('an untitled campaign stays searchable and never crashes the list', () => {
  const untitled = {
    id: 'campaign-abc123',
    product_name: null,
    product_url: 'https://untitled.example/product',
    status: 'draft' as const,
  }
  const titled = {
    id: 'campaign-def456',
    product_name: 'Signal Studio',
    product_url: 'https://signal.example',
    status: 'draft' as const,
  }
  const rows = [untitled, titled]

  // A null name previously threw inside the list's useMemo on the first keystroke.
  assert.deepEqual(filterCampaigns(rows, 'untitled.example', 'all'), [untitled])
  assert.deepEqual(filterCampaigns(rows, 'campaign-abc', 'all'), [untitled])
  assert.deepEqual(filterCampaigns(rows, 'signal', 'all'), [titled])
  assert.deepEqual(filterCampaigns(rows, 'draft', 'all'), rows)
  assert.deepEqual(filterCampaigns(rows, 'nothing-matches', 'all'), [])

  // A blank title behaves the same as null.
  assert.deepEqual(
    filterCampaigns([{ ...untitled, product_name: '' }], 'campaign-abc', 'all'),
    [{ ...untitled, product_name: '' }],
  )
})
