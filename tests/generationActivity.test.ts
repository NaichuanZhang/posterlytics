import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  activityForCampaign,
  deriveGenerationStages,
  elapsedSeconds,
  formatElapsed,
  generationActivityLabel,
  normalizeGenerationActivity,
  shouldAutoSelectGeneration,
} from '../src/lib/generationActivity.ts'
import type { GenerationActivityItem } from '../src/lib/types.ts'

function activity(
  patch: Partial<GenerationActivityItem> = {},
): GenerationActivityItem {
  return {
    job_id: 'job-1',
    generation_id: 'generation-1',
    campaign_id: 'campaign-1',
    campaign_name: 'Northstar',
    status: 'running',
    stage: 'designer',
    color_scheme: 'light',
    attempt_count: 1,
    retry_count: 0,
    max_attempts: 3,
    available_at: '2026-07-17T20:00:00.000Z',
    started_at: '2026-07-17T20:00:05.000Z',
    completed_at: null,
    created_at: '2026-07-17T20:00:00.000Z',
    updated_at: '2026-07-17T20:00:05.000Z',
    last_error_code: null,
    last_error_message: null,
    generation_status: 'designing',
    version_number: null,
    generation_mode: 'website_refresh',
    scenario: 'product',
    instruction: null,
    hero_image_url: null,
    asset_selection_mode: null,
    asset_selection_status: null,
    asset_selection_method: null,
    asset_selection_completed_at: null,
    generation_created_at: '2026-07-17T20:00:00.000Z',
    notification_id: null,
    notification_outcome: null,
    read_at: null,
    notification_created_at: null,
    ...patch,
  }
}

test('activity helpers expose active jobs and real stage labels', () => {
  const queued = activity({ status: 'queued', stage: 'analyze' })
  const retrying = activity({ status: 'retrying', stage: 'hero' })
  const ready = activity({ status: 'succeeded', stage: 'hero' })

  assert.equal(activityForCampaign([ready, queued], 'campaign-1'), queued)
  assert.equal(generationActivityLabel(queued), 'Queued')
  assert.equal(generationActivityLabel(retrying), 'Retrying')
  assert.equal(generationActivityLabel(activity()), 'Designing layout')
  assert.equal(generationActivityLabel(ready), 'Ready')
  assert.equal(
    generationActivityLabel(activity({ stage: 'future' as GenerationActivityItem['stage'] })),
    'future',
  )
})

test('durable stages mark completed, current, pending, and skipped work', () => {
  assert.deepEqual(
    deriveGenerationStages(activity()).map(({ key, status }) => [key, status]),
    [
      ['analyze', 'done'],
      ['assets', 'skipped'],
      ['designer', 'running'],
      ['hero', 'pending'],
    ],
  )
  assert.deepEqual(
    deriveGenerationStages(activity({
      status: 'queued',
      stage: 'hero',
      generation_mode: 'iteration',
      scenario: 'event',
    })).map(({ key, status }) => [key, status]),
    [
      ['analyze', 'skipped'],
      ['assets', 'skipped'],
      ['designer', 'skipped'],
      ['hero', 'pending'],
    ],
  )
  assert.equal(
    deriveGenerationStages(activity({ status: 'failed', stage: 'hero' }))[3].status,
    'error',
  )
})

test('asset review is active, directly labeled, and never represented as a running stage', () => {
  const review = activity({
    status: 'awaiting_review',
    stage: 'assets',
    generation_status: 'reviewing',
    asset_selection_mode: 'editor',
    asset_selection_status: 'pending',
  })
  assert.equal(activityForCampaign([review], 'campaign-1'), review)
  assert.equal(generationActivityLabel(review), 'Assets ready for review')
  assert.deepEqual(
    deriveGenerationStages(review).map(({ key, status }) => [key, status]),
    [
      ['analyze', 'done'],
      ['assets', 'review'],
      ['designer', 'pending'],
      ['hero', 'pending'],
    ],
  )
})

test('completion only replaces a deliberate canvas selection when it is the same version', () => {
  assert.equal(shouldAutoSelectGeneration({
    completedGenerationId: 'new',
    selectedGenerationId: 'old',
    selectionWasDeliberate: true,
  }), false)
  assert.equal(shouldAutoSelectGeneration({
    completedGenerationId: 'new',
    selectedGenerationId: 'old',
    selectionWasDeliberate: false,
  }), true)
  assert.equal(shouldAutoSelectGeneration({
    completedGenerationId: 'new',
    selectedGenerationId: 'new',
    selectionWasDeliberate: true,
  }), true)
})

test('elapsed time uses authoritative timestamps and formats without percentages', () => {
  assert.equal(elapsedSeconds(activity(), Date.parse('2026-07-17T20:01:10.000Z')), 65)
  assert.equal(formatElapsed(65), '1m 5s')
  assert.equal(formatElapsed(3661), '1h 1m')
})

test('activity normalization is defensive for missing RPC fields', () => {
  assert.deepEqual(normalizeGenerationActivity(null).items, [])
  assert.equal(normalizeGenerationActivity({ unread_count: 2 }).unread_count, 2)
})

test('activity helpers localize labels and elapsed time in Chinese', () => {
  assert.equal(generationActivityLabel(activity(), 'zh-CN'), '正在设计版式')
  assert.equal(
    generationActivityLabel(activity({ status: 'awaiting_review' }), 'zh-CN'),
    '素材已可审核',
  )
  assert.equal(formatElapsed(65, 'zh-CN'), '1分5秒')
  assert.deepEqual(
    deriveGenerationStages(activity(), 'zh-CN').map(({ label }) => label),
    ['读取网站', '选择素材', '设计版式', '绘制海报'],
  )
})
