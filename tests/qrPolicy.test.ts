import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  POSTER_SIZES,
  getPosterSize,
  hasPosterQrBand,
} from '../src/lib/posterSize.ts'
import {
  effectivePosterFormat,
  posterFormatHasQr,
  posterFormatRequiresDestination,
  posterFormatSupportsQrToggle,
  posterFormatWithQr,
} from '../src/lib/qrPolicy.ts'
import { isRedNotePostFormat } from '../src/lib/redNotePost.ts'

const wizard = readFileSync(
  new URL('../src/pages/CampaignWizardPage.tsx', import.meta.url),
  'utf8',
)
const editor = readFileSync(
  new URL('../src/pages/PosterEditorPage.tsx', import.meta.url),
  'utf8',
)
const draft = readFileSync(
  new URL('../src/lib/campaignDraft.ts', import.meta.url),
  'utf8',
)

test('the QR toggle round-trips every format without losing the aspect', () => {
  for (const size of POSTER_SIZES) {
    const banded = posterFormatWithQr(size.slug, true)
    const bandless = posterFormatWithQr(size.slug, false)

    // Every current aspect has both members, so both directions resolve.
    assert.equal(posterFormatHasQr(banded), true)
    assert.equal(posterFormatHasQr(bandless), false)
    // The aspect is preserved in both directions — the toggle never reframes.
    assert.equal(
      getPosterSize(banded).providerAspectRatio,
      size.providerAspectRatio,
    )
    assert.equal(
      getPosterSize(bandless).providerAspectRatio,
      size.providerAspectRatio,
    )
    // Round trip returns the original slug.
    assert.equal(posterFormatWithQr(banded, hasPosterQrBand(size)), size.slug)
    assert.equal(posterFormatWithQr(bandless, hasPosterQrBand(size)), size.slug)
    // Setting the mode it already has is a no-op.
    assert.equal(posterFormatWithQr(size.slug, hasPosterQrBand(size)), size.slug)
    assert.equal(posterFormatSupportsQrToggle(size.slug), true)
  }
})

test('a legacy row without a format behaves like the A4 default', () => {
  for (const absent of [null, undefined]) {
    assert.equal(effectivePosterFormat(absent), 'a4_2x3')
    // The A4 default is banded, so a legacy row still requires a destination.
    assert.equal(posterFormatHasQr(absent), true)
    assert.equal(posterFormatRequiresDestination(absent), true)
    assert.equal(posterFormatWithQr(absent, false), 'a4_2x3_cover')
    assert.equal(posterFormatWithQr(absent, true), 'a4_2x3')
    assert.equal(posterFormatSupportsQrToggle(absent), true)
  }
})

test('the destination requirement mirrors the band, one-directionally', () => {
  for (const size of POSTER_SIZES) {
    assert.equal(
      posterFormatRequiresDestination(size.slug),
      hasPosterQrBand(size),
    )
  }
  // A bandless format does not FORBID a destination: website, Amazon and event
  // campaigns keep valid tracked links on bandless artwork.
  assert.equal(posterFormatRequiresDestination('a4_2x3_cover'), false)
  assert.equal(posterFormatRequiresDestination('rednote_cover_3x4'), false)
})

test('the RedNote gate keys on aspect and band, not on a slug', () => {
  assert.equal(isRedNotePostFormat('rednote_cover_3x4'), true)
  // A banded 3:4 poster is a different product, not a RedNote post.
  assert.equal(isRedNotePostFormat('rednote_3x4'), false)
  // Other bandless aspects are not 3:4.
  for (const slug of ['a4_2x3_cover', 'yt_thumb_16x9_cover', 'luma_1x1_cover']) {
    assert.equal(isRedNotePostFormat(slug), false)
  }
  // Untrusted persisted values are rejected rather than throwing.
  for (const value of [null, undefined, '', 'nope', 42, {}, []]) {
    assert.equal(isRedNotePostFormat(value), false)
  }
})

test('creation, editing and draft restore share one QR policy with no slug literals', () => {
  for (const source of [wizard, editor, draft]) {
    assert.doesNotMatch(source, /'rednote_3x4'/)
    assert.doesNotMatch(source, /'rednote_cover_3x4'/)
  }
  // All three read the band through the shared helper.
  for (const source of [wizard, editor, draft]) {
    assert.match(source, /posterFormatHasQr\(/)
  }
  // Only the two writers flip the format.
  for (const source of [wizard, editor]) {
    assert.match(source, /posterFormatWithQr\(/)
  }
  assert.doesNotMatch(draft, /posterFormatWithQr\(/)
})
