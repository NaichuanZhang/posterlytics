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

/**
 * Formats a tracking-enabled use case may be created or regenerated in.
 *
 * Now the full registry: QR/destination/placement policy keys off the
 * descriptor's band mode rather than the RedNote pair, so every bandless twin is
 * safe to offer. A bandless format does NOT retire tracking — destination
 * presence is the link-validity invariant, so a creator may keep a tracked link
 * while exporting full-bleed artwork.
 */
const ALL_POSTER_FORMATS = [
  'a4_2x3',
  'a4_2x3_cover',
  'rednote_3x4',
  'rednote_cover_3x4',
  'yt_thumb_16x9',
  'yt_thumb_16x9_cover',
  'luma_1x1',
  'luma_1x1_cover',
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

/**
 * True for use cases whose source is never fetched or captured.
 *
 * Amazon listings are deliberately never scraped (CAPTCHA / anti-automation),
 * and reference-only use cases have no source URL at all. Deliberately separate
 * from `isReferenceOnlyUseCaseId`, which also governs generation behaviour —
 * widening that would change what the pipeline does, whereas this only governs
 * how provenance is described in the UI.
 */
export function readsSourceWebsite(value: unknown): boolean {
  return !(value === 'amazon_listing' || isReferenceOnlyUseCaseId(value))
}

export function getUseCase(id: unknown): UseCaseDescriptor {
  return isUseCaseId(id) ? USE_CASE_BY_ID.get(id)! : DEFAULT_USE_CASE
}

/**
 * What the creator is producing, as an explicit choice rather than an inference.
 *
 * `'poster'` covers every tracked print/still output; `'post'` selects the
 * RedNote post pipeline. This is the ONLY discriminator between `social_cover`
 * and `rednote_post`: their persisted evidence columns are byte-identical, so no
 * amount of submitted evidence can tell them apart.
 */
export type CreationOutputKind = 'poster' | 'post'

export interface CreationUseCaseInput {
  /** Whether the creator supplied at least one source URL. */
  readonly hasSourceUrl: boolean
  /** Whether EVERY supplied source URL is a recognized Amazon host. */
  readonly allSourceUrlsAmazon: boolean
  readonly outputKind: CreationOutputKind
}

/**
 * Maps an explicit creation intent onto the persisted `use_case` literal.
 *
 * `use_case` is chosen at creation, written once at INSERT, frozen by
 * `campaigns_guard_source_intent_update`, copied forward by
 * `enqueue_poster_generation`, and thereafter read only from the
 * `poster_generations` snapshot — never re-derived at read time. Callers must
 * persist this result, not recompute it later from evidence.
 *
 * Never returns `'event'`: event campaigns are historical and cannot be created.
 */
export function resolveCreationUseCase(
  input: CreationUseCaseInput,
): CreatableUseCaseId {
  if (input.outputKind === 'post') return 'rednote_post'
  if (!input.hasSourceUrl) return 'social_cover'
  return input.allSourceUrlsAmazon ? 'amazon_listing' : 'website_product'
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
