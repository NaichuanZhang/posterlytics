import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createAdminClient, createClient } from '@insforge/sdk'

const project = JSON.parse(readFileSync('.insforge/project.json', 'utf8'))
if (!project.branched_from) {
  throw new Error('Refusing to run the asset review smoke test outside a backend branch.')
}

const jwtSecret = getSecret('JWT_SECRET')
const ownerRow = cliQuery('SELECT id, email FROM auth.users ORDER BY created_at LIMIT 1').rows[0]
if (!ownerRow?.id) throw new Error('The schema branch needs one seed auth user.')

const admin = createAdminClient({
  baseUrl: project.oss_host,
  apiKey: project.api_key,
  retryCount: 0,
})
const owner = userClient(ownerRow.id, ownerRow.email ?? 'branch-owner@example.com')
const other = userClient(randomUUID(), 'branch-other@example.com')
const campaignIds = new Set()

try {
  await testEditorReviewAndRetryReuse()
  await testEmptySelectionConfirmation()
  await testCancellation()
  if (process.env.SMOKE_DEPLOYED_WORKER === '1') {
    await testDeployedWorkerPreparation()
  }
  console.log('asset selection branch smoke passed')
} finally {
  await Promise.allSettled([...campaignIds].map((id) =>
    admin.database.from('campaigns').delete().eq('id', id)
  ))
}

