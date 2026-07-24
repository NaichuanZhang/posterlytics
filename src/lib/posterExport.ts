import {
  hasPosterQrBand,
  type PosterSize,
} from './posterSize'
import { isCampaignTrackingActive } from './trackingPolicy'
import type { Campaign, Placement } from './types'

export interface PosterExportPage {
  readonly pageIndex: number
  readonly pageCount: number
}

export interface PosterExportRunSnapshot {
  readonly campaign: Campaign
  readonly posterSize: PosterSize
  readonly heroImageUrl: string | null
  readonly placementCode: string | null
  readonly includesQrBand: boolean
  readonly requiresQrImage: boolean
  readonly capture: {
    readonly width: number
    readonly height: number
    readonly pixelRatio: number
  }
  readonly naming: {
    readonly productName: string
    readonly versionNumber?: number
    readonly placementLabel?: string
    readonly filenameSuffix: string
  }
  readonly pages: {
    readonly selected?: PosterExportPage
    readonly count: number | null
  }
}

interface PosterExportRunSnapshotInput {
  readonly campaign: Campaign
  readonly placement?: Placement | null
  readonly versionNumber?: number
  readonly posterSize: PosterSize
  readonly pageIndex: number
  readonly pageCount: number | null
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

export function buildPosterExportRunSnapshot({
  campaign,
  placement,
  versionNumber,
  posterSize,
  pageIndex,
  pageCount,
}: PosterExportRunSnapshotInput): PosterExportRunSnapshot {
  const runCampaign = campaign
  const includesQrBand = hasPosterQrBand(posterSize)
  const placementCode = placement?.code ?? null
  if (
    includesQrBand
    && isCampaignTrackingActive(runCampaign)
    && !placementCode
  ) {
    throw new RangeError('Tracked QR export requires a prepared placement code.')
  }
  const selected = pageCount === null
    ? undefined
    : { pageIndex, pageCount }

  return {
    campaign: runCampaign,
    posterSize,
    heroImageUrl: runCampaign.hero_image_url,
    placementCode,
    includesQrBand,
    requiresQrImage: includesQrBand && !!placementCode,
    capture: {
      width: posterSize.sheet.width,
      height: posterSize.sheet.height,
      pixelRatio: posterSize.export.pixelRatio,
    },
    naming: {
      productName: runCampaign.product_name,
      versionNumber,
      placementLabel: includesQrBand && placement
        ? placement.label
        : undefined,
      filenameSuffix: posterSize.export.filenameSuffix,
    },
    pages: {
      selected,
      count: pageCount,
    },
  }
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
