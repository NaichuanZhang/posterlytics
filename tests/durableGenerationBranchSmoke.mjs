import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createAdminClient, createClient } from '@insforge/sdk'

const project = JSON.parse(readFileSync('.insforge/project.json', 'utf8'))
if (!project.branched_from) {
  throw new Error('Refusing to run the durable generation smoke test outside a backend branch.')
}

const jwtSecret = getSecret('JWT_SECRET')
const ownerRow = cliQuery('SELECT id, email FROM auth.users ORDER BY created_at LIMIT 1').rows[0]
if (!ownerRow?.id) throw new Error('The schema branch needs one seed auth user.')

const admin = createAdminClient({
  baseUrl: project.oss_host,
  apiKey: project.api_key,
  retryCount: 0,
})
const owner = createUserClient(ownerRow.id, ownerRow.email ?? 'branch-owner@example.com')
const other = createUserClient(randomUUID(), 'branch-other@example.com')
const campaignIds = new Set()

try {
  await testConcurrentClaims()
  await testRetryAndCompletionLifecycle()
  if (process.env.SMOKE_DEPLOYED_WORKER === '1') {
    await testDeployedWorkerReconciliation()
  }
  console.log('durable generation branch smoke passed')
} finally {
  await Promise.allSettled(
    [...campaignIds].map((campaignId) =>
      admin.database.from('campaigns').delete().eq('id', campaignId)
    ),
  )
}

async function testDeployedWorkerReconciliation() {
  const campaignId = await createCampaign('Deployed worker smoke test', 'event')
  const generationId = randomUUID()
  const jobId = randomUUID()

  await ok(admin.database.from('poster_generations').insert([{
    id: generationId,
    campaign_id: campaignId,
    user_id: ownerRow.id,
    version_number: 1,
    status: 'ready',
    generation_mode: 'iteration',
    scenario: 'event',
    use_case: 'event',
    trace_schema_version: 1,
    hero_image_url: 'https://example.com/already-ready.png',
    hero_image_key: 'poster/branch-smoke/already-ready.png',
    completed_at: new Date().toISOString(),
  }]))
  await ok(admin.database.from('generation_jobs').insert([{
    id: jobId,
    generation_id: generationId,
    campaign_id: campaignId,
    user_id: ownerRow.id,
    status: 'queued',
    stage: 'hero',
    color_scheme: 'light',
  }]))

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
  assert.equal(invocation.results[0].job_id, jobId)
  assert.equal(invocation.results[0].result, 'completed')
  assert.equal((await byId('generation_jobs', jobId)).status, 'succeeded')
  assert.equal((await trace(generationId, 'hero')).status, 'succeeded')

  const notifications = await ok(admin.database
    .from('generation_notifications')
    .select('*')
    .eq('job_id', jobId))
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].outcome, 'ready')
  await deleteCampaign(campaignId)
}

async function testConcurrentClaims() {
  const first = await createCampaign('Concurrent claim A', 'product')
  const second = await createCampaign('Concurrent claim B', 'product')
  const third = await createCampaign('Concurrent claim C', 'product')
  const firstEnqueue = await enqueue(first, { instruction: 'Concurrent A' })
  const secondEnqueue = await enqueue(second, { instruction: 'Concurrent B' })
  const thirdEnqueue = await enqueue(third, { instruction: 'Concurrent C' })
  const allJobIds = [
    firstEnqueue.job.id,
    secondEnqueue.job.id,
    thirdEnqueue.job.id,
  ]

  const claims = await Promise.all([
    claim('branch-concurrent-a', 2),
    claim('branch-concurrent-b', 2),
  ])
  const claimed = claims.flat()
  assert.equal(claimed.length, 2)
  assert.equal(new Set(claimed.map((job) => job.id)).size, 2)
  assert.ok(claimed.every((job) => allJobIds.includes(job.id)))
  const remainingJobId = allJobIds.find(
    (jobId) => !claimed.some((job) => job.id === jobId),
  )
  assert.ok(remainingJobId)
  assert.equal((await byId('generation_jobs', remainingJobId)).status, 'queued')

  for (const job of claimed) {
    const workerId = job.lease_owner
    assert.ok(workerId)
    const failed = rpcRow(await ok(admin.database.rpc('record_generation_job_failure', {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_error_code: 'branch_concurrency_complete',
      p_error_message: 'Expected branch-only terminal cleanup.',
      p_retryable: false,
    })))
    assert.equal(failed.status, 'failed')
  }

  const releasedSlotClaim = only(await claim('branch-concurrent-c', 2))
  assert.equal(releasedSlotClaim.id, remainingJobId)
  const releasedSlotFailure = rpcRow(await ok(admin.database.rpc('record_generation_job_failure', {
    p_job_id: releasedSlotClaim.id,
    p_worker_id: releasedSlotClaim.lease_owner,
    p_error_code: 'branch_concurrency_complete',
    p_error_message: 'Expected branch-only terminal cleanup.',
    p_retryable: false,
  })))
  assert.equal(releasedSlotFailure.status, 'failed')

  await deleteCampaign(first)
  await deleteCampaign(second)
  await deleteCampaign(third)
}

