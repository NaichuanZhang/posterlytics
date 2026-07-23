import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildPosterExportArchiveFilename,
  buildPosterExportFilename,
} from '../src/lib/posterExport.ts'

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
