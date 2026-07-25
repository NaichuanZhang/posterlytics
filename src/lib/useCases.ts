import type { TranslationKey } from '../i18n/messages'
import type { PosterSizeSlug } from './posterSize'

export const USE_CASE_IDS = [
  'website_product',
  'amazon_listing',
  'social_cover',
  'rednote_post',
  'event',
] as const

export type UseCaseId = (typeof USE_CASE_IDS)[number]
export type CreatableUseCaseId = Exclude<UseCaseId, 'event'>
export type ReferenceOnlyUseCaseId = Extract<
  UseCaseId,
  'social_cover' | 'rednote_post'
>
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
  readonly platformHint: UseCaseFieldRequirement
  readonly referenceImages: {
    readonly requirement: UseCaseFieldRequirement
    readonly minimumCount: number
  }
}

export interface UseCaseDescriptor<Id extends UseCaseId = UseCaseId> {
  readonly id: Id
  readonly label: TranslationKey
  readonly creationDescription: TranslationKey | null
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
    creationDescription: catalogLabel('Create from a product website and its visual identity.'),
    creationEnabled: true,
    inputFields: {
      productUrl: { requirement: 'required', sourceKind: 'website' },
      productName: 'required',
      tagline: 'optional',
      ctaText: 'required',
      destinationUrl: 'required',
      referenceContext: 'optional',
      platformHint: 'hidden',
      referenceImages: { requirement: 'optional', minimumCount: 0 },
    },
    allowedPosterFormats: ALL_POSTER_FORMATS,
    defaultPosterFormat: 'a4_2x3',
    trackingEnabled: true,
  },
  {
    id: 'amazon_listing',
    label: catalogLabel('Amazon listing'),
    creationDescription: catalogLabel('Create from an Amazon listing plus seller-provided copy and images.'),
    creationEnabled: true,
    inputFields: {
      productUrl: { requirement: 'required', sourceKind: 'amazon' },
      productName: 'required',
      tagline: 'optional',
      ctaText: 'required',
      destinationUrl: 'required',
      referenceContext: 'optional',
      platformHint: 'hidden',
      referenceImages: { requirement: 'required', minimumCount: 1 },
    },
    allowedPosterFormats: ALL_POSTER_FORMATS,
    defaultPosterFormat: 'a4_2x3',
    trackingEnabled: true,
  },
  {
    id: 'social_cover',
    label: catalogLabel('Social cover'),
    creationDescription: catalogLabel('Create full-bleed artwork from creative references and direction.'),
    creationEnabled: true,
    inputFields: {
      productUrl: { requirement: 'hidden', sourceKind: 'none' },
      productName: 'required',
      tagline: 'optional',
      ctaText: 'hidden',
      destinationUrl: 'hidden',
      referenceContext: 'optional',
      platformHint: 'optional',
      referenceImages: { requirement: 'required', minimumCount: 1 },
    },
    allowedPosterFormats: ['rednote_cover_3x4', 'rednote_3x4'],
    defaultPosterFormat: 'rednote_cover_3x4',
    trackingEnabled: true,
  },
  {
    id: 'rednote_post',
    label: catalogLabel('RedNote post'),
    creationDescription: catalogLabel('Create a 3:4 RedNote cover from draft copy and creative references.'),
    creationEnabled: true,
    inputFields: {
      productUrl: { requirement: 'hidden', sourceKind: 'none' },
      productName: 'required',
      tagline: 'optional',
      ctaText: 'hidden',
      destinationUrl: 'hidden',
      referenceContext: 'required',
      platformHint: 'optional',
      referenceImages: { requirement: 'required', minimumCount: 1 },
    },
    allowedPosterFormats: ['rednote_cover_3x4'],
    defaultPosterFormat: 'rednote_cover_3x4',
    trackingEnabled: false,
  },
  {
    id: 'event',
    label: catalogLabel('Event'),
    creationDescription: null,
    creationEnabled: false,
    inputFields: {
      productUrl: { requirement: 'hidden', sourceKind: 'none' },
      productName: 'hidden',
      tagline: 'hidden',
      ctaText: 'hidden',
      destinationUrl: 'hidden',
      referenceContext: 'hidden',
      platformHint: 'hidden',
      referenceImages: { requirement: 'hidden', minimumCount: 0 },
    },
    allowedPosterFormats: ALL_POSTER_FORMATS,
    defaultPosterFormat: 'a4_2x3',
    trackingEnabled: true,
  },
] as const satisfies readonly UseCaseDescriptor[]

export const CREATABLE_USE_CASES = USE_CASES.filter(
  (useCase) => useCase.creationEnabled,
) as readonly UseCaseDescriptor<CreatableUseCaseId>[]

const USE_CASE_BY_ID = new Map<UseCaseId, UseCaseDescriptor>(
  USE_CASES.map((useCase) => [useCase.id, useCase]),
)
const DEFAULT_USE_CASE = USE_CASES[0]

export function isUseCaseId(value: unknown): value is UseCaseId {
  return typeof value === 'string' && USE_CASE_BY_ID.has(value as UseCaseId)
}

export function isCreatableUseCaseId(
  value: unknown,
): value is CreatableUseCaseId {
  return isUseCaseId(value) && getUseCase(value).creationEnabled
}

export function isReferenceOnlyUseCaseId(
  value: unknown,
): value is ReferenceOnlyUseCaseId {
  return value === 'social_cover' || value === 'rednote_post'
}

export function allowsPersistedReferenceReuse(value: unknown): boolean {
  return value === 'amazon_listing' || isReferenceOnlyUseCaseId(value)
}

export function getUseCase(id: unknown): UseCaseDescriptor {
  return isUseCaseId(id) ? USE_CASE_BY_ID.get(id)! : DEFAULT_USE_CASE
}

export function resolvePosterFormatOnUseCaseSwitch(
  currentFormat: PosterSizeSlug,
  fromUseCaseId: CreatableUseCaseId | null,
  toUseCaseId: CreatableUseCaseId,
): PosterSizeSlug {
  const destination = getUseCase(toUseCaseId)
  if (
    fromUseCaseId === toUseCaseId
    && destination.allowedPosterFormats.includes(currentFormat)
  ) {
    return currentFormat
  }
  return destination.defaultPosterFormat
}
