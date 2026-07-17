import { insforge } from './insforge'
import { getDeviceColorScheme } from './colorScheme'
import type {
  PosterGeneration,
  PosterGenerationStage,
  ReferenceImage,
} from './types'

export type GenerationFunction = 'analyze' | 'designer' | 'hero'

export async function createPosterGeneration(args: {
  campaignId: string
  instruction: string | null
  referenceImages: ReferenceImage[]
  refreshWebsite: boolean
}): Promise<PosterGeneration> {
  const { data, error } = await insforge.database.rpc('create_poster_generation', {
    p_campaign_id: args.campaignId,
    p_instruction: args.instruction,
    p_reference_images: args.referenceImages,
    p_refresh_website: args.refreshWebsite,
  })
  if (error) throw new Error(error.message)

  const generation = rpcRow<PosterGeneration>(data)
  if (!generation?.id) throw new Error('Generation could not be created.')
  return generation
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
