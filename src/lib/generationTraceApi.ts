import { insforge } from './insforge'
import type { TraceImageAsset } from './types'

interface GenerationHeroImagesRow {
  attached_images: TraceImageAsset[]
}

export async function fetchGenerationHeroImages(
  generationId: string,
): Promise<TraceImageAsset[] | null> {
  const { data, error } = await insforge.database
    .from('generation_stage_traces')
    .select('attached_images')
    .eq('generation_id', generationId)
    .eq('stage', 'hero')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null
  const row = data as GenerationHeroImagesRow
  return Array.isArray(row.attached_images) ? row.attached_images : []
}
