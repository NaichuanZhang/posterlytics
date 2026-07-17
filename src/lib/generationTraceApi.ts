import { insforge } from './insforge'
import { TRACE_STAGE_ORDER } from './generationTraces'
import type { GenerationStageTrace } from './types'

export async function fetchGenerationStageTraces(
  generationId: string,
): Promise<GenerationStageTrace[]> {
  const { data, error } = await insforge.database
    .from('generation_stage_traces')
    .select('*')
    .eq('generation_id', generationId)

  if (error) throw new Error(error.message)
  const traces = (data ?? []) as GenerationStageTrace[]
  return traces.sort(
    (a, b) => TRACE_STAGE_ORDER.indexOf(a.stage) - TRACE_STAGE_ORDER.indexOf(b.stage),
  )
}
