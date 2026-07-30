import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hasCompletedPoster,
  isCampaignAwaitingFirstPoster,
} from '../src/lib/campaignPosterState.ts'

test('a completed poster is exactly a non-null current_generation_id', () => {
  assert.equal(hasCompletedPoster({ current_generation_id: 'gen-1' }), true)
  assert.equal(hasCompletedPoster({ current_generation_id: null }), false)
})

test('awaiting means no finished poster AND nothing in flight', () => {
  // The failed-creation state: a real row that never produced artwork.
  assert.equal(
    isCampaignAwaitingFirstPoster({
      campaign: { current_generation_id: null },
      isGenerating: false,
    }),
    true,
  )
  // current_generation_id is written only by complete_poster_generation, so it is
  // also NULL while the FIRST generation runs. That must not read as 'no poster
  // yet' — the live activity signal is what separates the two.
  assert.equal(
    isCampaignAwaitingFirstPoster({
      campaign: { current_generation_id: null },
      isGenerating: true,
    }),
    false,
  )
  // A campaign with artwork is never awaiting, generating or not.
  assert.equal(
    isCampaignAwaitingFirstPoster({
      campaign: { current_generation_id: 'gen-1' },
      isGenerating: false,
    }),
    false,
  )
  assert.equal(
    isCampaignAwaitingFirstPoster({
      campaign: { current_generation_id: 'gen-1' },
      isGenerating: true,
    }),
    false,
  )
})