async function testRetryAndCompletionLifecycle() {
  const productCampaign = await createCampaign('Queue product smoke test', 'product')
  const product = await enqueue(productCampaign, {
    instruction: 'Keep the headline concise.',
    colorScheme: 'dark',
    references: [{
      key: 'reference/test.png',
      url: 'https://example.com/test.png',
      name: 'test.png',
      mime_type: 'image/png',
      size_bytes: 12,
    }],
  })

  assert.equal(product.job.status, 'queued')
  assert.equal(product.job.stage, 'analyze')
  assert.equal(product.job.color_scheme, 'dark')
  assert.equal(
    await count('generation_stage_traces', 'generation_id', product.generation.id),
    4,
  )

  const blockedWrite = await owner.database
    .from('generation_jobs')
    .update({ status: 'failed' })
    .eq('id', product.job.id)
  assert.ok(blockedWrite.error, 'browser role unexpectedly mutated a server-owned job')

  const duplicate = await owner.database.rpc('enqueue_poster_generation', {
    p_campaign_id: productCampaign,
    p_instruction: null,
    p_reference_images: [],
    p_refresh_website: true,
    p_color_scheme: 'light',
  })
  assert.ok(duplicate.error, 'one-active-generation enforcement accepted a duplicate')
  assert.equal(await count('poster_generations', 'campaign_id', productCampaign), 1)
  assert.equal(await count('generation_jobs', 'campaign_id', productCampaign), 1)

  const hiddenJobs = await ok(other.database.from('generation_jobs').select('id'))
  assert.deepEqual(hiddenJobs, [])
  const hiddenActivity = rpcRow(await ok(other.database.rpc('generation_activity', {
    p_limit: 50,
  })))
  assert.deepEqual(hiddenActivity.items, [])
  assert.equal(hiddenActivity.unread_count, 0)

  const firstClaim = only(await claim('branch-retry-worker-1', 1))
  assert.equal(firstClaim.id, product.job.id)
  assert.equal(firstClaim.attempt_count, 1)

  await update('poster_generations', product.generation.id, {
    status: 'analyzing',
  })
  await updateTrace(product.generation.id, 'analyze', {
    status: 'running',
    started_at: new Date().toISOString(),
    model_calls: [{ attempt: 1, status: 'failed' }],
  })

  let retried = rpcRow(await ok(admin.database.rpc('record_generation_job_failure', {
    p_job_id: product.job.id,
    p_worker_id: 'branch-retry-worker-1',
    p_error_code: 'upstream_503',
    p_error_message: 'Transient upstream failure.',
    p_retryable: true,
  })))
  assert.equal(retried.status, 'retrying')
  assert.equal(retried.attempt_count, 1)
  assert.equal(retried.retry_count, 1)
  assert.equal((await trace(product.generation.id, 'analyze')).status, 'running')

  await update('generation_jobs', product.job.id, {
    available_at: new Date(Date.now() - 1000).toISOString(),
  })
  const secondClaim = only(await claim('branch-retry-worker-2', 1))
  assert.equal(secondClaim.id, product.job.id)
  assert.equal(secondClaim.attempt_count, 2)
  await updateTrace(product.generation.id, 'analyze', {
    model_calls: [
      { attempt: 1, status: 'failed' },
      { attempt: 2, status: 'failed' },
    ],
  })

  retried = rpcRow(await ok(admin.database.rpc('record_generation_job_failure', {
    p_job_id: product.job.id,
    p_worker_id: 'branch-retry-worker-2',
    p_error_code: 'upstream_503',
    p_error_message: 'Transient upstream failure.',
    p_retryable: true,
  })))
  assert.equal(retried.status, 'retrying')
  assert.equal(retried.retry_count, 2)

  await update('generation_jobs', product.job.id, {
    available_at: new Date(Date.now() - 1000).toISOString(),
  })
  const thirdClaim = only(await claim('branch-retry-worker-3', 1))
  assert.equal(thirdClaim.id, product.job.id)
  assert.equal(thirdClaim.attempt_count, 3)

  const terminalJob = rpcRow(await ok(admin.database.rpc('record_generation_job_failure', {
    p_job_id: product.job.id,
    p_worker_id: 'branch-retry-worker-3',
    p_error_code: 'upstream_503',
    p_error_message: 'Automatic retries exhausted.',
    p_retryable: true,
  })))
  assert.equal(terminalJob.status, 'failed')
  assert.ok(terminalJob.completed_at)

  const failedGeneration = await byId('poster_generations', product.generation.id)
  assert.equal(failedGeneration.status, 'failed')
  assert.equal(failedGeneration.failure_stage, 'analyze')
  const failedTrace = await trace(product.generation.id, 'analyze')
  assert.equal(failedTrace.status, 'failed')
  assert.equal(failedTrace.model_calls.length, 2)
  assert.deepEqual(
    (await traces(product.generation.id))
      .filter((row) => row.stage !== 'analyze')
      .map((row) => row.status),
    ['skipped', 'skipped', 'skipped'],
  )

  const failureNotifications = await ok(admin.database
    .from('generation_notifications')
    .select('*')
    .eq('job_id', product.job.id))
  assert.equal(failureNotifications.length, 1)
  assert.equal(failureNotifications[0].outcome, 'failed')

  const terminalMutation = await admin.database
    .from('generation_jobs')
    .update({ last_error_message: 'mutated' })
    .eq('id', product.job.id)
  assert.ok(terminalMutation.error, 'terminal job accepted a mutation')
  const traceMutation = await admin.database
    .from('generation_stage_traces')
    .update({ failure_message: 'mutated' })
    .eq('generation_id', product.generation.id)
    .eq('stage', 'analyze')
  assert.ok(traceMutation.error, 'terminal trace accepted a mutation')

  assert.equal(await markRead([failureNotifications[0].id]), 1)
  assert.equal(await markRead([failureNotifications[0].id]), 0)
  const readMutation = await admin.database
    .from('generation_notifications')
    .update({ read_at: null })
    .eq('id', failureNotifications[0].id)
  assert.ok(readMutation.error, 'read notification became unread again')

  const sameInputRetry = rpcRow(await ok(owner.database.rpc('retry_poster_generation', {
    p_job_id: product.job.id,
  })))
  assert.equal(sameInputRetry.generation.instruction, product.generation.instruction)
  assert.deepEqual(sameInputRetry.generation.reference_images, product.generation.reference_images)
  assert.equal(sameInputRetry.generation.generation_mode, product.generation.generation_mode)
  assert.equal(
    sameInputRetry.generation.parent_generation_id,
    product.generation.parent_generation_id,
  )
  assert.equal(sameInputRetry.job.retry_of_job_id, product.job.id)
  assert.equal(sameInputRetry.job.color_scheme, 'dark')

  const staleClaim = only(await claim('branch-stale-worker', 1))
  assert.equal(staleClaim.id, sameInputRetry.job.id)
  await update('generation_jobs', staleClaim.id, {
    lease_expires_at: new Date(Date.now() - 1000).toISOString(),
  })
  const recovered = only(await claim('branch-recovery-worker', 1))
  assert.equal(recovered.id, sameInputRetry.job.id)
  assert.equal(recovered.attempt_count, 1)
  assert.equal(recovered.retry_count, 1)
  assert.equal(recovered.last_error_code, 'worker_lease_expired')
  const recoveredFailure = rpcRow(await ok(admin.database.rpc('record_generation_job_failure', {
    p_job_id: recovered.id,
    p_worker_id: 'branch-recovery-worker',
    p_error_code: 'branch_recovery_complete',
    p_error_message: 'Expected branch-only terminal cleanup.',
    p_retryable: false,
  })))
  assert.equal(recoveredFailure.status, 'failed')
  assert.equal(await markRead(null), 1)

  const eventCampaign = await createCampaign('Queue event smoke test', 'event')
  const event = await enqueue(eventCampaign)
  assert.equal((await trace(event.generation.id, 'designer')).status, 'skipped')

  const eventAnalyze = only(await claim('branch-event-analyze', 1))
  assert.equal(eventAnalyze.id, event.job.id)
  assert.equal(eventAnalyze.stage, 'analyze')
  await update('poster_generations', event.generation.id, { status: 'analyzing' })
  await updateTrace(event.generation.id, 'analyze', {
    status: 'running',
    started_at: new Date().toISOString(),
  })
  await updateTrace(event.generation.id, 'analyze', {
    status: 'succeeded',
    completed_at: new Date().toISOString(),
  })

  const advanced = rpcRow(await ok(admin.database.rpc('advance_generation_job', {
    p_job_id: event.job.id,
    p_worker_id: 'branch-event-analyze',
    p_next_stage: 'assets',
  })))
  assert.equal(advanced.status, 'queued')
  assert.equal(advanced.stage, 'assets')
  assert.equal(advanced.attempt_count, 0)

  const eventAssets = only(await claim('branch-event-assets', 1))
  assert.equal(eventAssets.id, event.job.id)
  assert.equal(eventAssets.stage, 'assets')
  await updateTrace(event.generation.id, 'assets', {
    status: 'running',
    started_at: new Date().toISOString(),
  })
  await ok(admin.database.rpc('replace_generation_assets_for_worker', {
    p_generation_id: event.generation.id,
    p_user_id: ownerRow.id,
    p_assets: [],
  }))
  await ok(admin.database.rpc('complete_generation_asset_selection_for_worker', {
    p_generation_id: event.generation.id,
    p_user_id: ownerRow.id,
    p_asset_ids: [],
    p_reasons: {},
    p_method: 'rules_fallback',
  }))
  await updateTrace(event.generation.id, 'assets', {
    status: 'succeeded',
    completed_at: new Date().toISOString(),
  })
  const assetsAdvanced = rpcRow(await ok(admin.database.rpc('advance_generation_job', {
    p_job_id: event.job.id,
    p_worker_id: 'branch-event-assets',
    p_next_stage: 'hero',
  })))
  assert.equal(assetsAdvanced.status, 'queued')
  assert.equal(assetsAdvanced.stage, 'hero')

  const eventHero = only(await claim('branch-event-hero', 1))
  assert.equal(eventHero.id, event.job.id)
  assert.equal(eventHero.stage, 'hero')
  await update('poster_generations', event.generation.id, { status: 'painting' })
  await updateTrace(event.generation.id, 'hero', {
    status: 'running',
    started_at: new Date().toISOString(),
  })

  const completionArgs = {
    p_generation_id: event.generation.id,
    p_user_id: ownerRow.id,
    p_hero_image_url: 'https://example.com/poster.png',
    p_hero_image_key: 'poster/branch-smoke/poster.png',
  }
  const completed = rpcRow(await ok(
    admin.database.rpc('complete_poster_generation_for_worker', completionArgs),
  ))
  assert.equal(completed.status, 'ready')
  assert.equal(completed.version_number, 1)
  const idempotentCompletion = rpcRow(await ok(
    admin.database.rpc('complete_poster_generation_for_worker', completionArgs),
  ))
  assert.equal(idempotentCompletion.version_number, 1)

  await updateTrace(event.generation.id, 'hero', {
    status: 'succeeded',
    completed_at: new Date().toISOString(),
  })
  const completedJob = rpcRow(await ok(admin.database.rpc('advance_generation_job', {
    p_job_id: event.job.id,
    p_worker_id: 'branch-event-hero',
    p_next_stage: null,
  })))
  assert.equal(completedJob.status, 'succeeded')
  const eventCampaignRow = await byId('campaigns', eventCampaign)
  assert.equal(eventCampaignRow.current_generation_id, event.generation.id)
  assert.equal(await count('poster_generations', 'campaign_id', eventCampaign), 1)

  const successNotifications = await ok(admin.database
    .from('generation_notifications')
    .select('*')
    .eq('job_id', event.job.id))
  assert.equal(successNotifications.length, 1)
  assert.equal(successNotifications[0].outcome, 'ready')
  const retrySuccess = await owner.database.rpc('retry_poster_generation', {
    p_job_id: event.job.id,
  })
  assert.ok(retrySuccess.error, 'successful job was accepted by same-input retry')
  assert.equal(await markRead(null), 1)

  await deleteCampaign(productCampaign)
  await deleteCampaign(eventCampaign)
  for (const table of [
    'generation_jobs',
    'generation_notifications',
    'poster_generations',
    'generation_stage_traces',
  ]) {
    assert.equal(await countAny(table, 'campaign_id', [productCampaign, eventCampaign]), 0)
  }
}