async function testEditorReviewAndRetryReuse() {
  const campaignId = await createCampaign('Asset review smoke')
  const review = await prepareEditorReview(campaignId, 'editor-review-worker')
  assert.equal(review.generation.trace_schema_version, 2)
  assert.equal(review.generation.asset_selection_mode, 'editor')
  assert.equal(review.generation.asset_selection_status, 'pending')
  assert.equal(await count('generation_stage_traces', 'generation_id', review.generation.id), 4)

  const ids = Array.from({ length: 8 }, () => randomUUID())
  const candidates = ids.map((id, index) => ({
    id,
    candidate_key: `candidate-${index}`,
    source: index === 0
      ? 'previous-poster'
      : index === 1
        ? 'style-board'
        : index === 2
          ? 'logo'
          : 'product',
    url: `https://example.com/asset-${index}.png`,
    key: `asset/${index}.png`,
    filename: `asset-${index}.png`,
    mime_type: 'image/png',
    size_bytes: 100 + index,
    storage_source: 'branch-smoke',
    purpose: `Candidate ${index}`,
    metadata: { smoke: true },
    availability: index === 7 ? 'unavailable' : 'available',
    availability_reason: index === 7 ? 'Expected unavailable candidate.' : null,
    included: false,
    selection_rank: null,
    selection_reason: null,
    candidate_position: index + 1,
  }))
  await ok(admin.database.rpc('replace_generation_assets_for_worker', {
    p_generation_id: review.generation.id,
    p_user_id: ownerRow.id,
    p_assets: candidates,
  }))
  await updateTrace(review.generation.id, 'assets', {
    status: 'running',
    started_at: new Date().toISOString(),
  })
  const paused = row(await ok(admin.database.rpc('pause_generation_for_asset_review', {
    p_job_id: review.job.id,
    p_worker_id: review.workerId,
  })))
  assert.equal(paused.status, 'awaiting_review')
  assert.equal((await byId('poster_generations', review.generation.id)).status, 'reviewing')
  assert.equal((await trace(review.generation.id, 'assets')).status, 'awaiting_review')

  const activity = row(await ok(owner.database.rpc('generation_activity', { p_limit: 50 })))
  assert.equal(activity.items[0].status, 'awaiting_review')
  assert.equal(activity.items[0].asset_selection_mode, 'editor')
  assert.equal(activity.items[0].asset_selection_status, 'pending')

  const duplicateGeneration = await owner.database.rpc('enqueue_poster_generation', {
    p_campaign_id: campaignId,
    p_refresh_website: true,
    p_asset_selection_mode: 'yolo',
  })
  assert.ok(duplicateGeneration.error, 'reviewing generation did not retain the active lock')

  assert.equal((await ok(owner.database.from('generation_assets').select('id'))).length, 8)
  assert.deepEqual(await ok(other.database.from('generation_assets').select('id')), [])
  const browserMutation = await owner.database
    .from('generation_assets')
    .update({ included: true, selection_rank: 1 })
    .eq('id', ids[0])
  assert.ok(browserMutation.error, 'browser directly mutated generation assets')

  assert.ok((await owner.database.rpc('save_generation_asset_selection', {
    p_generation_id: review.generation.id,
    p_asset_ids: ids.slice(0, 7),
  })).error, 'seven selected images were accepted')
  assert.ok((await owner.database.rpc('save_generation_asset_selection', {
    p_generation_id: review.generation.id,
    p_asset_ids: [ids[0], ids[0]],
  })).error, 'duplicate selected ids were accepted')
  assert.ok((await owner.database.rpc('save_generation_asset_selection', {
    p_generation_id: review.generation.id,
    p_asset_ids: [ids[7]],
  })).error, 'unavailable selected image was accepted')
  assert.ok((await other.database.rpc('save_generation_asset_selection', {
    p_generation_id: review.generation.id,
    p_asset_ids: [],
  })).error, 'non-owner saved another user review')

  await ok(owner.database.rpc('save_generation_asset_selection', {
    p_generation_id: review.generation.id,
    p_asset_ids: [],
  }))
  await ok(owner.database.rpc('save_generation_asset_selection', {
    p_generation_id: review.generation.id,
    p_asset_ids: [ids[1], ids[0]],
  }))
  const confirmed = row(await ok(owner.database.rpc('confirm_generation_asset_selection', {
    p_generation_id: review.generation.id,
    p_asset_ids: [ids[1], ids[0]],
  })))
  assert.equal(confirmed.generation.asset_selection_status, 'completed')
  assert.equal(confirmed.generation.asset_selection_method, 'user')
  assert.equal(confirmed.job.status, 'queued')
  assert.equal(confirmed.job.stage, 'designer')
  const selected = await ok(admin.database
    .from('generation_assets')
    .select('id, selection_rank')
    .eq('generation_id', review.generation.id)
    .eq('included', true)
    .order('selection_rank'))
  assert.deepEqual(selected.map((asset) => asset.id), [ids[1], ids[0]])
  assert.equal((await trace(review.generation.id, 'assets')).status, 'succeeded')
  const unavailableSkips = (await trace(review.generation.id, 'assets')).skipped_images
  assert.deepEqual(unavailableSkips.map((skip) => skip.reason), ['fetch_failed'])
  assert.deepEqual(
    unavailableSkips.map((skip) => skip.detail),
    ['Expected unavailable candidate.'],
  )

  await ok(owner.database.rpc('record_generation_asset_provider_skips', {
    p_generation_id: review.generation.id,
    p_stage: 'designer',
    p_skips: [{
      asset: { asset_id: ids[1] },
      reason: 'fetch_failed',
      detail: 'Expected provider fetch failure.',
    }],
    p_user_id: ownerRow.id,
  }))
  const skipped = await byId('generation_assets', ids[1])
  assert.equal(skipped.provider_skips.length, 1)
  assert.equal(skipped.provider_skips[0].stage, 'designer')

  assert.ok((await owner.database.rpc('save_generation_asset_selection', {
    p_generation_id: review.generation.id,
    p_asset_ids: [],
  })).error, 'completed selection remained editable')
  const completedMutation = await admin.database
    .from('generation_assets')
    .update({ included: false, selection_rank: null })
    .eq('id', ids[1])
  assert.ok(completedMutation.error, 'completed selection bypassed its integrity guard')

  const designerJob = only(await claim('asset-review-designer', 1))
  assert.equal(designerJob.id, review.job.id)
  await update('poster_generations', review.generation.id, {
    status: 'designing',
    design_status: 'generating',
  })
  await updateTrace(review.generation.id, 'designer', {
    status: 'running',
    started_at: new Date().toISOString(),
  })
  const failed = row(await ok(admin.database.rpc('record_generation_job_failure', {
    p_job_id: review.job.id,
    p_worker_id: 'asset-review-designer',
    p_error_code: 'expected_smoke_failure',
    p_error_message: 'Expected failure after frozen selection.',
    p_retryable: false,
  })))
  assert.equal(failed.status, 'failed')

  const retry = row(await ok(owner.database.rpc('retry_poster_generation', {
    p_job_id: review.job.id,
  })))
  assert.equal(retry.generation.asset_selection_status, 'completed')
  assert.equal(retry.generation.asset_selection_method, 'retry_reuse')
  assert.equal(retry.job.stage, 'designer')
  const reused = await ok(admin.database
    .from('generation_assets')
    .select('source, included, selection_rank')
    .eq('generation_id', retry.generation.id)
    .order('candidate_position'))
  assert.equal(reused.length, 8)
  assert.deepEqual(
    reused.filter((asset) => asset.included).map((asset) => asset.selection_rank),
    [2, 1],
  )
  assert.equal((await trace(retry.generation.id, 'assets')).status, 'succeeded')
  await deleteCampaign(campaignId)
}

