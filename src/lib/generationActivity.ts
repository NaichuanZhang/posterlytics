import type {
  GenerationActivity,
  GenerationActivityItem,
  GenerationJobStage,
  GenerationJobStatus,
} from './types'
import type { TranslationKey } from '../i18n/messages'
import {
  DEFAULT_LOCALE,
  translate,
  type SupportedLocale,
} from './i18n'

export type GenerationStageStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'review'
  | 'skipped'
  | 'error'
  | 'canceled'

export interface GenerationStageItem {
  key: GenerationJobStage
  label: string
  status: GenerationStageStatus
}

const ACTIVE_JOB_STATUSES = new Set<GenerationJobStatus>([
  'queued',
  'running',
  'retrying',
  'awaiting_review',
])

const GENERATION_STAGES: Array<{
  key: GenerationJobStage
  label: TranslationKey
}> = [
  { key: 'analyze', label: 'Read website' },
  { key: 'assets', label: 'Select assets' },
  { key: 'designer', label: 'Design layout' },
  { key: 'hero', label: 'Paint poster' },
]

const STAGE_LABELS: Record<GenerationJobStage, TranslationKey> = {
  analyze: 'Reading website',
  assets: 'Selecting assets',
  designer: 'Designing layout',
  hero: 'Painting poster',
}

export function isActiveGenerationJob(
  item: Pick<GenerationActivityItem, 'status'>,
): boolean {
  return ACTIVE_JOB_STATUSES.has(item.status)
}

export function generationActivityLabel(
  item: Pick<GenerationActivityItem, 'status' | 'stage' | 'use_case'>,
  locale: SupportedLocale = DEFAULT_LOCALE,
): string {
  if (item.status === 'queued') return translate(locale, 'Queued')
  if (item.status === 'retrying') return translate(locale, 'Retrying')
  if (item.status === 'awaiting_review') return translate(locale, 'Assets ready for review')
  if (item.status === 'succeeded') return translate(locale, 'Ready')
  if (item.status === 'failed') return translate(locale, 'Failed')
  if (item.status === 'canceled') return translate(locale, 'Canceled')
  if (item.stage === 'analyze' && item.use_case === 'social_cover') {
    return translate(locale, 'Analyzing references')
  }
  const stageLabel = STAGE_LABELS[item.stage]
  return stageLabel ? translate(locale, stageLabel) : String(item.stage)
}

export function generationStageLabel(
  stage: GenerationJobStage,
  locale: SupportedLocale = DEFAULT_LOCALE,
  useCase?: GenerationActivityItem['use_case'],
): string {
  if (stage === 'analyze' && useCase === 'social_cover') {
    return translate(locale, 'Analyze references')
  }
  const stageLabel = STAGE_LABELS[stage]
  return stageLabel ? translate(locale, stageLabel) : String(stage)
}

export function deriveGenerationStages(
  item: GenerationActivityItem,
  locale: SupportedLocale = DEFAULT_LOCALE,
): GenerationStageItem[] {
  const applicable = GENERATION_STAGES.filter((stage) => {
    if (stage.key === 'analyze') {
      return item.generation_mode === 'website_refresh'
    }
    if (stage.key === 'assets') {
      return item.asset_selection_mode === 'editor' || item.asset_selection_mode === 'yolo'
    }
    if (stage.key === 'designer') return item.scenario !== 'event'
    return true
  })
  const currentIndex = applicable.findIndex((stage) => stage.key === item.stage)

  return GENERATION_STAGES.map((stage) => {
    const index = applicable.findIndex((candidate) => candidate.key === stage.key)
    let status: GenerationStageStatus
    if (index === -1) status = 'skipped'
    else if (item.status === 'succeeded') status = 'done'
    else if (index < currentIndex) status = 'done'
    else if (index > currentIndex) status = 'pending'
    else if (item.status === 'failed') status = 'error'
    else if (item.status === 'canceled') status = 'canceled'
    else if (item.status === 'awaiting_review') status = 'review'
    else if (item.status === 'queued') status = 'pending'
    else status = 'running'

    const labelKey = stage.key === 'analyze' && item.use_case === 'social_cover'
      ? status === 'done'
        ? 'References analyzed'
        : 'Analyze references'
      : stage.label
    return { key: stage.key, label: translate(locale, labelKey), status }
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

export function formatElapsed(
  seconds: number,
  locale: SupportedLocale = DEFAULT_LOCALE,
): string {
  if (seconds < 60) return translate(locale, '{seconds}s', { seconds })
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (minutes < 60) {
    return translate(locale, '{minutes}m {seconds}s', {
      minutes,
      seconds: remainder,
    })
  }
  const hours = Math.floor(minutes / 60)
  return translate(locale, '{hours}h {minutes}m', {
    hours,
    minutes: minutes % 60,
  })
}
