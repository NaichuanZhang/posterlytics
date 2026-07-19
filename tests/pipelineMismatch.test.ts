import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runAnalyzeMismatchCompatibility } from './helpers/pipelinePromptHarness.ts'

for (const fixture of [
  {
    useCase: 'website_product',
    productUrl: 'https://www.amazon.com/dp/B0EXAMPLE1',
  },
  {
    useCase: 'amazon_listing',
    productUrl: 'https://example.com/product',
  },
] as const) {
  test(`analyze compatibility entry rejects ${fixture.useCase} source mismatch before transition`, async () => {
    const result = await runAnalyzeMismatchCompatibility(
      fixture.useCase,
      fixture.productUrl,
    )

    assert.equal(result.status, 409)
    assert.equal(result.payload.code, 'use_case_source_mismatch')
    assert.equal(result.payload.retryable, false)
    assert.equal(result.generation.status, 'failed')
    assert.equal(result.generation.failure_stage, 'analyze')
    assert.equal(result.generation.failure_code, 'use_case_source_mismatch')
    assert.doesNotMatch(
      String(result.generation.failure_message),
      /amazon\.com|example\.com/,
    )
  })
}
