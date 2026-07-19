import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  nextWorkerStage,
  responseFailure,
  thrownFailure,
} from '../functions/_workerPolicy.ts'
import { processClaimedJob } from '../functions/generation-worker.ts'

const workerSource = readFileSync(
  new URL('../functions/generation-worker.ts', import.meta.url),
  'utf8',
)
const routingSource = readFileSync(
  new URL('../functions/_workerPolicy.ts', import.meta.url),
  'utf8',
)

test('worker stage routing skips deterministic event layout work', () => {
  assert.equal(nextWorkerStage('analyze', 'product'), 'designer')
  assert.equal(nextWorkerStage('analyze', 'event'), 'hero')
  assert.equal(nextWorkerStage('analyze', 'product', 2), 'assets')
  assert.equal(nextWorkerStage('analyze', 'event', 2), 'assets')
  assert.equal(nextWorkerStage('assets', 'product', 2), 'designer')
  assert.equal(nextWorkerStage('assets', 'event', 2), 'hero')
  assert.equal(nextWorkerStage('designer', 'product'), 'hero')
  assert.equal(nextWorkerStage('hero', 'product'), null)
})

test('explicit stage retry classification overrides wrapper HTTP status', () => {
  assert.equal(responseFailure(502, {
    error: 'invalid model JSON',
    retryable: false,
  }).retryable, false)
  assert.equal(responseFailure(502, {
    error: 'upstream unavailable',
    retryable: true,
  }).retryable, true)
})

test('unclassified worker failures retry only network, 408, 429, and 5xx errors', () => {
  assert.equal(responseFailure(408, null).retryable, true)
  assert.equal(responseFailure(429, null).retryable, true)
  assert.equal(responseFailure(503, null).retryable, true)
  assert.equal(responseFailure(400, null).retryable, false)
  assert.equal(thrownFailure(new TypeError('fetch failed')).retryable, true)
  assert.equal(thrownFailure({ message: 'bad input', status: 400 }).retryable, false)
  assert.equal(thrownFailure({
    message: 'permanent provider failure',
    status: 503,
    retryable: false,
  }).retryable, false)
})

test('authoritative worker mismatch gate runs before active-stage trace or execution', () => {
  const processBody = workerSource.slice(
    workerSource.indexOf('async function processClaimedJob'),
    workerSource.indexOf('async function reconcileReadyTrace'),
  )
  const mismatchIndex = processBody.indexOf('const sourceMismatch = useCaseSourceMismatch(')
  const activeTraceIndex = processBody.indexOf(
    'const traceStatus = await loadTraceStatus(client, job);',
    mismatchIndex,
  )
  const stageExecutionIndex = processBody.indexOf("if (job.stage === 'analyze')")

  assert.ok(mismatchIndex > -1)
  assert.ok(activeTraceIndex > mismatchIndex)
  assert.ok(stageExecutionIndex > activeTraceIndex)
  assert.match(
    processBody,
    /return recordFailure\(client, workerId, job, sourceMismatch\)/,
  )
  assert.match(
    workerSource,
    /\.select\('id, status, scenario, use_case, trace_schema_version'\)/,
  )
  assert.match(workerSource, /\.select\('product_url'\)/)
})

test('worker mismatch records a non-retryable failure without touching a stage trace', async () => {
  const tableReads: string[] = []
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  const rows: Record<string, Record<string, unknown>> = {
    poster_generations: {
      id: 'generation-1',
      status: 'created',
      scenario: 'product',
      use_case: 'amazon_listing',
      trace_schema_version: 2,
    },
    campaigns: {
      product_url: 'https://example.com/product',
    },
  }
  const client = {
    database: {
      from(table: string) {
        tableReads.push(table)
        const builder = {
          select() {
            return builder
          },
          eq() {
            return builder
          },
          maybeSingle() {
            return Promise.resolve({
              data: rows[table] ?? null,
              error: null,
            })
          },
        }
        return builder
      },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args })
        return { data: { status: 'failed' }, error: null }
      },
    },
  }
  const result = await processClaimedJob(
    client as never,
    'worker-1',
    {
      id: 'job-1',
      generation_id: 'generation-1',
      campaign_id: 'campaign-1',
      user_id: 'user-1',
      status: 'running',
      stage: 'designer',
      color_scheme: 'light',
      attempt_count: 1,
      max_attempts: 3,
    },
  )

  assert.deepEqual(tableReads, ['poster_generations', 'campaigns'])
  assert.deepEqual(rpcCalls, [{
    name: 'record_generation_job_failure',
    args: {
      p_job_id: 'job-1',
      p_worker_id: 'worker-1',
      p_error_code: 'use_case_source_mismatch',
      p_error_message:
        'This generation is configured for an Amazon listing, but its source is not a supported Amazon URL.',
      p_retryable: false,
    },
  }])
  assert.deepEqual(result, {
    job_id: 'job-1',
    stage: 'designer',
    result: 'failed',
    detail:
      'This generation is configured for an Amazon listing, but its source is not a supported Amazon URL.',
  })
})

test('use-case recipes do not enter the exclusive stage-routing policy', () => {
  assert.doesNotMatch(routingSource, /use[_-]?case|recipe/i)
})
