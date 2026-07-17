import assert from 'node:assert/strict'
import { test } from 'node:test'
import { StageTraceRecorder } from '../functions/_shared.ts'

test('stage recorder preserves failed attempts, repair prompts, and resolved request settings', async () => {
  const updates: Array<Record<string, unknown>> = []
  const client = {
    database: {
      from() {
        const builder = {
          select() {
            return builder
          },
          update(patch: Record<string, unknown>) {
            updates.push(structuredClone(patch))
            return builder
          },
          eq() {
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
})
