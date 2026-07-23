import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  buildStoredZip,
  crc32,
  pngDataUrlToBytes,
  type StoredZipEntry,
} from '../src/lib/posterZip.ts'

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

test('PNG data URLs decode to bytes with a valid PNG signature', () => {
  const bytes = pngDataUrlToBytes(PNG_DATA_URL)
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  )
})

test('PNG data URL decoding rejects invalid or non-PNG data', () => {
  assert.throws(
    () => pngDataUrlToBytes('data:text/plain;base64,aGVsbG8='),
    /not a PNG data URL/,
  )
  assert.throws(
    () => pngDataUrlToBytes('data:image/png;base64,'),
    /PNG data is empty/,
  )
  assert.throws(
    () => pngDataUrlToBytes('data:image/png;base64,!!!!'),
    /not valid base64/,
  )
  assert.throws(
    () => pngDataUrlToBytes('data:image/png;base64,bm90IGEgcG5n'),
    /does not contain a PNG image/,
  )
})

test('CRC32 matches the standard check vector', () => {
  assert.equal(
    crc32(new TextEncoder().encode('123456789')),
    0xcbf4_3926,
  )
})

test('STORE ZIP contains complete local, central, and EOCD records', () => {
  const entries: StoredZipEntry[] = [
    { filename: 'page-01.png', bytes: Uint8Array.of(1, 2, 3) },
    { filename: 'page-02.png', bytes: Uint8Array.of(4, 5) },
  ]
  const archive = buildStoredZip(entries)
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  )
  const decoder = new TextDecoder()

  assert.equal(view.getUint32(0, true), 0x0403_4b50)
  assert.equal(view.getUint16(4, true), 20)
  assert.equal(view.getUint16(6, true), 0x0800)
  assert.equal(view.getUint16(8, true), 0)
  assert.equal(view.getUint16(10, true), 0)
  assert.equal(view.getUint16(12, true), 0x0021)
  assert.equal(view.getUint32(14, true), crc32(entries[0].bytes))
  assert.equal(view.getUint32(18, true), 3)
  assert.equal(view.getUint32(22, true), 3)
  const firstNameLength = view.getUint16(26, true)
  assert.equal(firstNameLength, entries[0].filename.length)
  assert.equal(view.getUint16(28, true), 0)
  assert.equal(
    decoder.decode(archive.subarray(30, 30 + firstNameLength)),
    entries[0].filename,
  )

  const eocdOffset = archive.length - 22
  assert.equal(view.getUint32(eocdOffset, true), 0x0605_4b50)
  assert.equal(view.getUint16(eocdOffset + 4, true), 0)
  assert.equal(view.getUint16(eocdOffset + 6, true), 0)
  assert.equal(view.getUint16(eocdOffset + 8, true), entries.length)
  assert.equal(view.getUint16(eocdOffset + 10, true), entries.length)
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true)
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true)
  assert.equal(view.getUint16(eocdOffset + 20, true), 0)
  assert.equal(
    centralDirectoryOffset + centralDirectorySize,
    eocdOffset,
  )

  assert.equal(view.getUint32(centralDirectoryOffset, true), 0x0201_4b50)
  assert.equal(view.getUint16(centralDirectoryOffset + 4, true), 20)
  assert.equal(view.getUint16(centralDirectoryOffset + 6, true), 20)
  assert.equal(view.getUint16(centralDirectoryOffset + 8, true), 0x0800)
  assert.equal(view.getUint16(centralDirectoryOffset + 10, true), 0)
  assert.equal(view.getUint16(centralDirectoryOffset + 12, true), 0)
  assert.equal(view.getUint16(centralDirectoryOffset + 14, true), 0x0021)
  assert.equal(
    view.getUint32(centralDirectoryOffset + 16, true),
    crc32(entries[0].bytes),
  )
  assert.equal(view.getUint32(centralDirectoryOffset + 20, true), 3)
  assert.equal(view.getUint32(centralDirectoryOffset + 24, true), 3)
  assert.equal(
    view.getUint16(centralDirectoryOffset + 28, true),
    firstNameLength,
  )
  assert.equal(view.getUint16(centralDirectoryOffset + 30, true), 0)
  assert.equal(view.getUint16(centralDirectoryOffset + 32, true), 0)
  assert.equal(view.getUint16(centralDirectoryOffset + 34, true), 0)
  assert.equal(view.getUint16(centralDirectoryOffset + 36, true), 0)
  assert.equal(view.getUint32(centralDirectoryOffset + 38, true), 0)
  assert.equal(view.getUint32(centralDirectoryOffset + 42, true), 0)
})

