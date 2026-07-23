export interface PosterExportPage {
  readonly pageIndex: number
  readonly pageCount: number
}

interface PosterExportFilenameInput {
  readonly productName: string
  readonly versionNumber?: number
  readonly placementLabel?: string
  readonly filenameSuffix: string
  readonly page?: PosterExportPage
}

interface PosterExportArchiveFilenameInput {
  readonly productName: string
  readonly versionNumber?: number
  readonly filenameSuffix: string
}

export function buildPosterExportFilename({
  productName,
  versionNumber,
  placementLabel,
  filenameSuffix,
  page,
}: PosterExportFilenameInput): string {
  const version = versionNumber ? `-v${versionNumber}` : ''
  const placement = placementLabel
    ? `-${sanitizeFilenamePart(placementLabel)}`
    : ''
  const pageSuffix = page ? orderedPageSuffix(page) : ''
  return `${
    sanitizeFilenamePart(productName)
  }${version}${placement}-${filenameSuffix}${pageSuffix}.png`
}

export function buildPosterExportArchiveFilename({
  productName,
  versionNumber,
  filenameSuffix,
}: PosterExportArchiveFilenameInput): string {
  const version = versionNumber ? `-v${versionNumber}` : ''
  return `${
    sanitizeFilenamePart(productName)
  }${version}-${filenameSuffix}-all-pages.zip`
}

function orderedPageSuffix({
  pageIndex,
  pageCount,
}: PosterExportPage): string {
  if (
    !Number.isInteger(pageIndex)
    || !Number.isInteger(pageCount)
    || pageCount <= 0
    || pageIndex < 0
    || pageIndex >= pageCount
  ) {
    throw new RangeError('Poster export page is outside the post.')
  }
  return `-page-${String(pageIndex + 1).padStart(2, '0')}-of-${
    String(pageCount).padStart(2, '0')
  }`
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(/\W+/g, '-')
}
