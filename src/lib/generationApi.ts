import { insforge } from './insforge'
import {
  getDeviceColorScheme,
  type DeviceColorScheme,
} from './colorScheme'
import type { TranslationKey } from '../i18n/messages'
import type {
  AssetSelectionMode,
  GenerationAsset,
  GenerationActivity,
  GenerationJob,
  PosterGeneration,
  PosterGenerationStage,
  ReferenceImage,
} from './types'
import { normalizeGenerationActivity } from './generationActivity'
import {
  DEFAULT_LOCALE,
  translate,
  type SupportedLocale,
} from './i18n'

export type GenerationFunction = 'analyze' | 'designer' | 'hero'

const GENERATION_FUNCTION_ERROR_KEYS: Record<GenerationFunction, TranslationKey> = {
  analyze: 'Analyze failed',
  designer: 'Designer failed',
  hero: 'Image model failed',
}

const SOCIAL_REFERENCE_MINIMUM_ERROR =
  'Social cover generation requires at least one reference image.'

export interface EnqueuedPosterGeneration {
  generation: PosterGeneration
  job: GenerationJob
}

export async function enqueuePosterGeneration(args: {
  campaignId: string
  instruction: string | null
  referenceImages: ReferenceImage[]
  refreshWebsite: boolean
  assetSelectionMode: AssetSelectionMode
  colorScheme: DeviceColorScheme
  locale?: SupportedLocale
}): Promise<EnqueuedPosterGeneration> {
  const { data, error } = await insforge.database.rpc('enqueue_poster_generation', {
    p_campaign_id: args.campaignId,
    p_instruction: args.instruction,
    p_reference_images: args.referenceImages,
    p_refresh_website: args.refreshWebsite,
    p_color_scheme: args.colorScheme,
    p_asset_selection_mode: args.assetSelectionMode,
  })
  if (error) {
    throw new Error(
      error.message === SOCIAL_REFERENCE_MINIMUM_ERROR
        ? translate(
            args.locale ?? DEFAULT_LOCALE,
            'Social cover generation requires at least one reference image.',
          )
        : error.message,
    )
  }

  const result = rpcRow<EnqueuedPosterGeneration>(data)
  if (!result?.generation?.id || !result.job?.id) {
    throw new Error(translate(args.locale ?? DEFAULT_LOCALE, 'Generation could not be queued.'))
  }
  return result
}

// Compatibility for callers outside the SPA that still import the old helper.
export async function createPosterGeneration(args: {
  campaignId: string
  instruction: string | null
  referenceImages: ReferenceImage[]
  refreshWebsite: boolean
  assetSelectionMode?: AssetSelectionMode
  colorScheme: DeviceColorScheme
}): Promise<PosterGeneration> {
  return (await enqueuePosterGeneration({
    ...args,
    assetSelectionMode: args.assetSelectionMode ?? 'yolo',
  })).generation
}

export async function retryPosterGeneration(
  jobId: string,
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<EnqueuedPosterGeneration> {
  const { data, error } = await insforge.database.rpc('retry_poster_generation', {
    p_job_id: jobId,
  })
  if (error) throw new Error(error.message)

  const result = rpcRow<EnqueuedPosterGeneration>(data)
  if (!result?.generation?.id || !result.job?.id) {
    throw new Error(translate(locale, 'Generation retry could not be queued.'))
  }
  return result
}

export async function fetchGenerationActivity(): Promise<GenerationActivity> {
  const { data, error } = await insforge.database.rpc('generation_activity', {
    p_limit: 50,
  })
  if (error) throw new Error(error.message)
  return normalizeGenerationActivity(rpcRow<unknown>(data))
}

export async function markGenerationNotificationsRead(
  notificationIds: string[] | null,
): Promise<void> {
  const { error } = await insforge.database.rpc('mark_generation_notifications_read', {
    p_notification_ids: notificationIds,
  })
  if (error) throw new Error(error.message)
}

export async function activatePosterGeneration(
  generationId: string,
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<PosterGeneration> {
  const { data, error } = await insforge.database.rpc('activate_poster_generation', {
    p_generation_id: generationId,
  })
  if (error) throw new Error(error.message)

  const generation = rpcRow<PosterGeneration>(data)
  if (!generation?.id) throw new Error(translate(locale, 'Version could not be activated.'))
  return generation
}

export async function fetchGenerationAssets(
  generationId: string,
): Promise<GenerationAsset[]> {
  const { data, error } = await insforge.database
    .from('generation_assets')
    .select('*')
    .eq('generation_id', generationId)
    .order('candidate_position', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as GenerationAsset[]
}

export async function fetchGenerationForAssetReview(
  campaignId: string,
  generationId: string,
): Promise<PosterGeneration | null> {
  const { data, error } = await insforge.database
    .from('poster_generations')
    .select('*')
    .eq('id', generationId)
    .eq('campaign_id', campaignId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as PosterGeneration | null
}

export async function saveGenerationAssetSelection(
  generationId: string,
  assetIds: string[],
): Promise<GenerationAsset[]> {
  const { data, error } = await insforge.database.rpc(
    'save_generation_asset_selection',
    {
      p_generation_id: generationId,
      p_asset_ids: assetIds,
    },
  )
  if (error) throw new Error(error.message)
  return rpcRows<GenerationAsset>(data)
}

export async function confirmGenerationAssetSelection(
  generationId: string,
  assetIds: string[],
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<EnqueuedPosterGeneration & { assets: GenerationAsset[] }> {
  const { data, error } = await insforge.database.rpc(
    'confirm_generation_asset_selection',
    {
      p_generation_id: generationId,
      p_asset_ids: assetIds,
    },
  )
  if (error) throw new Error(error.message)
  const result = rpcRow<EnqueuedPosterGeneration & { assets: GenerationAsset[] }>(data)
  if (!result?.generation?.id || !result.job?.id) {
    throw new Error(translate(locale, 'Asset selection could not be confirmed.'))
  }
  return result
}

export async function cancelGenerationAssetReview(
  generationId: string,
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<EnqueuedPosterGeneration> {
  const { data, error } = await insforge.database.rpc(
    'cancel_generation_asset_review',
    { p_generation_id: generationId },
  )
  if (error) throw new Error(error.message)
  const result = rpcRow<EnqueuedPosterGeneration>(data)
  if (!result?.generation?.id || !result.job?.id) {
    throw new Error(translate(locale, 'Asset review could not be canceled.'))
  }
  return result
}

export async function invokeGenerationFunction(
  slug: GenerationFunction,
  campaignId: string,
  generationId: string,
  locale: SupportedLocale = DEFAULT_LOCALE,
) {
  const body = {
    campaignId,
    generationId,
    ...(slug === 'analyze' ? { colorScheme: getDeviceColorScheme() } : {}),
  }
  const { data, error } = await insforge.functions.invoke(slug, { body })
  if (error) {
    throw new Error(
      error.message ?? translate(locale, GENERATION_FUNCTION_ERROR_KEYS[slug]),
    )
  }
  return data
}

export async function failPosterGeneration(
  generationId: string,
  stage: PosterGenerationStage,
  cause: unknown,
) {
  const message = cause instanceof Error ? cause.message : String(cause)
  await insforge.database
    .from('poster_generations')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      failure_stage: stage,
      failure_code: 'client_pipeline_error',
      failure_message: message.slice(0, 2000),
    })
    .eq('id', generationId)
}

function rpcRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null
  return value && typeof value === 'object' ? value as T : null
}

function rpcRows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  return value && typeof value === 'object' ? [value as T] : []
}