async function createCampaign(name, scenario) {
  const id = randomUUID()
  campaignIds.add(id)
  await ok(admin.database.from('campaigns').insert([{
    id,
    user_id: ownerRow.id,
    product_url: scenario === 'event' ? 'https://lu.ma/example' : 'https://example.com/product',
    product_name: name,
    destination_url: 'https://example.com/destination',
    scenario,
    use_case: scenario === 'event' ? 'event' : 'website_product',
  }]))
  return id
}

async function deleteCampaign(id) {
  await ok(admin.database.from('campaigns').delete().eq('id', id))
  campaignIds.delete(id)
}

async function enqueue(campaignId, {
  instruction = null,
  references = [],
  colorScheme = 'light',
} = {}) {
  return rpcRow(await ok(owner.database.rpc('enqueue_poster_generation', {
    p_campaign_id: campaignId,
    p_instruction: instruction,
    p_reference_images: references,
    p_refresh_website: true,
    p_color_scheme: colorScheme,
  })))
}

async function claim(workerId, limit) {
  return rpcRows(await ok(admin.database.rpc('claim_generation_jobs', {
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
  return maybeOne(await ok(admin.database
    .from('generation_stage_traces')
    .select('*')
    .eq('generation_id', generationId)
    .eq('stage', stage)
    .maybeSingle()))
}

async function traces(generationId) {
  return ok(admin.database
    .from('generation_stage_traces')
    .select('*')
    .eq('generation_id', generationId)
    .order('created_at'))
}

async function byId(table, id) {
  return maybeOne(await ok(admin.database
    .from(table)
    .select('*')
    .eq('id', id)
    .maybeSingle()))
}

async function count(table, column, value) {
  const rows = await ok(admin.database.from(table).select('id').eq(column, value))
  return rows.length
}

async function countAny(table, column, values) {
  const rows = await ok(admin.database.from(table).select('id').in(column, values))
  return rows.length
}

async function markRead(ids) {
  const value = await ok(owner.database.rpc('mark_generation_notifications_read', {
    p_notification_ids: ids,
  }))
  return Number(Array.isArray(value) ? value[0] : value)
}

async function ok(request) {
  const { data, error } = await request
  if (error) throw new Error(error.message)
  return data
}

function only(rows) {
  assert.equal(rows.length, 1)
  return rows[0]
}

function maybeOne(value) {
  assert.ok(value)
  return value
}

function rpcRow(value) {
  const row = Array.isArray(value) ? value[0] : value
  assert.ok(row && typeof row === 'object')
  return row
}

function rpcRows(value) {
  if (Array.isArray(value)) return value
  return value && typeof value === 'object' ? [value] : []
}

function createUserClient(userId, email) {
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
  const encodedHeader = encode({ alg: 'HS256', typ: 'JWT' })
  const encodedPayload = encode(payload)
  const signature = createHmac('sha256', jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url')
  return `${encodedHeader}.${encodedPayload}.${signature}`
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
