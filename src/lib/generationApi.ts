import { insforge } from './insforge'
import { getDeviceColorScheme } from './colorScheme'
import type {
  GenerationActivity,
  GenerationJob,
  PosterGeneration,
  PosterGenerationStage,
  ReferenceImage,
} from './types'
import { normalizeGenerationActivity } from './generationActivity'

export type GenerationFunction = 'analyze' | 'designer' | 'hero'

export interface EnqueuedPosterGeneration {
  generation: PosterGeneration
  job: GenerationJob
}

export async function enqueuePosterGeneration(args: {
  campaignId: string
  instruction: string | null
  referenceImages: ReferenceImage[]
  refreshWebsite: boolean
}): Promise<EnqueuedPosterGeneration> {
  const { data, error } = await insforge.database.rpc('enqueue_poster_generation', {
    p_campaign_id: args.campaignId,
    p_instruction: args.instruction,
    p_reference_images: args.referenceImages,
    p_refresh_website: args.refreshWebsite,
    p_color_scheme: getDeviceColorScheme(),
  })
  if (error) throw new Error(error.message)

  const result = rpcRow<EnqueuedPosterGeneration>(data)
  if (!result?.generation?.id || !result.job?.id) {
    throw new Error('Generation could not be queued.')
  }
  return result
}

// Compatibility for callers outside the SPA that still import the old helper.
export async function createPosterGeneration(args: {
  campaignId: string
  instruction: string | null
  referenceImages: ReferenceImage[]
  refreshWebsite: boolean
}): Promise<PosterGeneration> {
  return (await enqueuePosterGeneration(args)).generation
}

export async function retryPosterGeneration(
  jobId: string,
): Promise<EnqueuedPosterGeneration> {
  const { data, error } = await insforge.database.rpc('retry_poster_generation', {
    p_job_id: jobId,
  })
  if (error) throw new Error(error.message)

  const result = rpcRow<EnqueuedPosterGeneration>(data)
  if (!result?.generation?.id || !result.job?.id) {
    throw new Error('Generation retry could not be queued.')
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

export async function activatePosterGeneration(generationId: string): Promise<PosterGeneration> {
  const { data, error } = await insforge.database.rpc('activate_poster_generation', {
    p_generation_id: generationId,
  })
  if (error) throw new Error(error.message)

  const generation = rpcRow<PosterGeneration>(data)
  if (!generation?.id) throw new Error('Version could not be activated.')
  return generation
}

export async function invokeGenerationFunction(
  slug: GenerationFunction,
  campaignId: string,
  generationId: string,
) {
  const body = {
    campaignId,
    generationId,
    ...(slug === 'analyze' ? { colorScheme: getDeviceColorScheme() } : {}),
  }
  const { data, error } = await insforge.functions.invoke(slug, { body })
  if (error) throw new Error(error.message ?? `${slug} failed`)
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