async function testEmptySelectionConfirmation() {
  const campaignId = await createCampaign('Empty asset selection smoke')
  const review = await prepareEditorReview(campaignId, 'empty-selection-worker')
  const candidateId = randomUUID()
  await ok(admin.database.rpc('replace_generation_assets_for_worker', {
    p_generation_id: review.generation.id,
    p_user_id: ownerRow.id,
    p_assets: [{
      id: candidateId,
      candidate_key: 'empty-selection-candidate',
      source: 'product',
      url: 'https://example.com/empty-selection.png',
      key: 'asset/empty-selection.png',
      filename: 'empty-selection.png',
      mime_type: 'image/png',
      size_bytes: 100,
      storage_source: 'branch-smoke',
      purpose: 'Candidate excluded by the editor.',
      metadata: { smoke: true },
      availability: 'available',
      availability_reason: null,
      included: true,
      selection_rank: 1,
      selection_reason: 'Default selection.',
      candidate_position: 1,
    }],
  }))
  await updateTrace(review.generation.id, 'assets', {
    status: 'running',
    started_at: new Date().toISOString(),
  })
  await ok(admin.database.rpc('pause_generation_for_asset_review', {
    p_job_id: review.job.id,
    p_worker_id: review.workerId,
  }))

  const confirmed = row(await ok(owner.database.rpc('confirm_generation_asset_selection', {
    p_generation_id: review.generation.id,
    p_asset_ids: [],
  })))
  assert.equal(confirmed.generation.asset_selection_status, 'completed')
  assert.equal(confirmed.job.status, 'queued')
  assert.equal(confirmed.job.stage, 'designer')
  assert.equal(
    await countIncludedAssets(review.generation.id),
    0,
  )
  const assetTrace = await trace(review.generation.id, 'assets')
  assert.equal(assetTrace.status, 'succeeded')
  assert.equal(assetTrace.failure_metadata.zero_selection, true)
  assert.deepEqual(assetTrace.attached_images, [])
  await deleteCampaign(campaignId)
}

async function testCancellation() {
  const campaignId = await createCampaign('Asset cancellation smoke')
  const review = await prepareEditorReview(campaignId, 'asset-cancel-worker')
  await ok(admin.database.rpc('replace_generation_assets_for_worker', {
    p_generation_id: review.generation.id,
    p_user_id: ownerRow.id,
    p_assets: [],
  }))
  await updateTrace(review.generation.id, 'assets', {
    status: 'running',
    started_at: new Date().toISOString(),
  })
  await ok(admin.database.rpc('pause_generation_for_asset_review', {
    p_job_id: review.job.id,
    p_worker_id: review.workerId,
  }))
  const canceled = row(await ok(owner.database.rpc('cancel_generation_asset_review', {
    p_generation_id: review.generation.id,
  })))
  assert.equal(canceled.generation.status, 'canceled')
  assert.equal(canceled.job.status, 'canceled')
  assert.ok((await traces(review.generation.id)).every(
    (item) => ['skipped', 'succeeded', 'canceled'].includes(item.status),
  ))

  const replacement = row(await ok(owner.database.rpc('enqueue_poster_generation', {
    p_campaign_id: campaignId,
    p_refresh_website: true,
  })))
  assert.equal(replacement.generation.asset_selection_mode, 'yolo')
  await deleteCampaign(campaignId)
}

async function testDeployedWorkerPreparation() {
  const campaignId = await createCampaign('Deployed asset worker smoke')
  const enqueued = row(await ok(owner.database.rpc('enqueue_poster_generation', {
    p_campaign_id: campaignId,
    p_refresh_website: true,
    p_asset_selection_mode: 'editor',
  })))
  const analyzeWorker = 'deployed-asset-analyze'
  only(await claim(analyzeWorker, 1))
  await update('poster_generations', enqueued.generation.id, { status: 'analyzing' })
  await updateTrace(enqueued.generation.id, 'analyze', {
    status: 'running',
    started_at: new Date().toISOString(),
  })
  await updateTrace(enqueued.generation.id, 'analyze', {
    status: 'succeeded',
    completed_at: new Date().toISOString(),
  })
  await ok(admin.database.rpc('advance_generation_job', {
    p_job_id: enqueued.job.id,
    p_worker_id: analyzeWorker,
    p_next_stage: 'assets',
  }))

  const invocation = JSON.parse(execFileSync(
    'npx',
    [
      '@insforge/cli',
      'functions',
      'invoke',
      'generation-worker',
      '--data',
      '{}',
      '--method',
      'POST',
    ],
    { encoding: 'utf8' },
  ))
  assert.equal(invocation.claimed, 1)
  assert.equal(invocation.results[0].result, 'awaiting_review')
  assert.equal((await byId('generation_jobs', enqueued.job.id)).status, 'awaiting_review')
  assert.equal((await byId('poster_generations', enqueued.generation.id)).status, 'reviewing')
  assert.equal((await trace(enqueued.generation.id, 'assets')).status, 'awaiting_review')
  await ok(owner.database.rpc('cancel_generation_asset_review', {
    p_generation_id: enqueued.generation.id,
  }))
  await deleteCampaign(campaignId)
}