test('STORE ZIP round-trips ordered entry names and bytes', () => {
  const entries: StoredZipEntry[] = [
    { filename: 'page-01-of-03.png', bytes: Uint8Array.of(1, 3, 5, 7) },
    { filename: 'page-02-of-03.png', bytes: Uint8Array.of(2, 4, 6, 8) },
    { filename: 'page-03-of-03.png', bytes: Uint8Array.of(9, 10, 11) },
  ]
  const recovered = recoverStoredEntries(buildStoredZip(entries))

  assert.deepEqual(
    recovered.map((entry) => entry.filename),
    entries.map((entry) => entry.filename),
  )
  assert.deepEqual(
    recovered.map((entry) => [...entry.bytes]),
    entries.map((entry) => [...entry.bytes]),
  )
})

test('system unzip validates and lists STORE entries in archive order', () => {
  const filenames = [
    'page-01-of-02.png',
    'page-02-of-02.png',
  ]
  const archive = buildStoredZip([
    { filename: filenames[0], bytes: Uint8Array.of(1, 2, 3) },
    { filename: filenames[1], bytes: Uint8Array.of(4, 5, 6) },
  ])
  const directory = mkdtempSync(path.join(tmpdir(), 'posterlytics-zip-'))
  const archivePath = path.join(directory, 'poster-pages.zip')

  try {
    writeFileSync(archivePath, archive)
    const integrityOutput = runUnzip(['-t', archivePath])
    assert.match(integrityOutput, /No errors detected/)

    const listing = runUnzip(['-l', archivePath])
    const listedFilenames = listing.split('\n')
      .map((line) => line.trim().split(/\s+/).at(-1))
      .filter((value): value is string => filenames.includes(value ?? ''))
    assert.deepEqual(listedFilenames, filenames)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

function runUnzip(args: readonly string[]): string {
  try {
    return execFileSync(
      '/usr/bin/unzip',
      [...args],
      { encoding: 'utf8' },
    )
  } catch (error) {
    // The managed sandbox reports successful nested processes as EPERM while
    // preserving status 0 and stdout. Missing binaries and nonzero exits throw.
    const result = error as {
      code?: unknown
      status?: unknown
      stdout?: unknown
    }
    if (
      result.code === 'EPERM'
      && result.status === 0
      && typeof result.stdout === 'string'
    ) {
      return result.stdout
    }
    throw error
  }
}

test('STORE ZIP rejects invalid entry sets and unsafe filenames', () => {
  const bytes = Uint8Array.of(1)
  assert.throws(() => buildStoredZip([]), /at least one entry/)
  assert.throws(
    () => buildStoredZip([
      { filename: 'page.png', bytes },
      { filename: 'page.png', bytes },
    ]),
    /must be unique/,
  )
  for (const filename of [
    '',
    '..',
    '../page.png',
    '/page.png',
    'folder/page.png',
    '\\page.png',
    'folder\\page.png',
    'page\0.png',
  ]) {
    assert.throws(
      () => buildStoredZip([{ filename, bytes }]),
      /safe root filename/,
      filename,
    )
  }
  assert.throws(
    () => buildStoredZip([{
      filename: 'a'.repeat(0x1_0000),
      bytes,
    }]),
    /exceeds 65535 UTF-8 bytes/,
  )
  assert.throws(
    () => buildStoredZip(new Array(0x1_0000).fill({
      filename: 'page.png',
      bytes,
    })),
    /entry count exceeds/,
  )
})

function recoverStoredEntries(archive: Uint8Array): StoredZipEntry[] {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  )
  const eocdOffset = archive.length - 22
  assert.equal(view.getUint32(eocdOffset, true), 0x0605_4b50)
  const entryCount = view.getUint16(eocdOffset + 10, true)
  let centralOffset = view.getUint32(eocdOffset + 16, true)
  const decoder = new TextDecoder()
  const entries: StoredZipEntry[] = []

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(view.getUint32(centralOffset, true), 0x0201_4b50)
    assert.equal(view.getUint16(centralOffset + 10, true), 0)
    const checksum = view.getUint32(centralOffset + 16, true)
    const compressedSize = view.getUint32(centralOffset + 20, true)
    assert.equal(
      compressedSize,
      view.getUint32(centralOffset + 24, true),
    )
    const filenameLength = view.getUint16(centralOffset + 28, true)
    const extraLength = view.getUint16(centralOffset + 30, true)
    const commentLength = view.getUint16(centralOffset + 32, true)
    const localOffset = view.getUint32(centralOffset + 42, true)
    const filename = decoder.decode(archive.subarray(
      centralOffset + 46,
      centralOffset + 46 + filenameLength,
    ))

    assert.equal(view.getUint32(localOffset, true), 0x0403_4b50)
    assert.equal(view.getUint16(localOffset + 8, true), 0)
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataOffset = localOffset
      + 30
      + localNameLength
      + localExtraLength
    const bytes = archive.slice(dataOffset, dataOffset + compressedSize)
    assert.equal(crc32(bytes), checksum)
    entries.push({ filename, bytes })

    centralOffset += 46 + filenameLength + extraLength + commentLength
  }
  return entries
}
