import type {
  GenerationActivity,
  GenerationActivityItem,
  GenerationJobStage,
  GenerationJobStatus,
} from './types'

export type GenerationStageStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'skipped'
  | 'error'

export interface GenerationStageItem {
  key: GenerationJobStage
  label: string
  status: GenerationStageStatus
}

const ACTIVE_JOB_STATUSES = new Set<GenerationJobStatus>([
  'queued',
  'running',
  'retrying',
])

const GENERATION_STAGES: Array<{
  key: GenerationJobStage
  label: string
}> = [
  { key: 'analyze', label: 'Read website' },
  { key: 'designer', label: 'Design layout' },
  { key: 'hero', label: 'Paint poster' },
]

const STAGE_LABELS: Record<GenerationJobStage, string> = {
  analyze: 'Reading website',
  designer: 'Designing layout',
  hero: 'Painting poster',
}

export function isActiveGenerationJob(
  item: Pick<GenerationActivityItem, 'status'>,
): boolean {
  return ACTIVE_JOB_STATUSES.has(item.status)
}

export function generationActivityLabel(
  item: Pick<GenerationActivityItem, 'status' | 'stage'>,
): string {
  if (item.status === 'queued') return 'Queued'
  if (item.status === 'retrying') return 'Retrying'
  if (item.status === 'succeeded') return 'Ready'
  if (item.status === 'failed') return 'Failed'
  return STAGE_LABELS[item.stage]
}

export function generationStageLabel(stage: GenerationJobStage): string {
  return STAGE_LABELS[stage]
}

export function deriveGenerationStages(
  item: GenerationActivityItem,
): GenerationStageItem[] {
  const applicable = GENERATION_STAGES.filter((stage) => {
    if (stage.key === 'analyze') {
      return item.generation_mode === 'website_refresh'
    }
    if (stage.key === 'designer') return item.scenario !== 'event'
    return true
  })
  const currentIndex = applicable.findIndex((stage) => stage.key === item.stage)

  return GENERATION_STAGES.map((stage) => {
    const index = applicable.findIndex((candidate) => candidate.key === stage.key)
    if (index === -1) return { ...stage, status: 'skipped' as const }
    if (item.status === 'succeeded') return { ...stage, status: 'done' as const }
    if (index < currentIndex) return { ...stage, status: 'done' as const }
    if (index > currentIndex) return { ...stage, status: 'pending' as const }
    if (item.status === 'failed') return { ...stage, status: 'error' as const }
    if (item.status === 'queued') return { ...stage, status: 'pending' as const }
    return { ...stage, status: 'running' as const }
  })
}

export function activityForCampaign(
  items: readonly GenerationActivityItem[],
  campaignId: string,
): GenerationActivityItem | null {
  return items.find(
    (item) => item.campaign_id === campaignId && isActiveGenerationJob(item),
  ) ?? null
}

export function latestActivityForCampaign(
  items: readonly GenerationActivityItem[],
  campaignId: string,
): GenerationActivityItem | null {
  return items.find((item) => item.campaign_id === campaignId) ?? null
}

export function canRetryGeneration(
  item: Pick<GenerationActivityItem, 'status'>,
): boolean {
  return item.status === 'failed'
}

export function normalizeGenerationActivity(value: unknown): GenerationActivity {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  return {
    items: Array.isArray(record.items)
      ? record.items as GenerationActivityItem[]
      : [],
    unread_count: typeof record.unread_count === 'number'
      ? record.unread_count
      : 0,
    refreshed_at: typeof record.refreshed_at === 'string'
      ? record.refreshed_at
      : new Date().toISOString(),
  }
}

export function shouldAutoSelectGeneration(args: {
  completedGenerationId: string
  selectedGenerationId: string | null
  selectionWasDeliberate: boolean
}): boolean {
  return !args.selectionWasDeliberate
    || args.selectedGenerationId === null
    || args.selectedGenerationId === args.completedGenerationId
}

export function elapsedSeconds(
  item: Pick<GenerationActivityItem, 'created_at' | 'started_at' | 'completed_at'>,
  now = Date.now(),
): number {
  const start = Date.parse(item.started_at ?? item.created_at)
  const end = item.completed_at ? Date.parse(item.completed_at) : now
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, Math.floor((end - start) / 1000))
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainder}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}
