export interface StoredZipEntry {
  readonly filename: string
  readonly bytes: Uint8Array
}

interface PreparedZipEntry extends StoredZipEntry {
  readonly filenameBytes: Uint8Array
  readonly checksum: number
  readonly localHeaderOffset: number
}

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,'
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const LOCAL_FILE_HEADER_SIZE = 30
const CENTRAL_DIRECTORY_HEADER_SIZE = 46
const END_OF_CENTRAL_DIRECTORY_SIZE = 22
const ZIP32_MAX_VALUE = 0xffff_ffff
const ZIP32_MAX_ENTRY_COUNT = 0xffff
const ZIP_VERSION_2_0 = 20
const ZIP_UTF8_FLAG = 0x0800
const ZIP_STORE_METHOD = 0
const ZIP_FIXED_MODIFICATION_TIME = 0
const ZIP_FIXED_MODIFICATION_DATE = 0x0021
const ZIP_SIZE_MISMATCH_ERROR =
  'ZIP archive size calculation did not match its output.'
const CRC32_TABLE = buildCrc32Table()

export function pngDataUrlToBytes(dataUrl: string): Uint8Array {
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    throw new TypeError('Poster export is not a PNG data URL.')
  }

  const encoded = dataUrl.slice(PNG_DATA_URL_PREFIX.length)
  if (!encoded) throw new TypeError('Poster export PNG data is empty.')

  let binary: string
  try {
    binary = atob(encoded)
  } catch {
    throw new TypeError('Poster export PNG data is not valid base64.')
  }

  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  if (
    bytes.length < PNG_SIGNATURE.length
    || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  ) {
    throw new TypeError('Poster export data does not contain a PNG image.')
  }
  return bytes
}

export function crc32(bytes: Uint8Array): number {
  let checksum = 0xffff_ffff
  for (const byte of bytes) {
    checksum = CRC32_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8)
  }
  return (checksum ^ 0xffff_ffff) >>> 0
}

export function buildStoredZip(
  entries: readonly StoredZipEntry[],
): Uint8Array {
  if (entries.length === 0) {
    throw new RangeError('A ZIP archive must contain at least one entry.')
  }
  if (entries.length > ZIP32_MAX_ENTRY_COUNT) {
    throw new RangeError('ZIP entry count exceeds the ZIP32 limit.')
  }

  const seenNames = new Set<string>()
  const encoder = new TextEncoder()
  let localDirectorySize = 0
  let centralDirectorySize = 0
  const preparedEntries = entries.map((entry): PreparedZipEntry => {
    validateEntry(entry, seenNames)
    const filenameBytes = encoder.encode(entry.filename)
    if (filenameBytes.length > ZIP32_MAX_ENTRY_COUNT) {
      throw new RangeError('ZIP entry filename exceeds 65535 UTF-8 bytes.')
    }
    if (entry.bytes.byteLength > ZIP32_MAX_VALUE) {
      throw new RangeError('ZIP entry data exceeds the ZIP32 limit.')
    }

    const localHeaderOffset = localDirectorySize
    localDirectorySize = checkedZip32Size(
      localDirectorySize
      + LOCAL_FILE_HEADER_SIZE
      + filenameBytes.length
      + entry.bytes.byteLength,
    )
    centralDirectorySize = checkedZip32Size(
      centralDirectorySize
      + CENTRAL_DIRECTORY_HEADER_SIZE
      + filenameBytes.length,
    )
    return {
      filename: entry.filename,
      bytes: entry.bytes,
      filenameBytes,
      checksum: crc32(entry.bytes),
      localHeaderOffset,
    }
  })

  const totalSize = checkedZip32Size(
    localDirectorySize
    + centralDirectorySize
    + END_OF_CENTRAL_DIRECTORY_SIZE,
  )
  const archive = new Uint8Array(totalSize)
  const view = new DataView(archive.buffer)
  let cursor = 0

  function uint16(value: number) {
    view.setUint16(cursor, value, true)
    cursor += 2
  }

  function uint32(value: number) {
    view.setUint32(cursor, value, true)
    cursor += 4
  }

  function bytes(value: Uint8Array) {
    archive.set(value, cursor)
    cursor += value.length
  }

  for (const entry of preparedEntries) {
    uint32(0x0403_4b50)
    uint16(ZIP_VERSION_2_0)
    uint16(ZIP_UTF8_FLAG)
    uint16(ZIP_STORE_METHOD)
    uint16(ZIP_FIXED_MODIFICATION_TIME)
    uint16(ZIP_FIXED_MODIFICATION_DATE)
    uint32(entry.checksum)
    uint32(entry.bytes.byteLength)
    uint32(entry.bytes.byteLength)
    uint16(entry.filenameBytes.length)
    uint16(0)
    bytes(entry.filenameBytes)
    bytes(entry.bytes)
  }

  const centralDirectoryOffset = cursor
  for (const entry of preparedEntries) {
    uint32(0x0201_4b50)
    uint16(ZIP_VERSION_2_0)
    uint16(ZIP_VERSION_2_0)
    uint16(ZIP_UTF8_FLAG)
    uint16(ZIP_STORE_METHOD)
    uint16(ZIP_FIXED_MODIFICATION_TIME)
    uint16(ZIP_FIXED_MODIFICATION_DATE)
    uint32(entry.checksum)
    uint32(entry.bytes.byteLength)
    uint32(entry.bytes.byteLength)
    uint16(entry.filenameBytes.length)
    uint16(0)
    uint16(0)
    uint16(0)
    uint16(0)
    uint32(0)
    uint32(entry.localHeaderOffset)
    bytes(entry.filenameBytes)
  }
  const writtenCentralDirectorySize = cursor - centralDirectoryOffset

  uint32(0x0605_4b50)
  uint16(0)
  uint16(0)
  uint16(preparedEntries.length)
  uint16(preparedEntries.length)
  uint32(writtenCentralDirectorySize)
  uint32(centralDirectoryOffset)
  uint16(0)

  if (cursor !== archive.length) {
    throw new Error(ZIP_SIZE_MISMATCH_ERROR)
  }
  return archive
}

function validateEntry(
  entry: StoredZipEntry,
  seenNames: Set<string>,
) {
  if (
    !entry.filename
    || entry.filename.startsWith('..')
    || entry.filename.startsWith('/')
    || entry.filename.startsWith('\\')
    || entry.filename.includes('/')
    || entry.filename.includes('\\')
    || entry.filename.includes('\0')
  ) {
    throw new TypeError('ZIP entry filename must be a safe root filename.')
  }
  if (seenNames.has(entry.filename)) {
    throw new TypeError('ZIP entry filenames must be unique.')
  }
  if (!(entry.bytes instanceof Uint8Array)) {
    throw new TypeError('ZIP entry data must be a Uint8Array.')
  }
  seenNames.add(entry.filename)
}

function checkedZip32Size(value: number): number {
  if (!Number.isSafeInteger(value) || value > ZIP32_MAX_VALUE) {
    throw new RangeError('ZIP archive exceeds the ZIP32 size limit.')
  }
  return value
}

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0
        ? 0xedb8_8320 ^ (value >>> 1)
        : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}
