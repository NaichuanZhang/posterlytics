import type { TranslationKey } from '../i18n/messages'
import type { PosterSizeSlug } from './posterSize'

export const USE_CASE_IDS = [
  'website_product',
  'amazon_listing',
  'event',
] as const

export type UseCaseId = (typeof USE_CASE_IDS)[number]
export type UseCaseFieldRequirement = 'required' | 'optional' | 'hidden'
export type UseCaseSourceKind = 'website' | 'amazon' | 'none'

export interface UseCaseInputFieldSpec {
  readonly productUrl: {
    readonly requirement: UseCaseFieldRequirement
    readonly sourceKind: UseCaseSourceKind
  }
  readonly productName: UseCaseFieldRequirement
  readonly tagline: UseCaseFieldRequirement
  readonly ctaText: UseCaseFieldRequirement
  readonly destinationUrl: UseCaseFieldRequirement
  readonly referenceContext: UseCaseFieldRequirement
  readonly referenceImages: {
    readonly requirement: UseCaseFieldRequirement
    readonly minimumCount: number
  }
}

export interface UseCaseDescriptor<Id extends UseCaseId = UseCaseId> {
  readonly id: Id
  readonly label: TranslationKey
  readonly creationEnabled: boolean
  readonly inputFields: UseCaseInputFieldSpec
  readonly allowedPosterFormats: readonly PosterSizeSlug[]
  readonly defaultPosterFormat: PosterSizeSlug
  readonly trackingEnabled: boolean
}

const ALL_POSTER_FORMATS = [
  'a4_2x3',
  'rednote_3x4',
  'rednote_cover_3x4',
  'yt_thumb_16x9',
  'luma_1x1',
] as const satisfies readonly PosterSizeSlug[]

function catalogLabel<Key extends TranslationKey>(label: Key): Key {
  return label
}

export const USE_CASES = [
  {
    id: 'website_product',
    label: catalogLabel('Website product'),
    creationEnabled: true,
    inputFields: {
      productUrl: { requirement: 'required', sourceKind: 'website' },
      productName: 'required',
      tagline: 'optional',
      ctaText: 'required',
      destinationUrl: 'required',
      referenceContext: 'optional',
      referenceImages: { requirement: 'optional', minimumCount: 0 },
    },
    allowedPosterFormats: ALL_POSTER_FORMATS,
    defaultPosterFormat: 'a4_2x3',
    trackingEnabled: true,
  },
  {
    id: 'amazon_listing',
    label: catalogLabel('Amazon listing'),
    creationEnabled: true,
    inputFields: {
      productUrl: { requirement: 'required', sourceKind: 'amazon' },
      productName: 'required',
      tagline: 'optional',
      ctaText: 'required',
      destinationUrl: 'required',
      referenceContext: 'optional',
      referenceImages: { requirement: 'optional', minimumCount: 0 },
    },
    allowedPosterFormats: ALL_POSTER_FORMATS,
    defaultPosterFormat: 'a4_2x3',
    trackingEnabled: true,
  },
  {
    id: 'event',
    label: catalogLabel('Event'),
    creationEnabled: false,
    inputFields: {
      productUrl: { requirement: 'hidden', sourceKind: 'none' },
      productName: 'hidden',
      tagline: 'hidden',
      ctaText: 'hidden',
      destinationUrl: 'hidden',
      referenceContext: 'hidden',
      referenceImages: { requirement: 'hidden', minimumCount: 0 },
    },
    allowedPosterFormats: ALL_POSTER_FORMATS,
    defaultPosterFormat: 'a4_2x3',
    trackingEnabled: true,
  },
] as const satisfies readonly UseCaseDescriptor[]

const USE_CASE_BY_ID = new Map<UseCaseId, UseCaseDescriptor>(
  USE_CASES.map((useCase) => [useCase.id, useCase]),
)

export function isUseCaseId(value: unknown): value is UseCaseId {
  return typeof value === 'string' && USE_CASE_BY_ID.has(value as UseCaseId)
}

export function getUseCase(id: UseCaseId): UseCaseDescriptor {
  return USE_CASE_BY_ID.get(id)!
}
