import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { normalizeCaptureUrl } from '../src/lib/captureUrl.ts'

interface CaptureUrlCase {
  name: string
  input: string
  expected: string | null
}

const cases = JSON.parse(
  readFileSync(new URL('./fixtures/captureUrlCases.json', import.meta.url), 'utf8'),
) as CaptureUrlCase[]

for (const fixture of cases) {
  test(`normalizeCaptureUrl ${fixture.name}`, () => {
    assert.equal(normalizeCaptureUrl(fixture.input), fixture.expected)
  })
}
