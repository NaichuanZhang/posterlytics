import assert from 'node:assert/strict'
import { test } from 'node:test'
import { StageTraceRecorder } from '../functions/_shared.ts'

test('stage recorder preserves failed attempts, repair prompts, and resolved request settings', async () => {
  const updates: Array<Record<string, unknown>> = []
  const requests: Array<{
    table: string
    operation: 'select' | 'update'
    filters: Array<[string, unknown]>
  }> = []
  const client = {
    database: {
      from(table: string) {
        let request: (typeof requests)[number] | null = null
        const builder = {
          select() {
            request = { table, operation: 'select', filters: [] }
            requests.push(request)
            return builder
          },
          update(patch: Record<string, unknown>) {
            updates.push(structuredClone(patch))
            request = { table, operation: 'update', filters: [] }
            requests.push(request)
            return builder
          },
          eq(column: string, value: unknown) {
            request?.filters.push([column, value])
            return builder
          },
          maybeSingle() {
            return Promise.resolve({
              data: {
                status: 'pending',
                started_at: null,
                model_calls: [],
                artifacts: [],
              },
              error: null,
            })
          },
          then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
            return Promise.resolve({ data: null, error: null }).then(resolve, reject)
          },
        }
        return builder
      },
    },
  }
  const recorder = new StageTraceRecorder(client as never, {
    generationId: 'generation-1',
    campaignId: 'campaign-1',
    userId: 'user-1',
    stage: 'designer',
  })
  await recorder.start()
  await recorder.addArtifact({
    kind: 'layout',
    snapshot: { composition: 'first' },
  })
  await recorder.addArtifact({
    kind: 'layout',
    snapshot: { composition: 'replacement' },
  })
  await recorder.addArtifact({
    kind: 'analysis',
    metadata: { scenario: 'product' },
  })

  await assert.rejects(
    recorder.runModelCall({
      operation: 'chat',
      modelId: 'openai/test-model',
      prompt: { system: 'Return JSON', user: 'Design this poster' },
      providerSettings: { max_completion_tokens: 1800, timeout_ms: 30_000 },
      contentManifest: [{ position: 1, role: 'system', type: 'text', text: 'Return JSON' }],
    }, async () => {
      throw new Error('Invalid JSON response')
    }),
    /Invalid JSON response/,
  )

  const result = await recorder.runModelCall({
    operation: 'chat',
    modelId: 'openai/test-model',
    prompt: { system: 'Return JSON. Return ONLY valid minified JSON.', user: 'Design this poster' },
    providerSettings: { max_completion_tokens: 1800, timeout_ms: 30_000 },
    contentManifest: [{
      position: 1,
      role: 'system',
      type: 'text',
      text: 'Return JSON. Return ONLY valid minified JSON.',
    }],
  }, async () => 'repaired')
  assert.equal(result, 'repaired')

  const modelCallUpdates = updates.filter((patch) => Array.isArray(patch.model_calls))
  const finalCalls = modelCallUpdates.at(-1)?.model_calls as Array<Record<string, unknown>>
  assert.equal(finalCalls.length, 2)
  assert.deepEqual(finalCalls.map((call) => call.status), ['failed', 'succeeded'])
  assert.deepEqual(finalCalls.map((call) => call.attempt), [1, 2])
  assert.equal(
    (finalCalls[1].prompt as Record<string, string>).system,
    'Return JSON. Return ONLY valid minified JSON.',
  )
  assert.deepEqual(finalCalls[1].provider_settings, {
    max_completion_tokens: 1800,
    timeout_ms: 30_000,
  })

  const artifactUpdates = updates.filter((patch) => Array.isArray(patch.artifacts))
  const finalArtifacts = artifactUpdates.at(-1)?.artifacts as Array<Record<string, unknown>>
  assert.equal(finalArtifacts.length, 2)
  assert.deepEqual(finalArtifacts.map((artifact) => artifact.kind), [
    'layout',
    'analysis',
  ])
  assert.deepEqual(finalArtifacts[0].snapshot, {
    composition: 'replacement',
  })

  const traceRequests = requests.filter(
    (request) => request.table === 'generation_stage_traces',
  )
  assert.ok(traceRequests.length > 0)
  for (const request of traceRequests) {
    assert.deepEqual(request.filters, [
      ['generation_id', 'generation-1'],
      ['campaign_id', 'campaign-1'],
      ['user_id', 'user-1'],
      ['stage', 'designer'],
    ])
  }
})