async function prepareEditorReview(campaignId, workerId) {
  const enqueued = row(await ok(owner.database.rpc('enqueue_poster_generation', {
    p_campaign_id: campaignId,
    p_instruction: 'Branch asset review.',
    p_reference_images: [],
    p_refresh_website: true,
    p_color_scheme: 'light',
    p_asset_selection_mode: 'editor',
  })))
  const analyze = only(await claim(`${workerId}-analyze`, 1))
  await update('poster_generations', enqueued.generation.id, { status: 'analyzing' })
  await updateTrace(enqueued.generation.id, 'analyze', {
    status: 'running',
    started_at: new Date().toISOString(),
  })
  await updateTrace(enqueued.generation.id, 'analyze', {
    status: 'succeeded',
    completed_at: new Date().toISOString(),
  })
  await ok(admin.database.rpc('advance_generation_job', {
    p_job_id: enqueued.job.id,
    p_worker_id: `${workerId}-analyze`,
    p_next_stage: 'assets',
  }))
  const assets = only(await claim(workerId, 1))
  assert.equal(assets.stage, 'assets')
  return {
    ...enqueued,
    workerId,
  }
}

async function createCampaign(name) {
  const id = randomUUID()
  campaignIds.add(id)
  await ok(admin.database.from('campaigns').insert([{
    id,
    user_id: ownerRow.id,
    product_url: 'https://example.com/product',
    product_name: name,
    destination_url: 'https://example.com/start',
    scenario: 'product',
  }]))
  return id
}

async function deleteCampaign(id) {
  await ok(admin.database.from('campaigns').delete().eq('id', id))
  campaignIds.delete(id)
}

async function claim(workerId, limit) {
  return rows(await ok(admin.database.rpc('claim_generation_jobs', {
    p_worker_id: workerId,
    p_limit: limit,
    p_lease_seconds: 300,
  })))
}

async function update(table, id, patch) {
  await ok(admin.database.from(table).update(patch).eq('id', id))
}

async function updateTrace(generationId, stage, patch) {
  await ok(admin.database
    .from('generation_stage_traces')
    .update(patch)
    .eq('generation_id', generationId)
    .eq('stage', stage))
}

async function trace(generationId, stage) {
  return byFilters('generation_stage_traces', {
    generation_id: generationId,
    stage,
  })
}

async function traces(generationId) {
  return ok(admin.database
    .from('generation_stage_traces')
    .select('*')
    .eq('generation_id', generationId))
}

async function byId(table, id) {
  return byFilters(table, { id })
}

async function byFilters(table, filters) {
  let request = admin.database.from(table).select('*')
  for (const [column, value] of Object.entries(filters)) request = request.eq(column, value)
  return row(await ok(request.maybeSingle()))
}

async function count(table, column, value) {
  return (await ok(admin.database.from(table).select('id').eq(column, value))).length
}

async function countIncludedAssets(generationId) {
  return (await ok(admin.database
    .from('generation_assets')
    .select('id')
    .eq('generation_id', generationId)
    .eq('included', true))).length
}

async function ok(request) {
  const { data, error } = await request
  if (error) throw new Error(error.message)
  return data
}

function only(value) {
  const result = rows(value)
  assert.equal(result.length, 1)
  return result[0]
}

function row(value) {
  const result = Array.isArray(value) ? value[0] : value
  assert.ok(result && typeof result === 'object')
  return result
}

function rows(value) {
  if (Array.isArray(value)) return value
  return value && typeof value === 'object' ? [value] : []
}

function userClient(userId, email) {
  return createClient({
    baseUrl: project.oss_host,
    edgeFunctionToken: signJwt({
      sub: userId,
      email,
      role: 'authenticated',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    retryCount: 0,
  })
}

function signJwt(payload) {
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const body = encode(payload)
  const signature = createHmac('sha256', jwtSecret)
    .update(`${header}.${body}`)
    .digest('base64url')
  return `${header}.${body}.${signature}`
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function getSecret(key) {
  const output = execFileSync(
    'npx',
    ['@insforge/cli', 'secrets', 'get', key],
    { encoding: 'utf8' },
  ).trim()
  const match = new RegExp(`^${key}\\s*=\\s*(.+)$`).exec(output)
  if (!match) throw new Error(`Could not read ${key}.`)
  return match[1]
}

function cliQuery(sql) {
  return JSON.parse(execFileSync(
    'npx',
    ['@insforge/cli', 'db', 'query', sql, '--json'],
    { encoding: 'utf8' },
  ))
}
