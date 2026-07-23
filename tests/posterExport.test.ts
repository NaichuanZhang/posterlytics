import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildPosterExportArchiveFilename,
  buildPosterExportFilename,
  buildPosterExportRunSnapshot,
} from '../src/lib/posterExport.ts'
import { getPosterSize } from '../src/lib/posterSize.ts'
import type { Campaign, Placement } from '../src/lib/types.ts'

test('poster export run retains generation inputs after live props are replaced', () => {
  let campaign = {
    product_name: 'Generation A',
    hero_image_url: 'https://example.com/generation-a.png',
  } as unknown as Campaign
  let posterSize = getPosterSize('a4_2x3')
  let placement = {
    label: 'Generation A lobby',
    code: 'generation-a',
  } as unknown as Placement
  let versionNumber = 1
  const generationACampaign = campaign
  const generationAPosterSize = posterSize

  const run = buildPosterExportRunSnapshot({
    campaign,
    placement,
    versionNumber,
    posterSize,
    pageIndex: 1,
    pageCount: 3,
  })

  campaign = {
    ...campaign,
    product_name: 'Generation B',
    hero_image_url: 'https://example.com/generation-b.png',
  }
  posterSize = getPosterSize('luma_1x1')
  placement = {
    ...placement,
    label: 'Generation B lobby',
    code: 'generation-b',
  }
  versionNumber = 2

  assert.strictEqual(run.campaign, generationACampaign)
  assert.strictEqual(run.posterSize, generationAPosterSize)
  assert.equal(run.heroImageUrl, 'https://example.com/generation-a.png')
  assert.equal(run.placementCode, 'generation-a')
  assert.equal(run.includesQrBand, true)
  assert.equal(run.requiresQrImage, true)
  assert.deepEqual(run.capture, {
    width: 1240,
    height: 1754,
    pixelRatio: 2,
  })
  assert.deepEqual(run.naming, {
    productName: 'Generation A',
    versionNumber: 1,
    placementLabel: 'Generation A lobby',
    filenameSuffix: 'A4',
  })
  assert.deepEqual(run.pages, {
    selected: {
      pageIndex: 1,
      pageCount: 3,
    },
    count: 3,
  })
  assert.equal(campaign.product_name, 'Generation B')
  assert.equal(posterSize.slug, 'luma_1x1')
  assert.equal(placement.code, 'generation-b')
  assert.equal(versionNumber, 2)
})

test('bandless poster export snapshot never requires a QR image', () => {
  const run = buildPosterExportRunSnapshot({
    campaign: {
      product_name: 'Full bleed cover',
      hero_image_url: 'https://example.com/full-bleed.png',
    } as unknown as Campaign,
    placement: {
      label: 'Ignored placement',
      code: 'ignored-placement',
    } as unknown as Placement,
    versionNumber: 3,
    posterSize: getPosterSize('rednote_cover_3x4'),
    pageIndex: 0,
    pageCount: null,
  })

  assert.equal(run.includesQrBand, false)
  assert.equal(run.requiresQrImage, false)
  assert.equal(run.naming.placementLabel, undefined)
})

test('poster export filename remains unchanged when no page is supplied', () => {
  assert.equal(
    buildPosterExportFilename({
      productName: 'Signal Studio',
      versionNumber: 2,
      placementLabel: 'Lobby Wall',
      filenameSuffix: 'A4',
    }),
    'Signal-Studio-v2-Lobby-Wall-A4.png',
  )
})

test('poster export filename appends an ordered composite page suffix', () => {
  assert.equal(
    buildPosterExportFilename({
      productName: 'Signal Studio',
      versionNumber: 1,
      filenameSuffix: 'FullBleed-3x4',
      page: {
        pageIndex: 1,
        pageCount: 5,
      },
    }),
    'Signal-Studio-v1-FullBleed-3x4-page-02-of-05.png',
  )
})

test('poster export archive filename identifies the all-pages ZIP', () => {
  assert.equal(
    buildPosterExportArchiveFilename({
      productName: 'Signal Studio',
      versionNumber: 1,
      filenameSuffix: 'FullBleed-3x4',
    }),
    'Signal-Studio-v1-FullBleed-3x4-all-pages.zip',
  )
})

test('poster export filename rejects an out-of-range page', () => {
  assert.throws(
    () => buildPosterExportFilename({
      productName: 'Signal Studio',
      filenameSuffix: 'FullBleed-3x4',
      page: {
        pageIndex: 5,
        pageCount: 5,
      },
    }),
    RangeError,
  )
})
