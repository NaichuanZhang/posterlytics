import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PAINTER_RETRY_START_DEADLINE_MS,
  appendArtifactRetrySuffix,
  buildPainterArtifactValidationRequest,
  classifyDetectedArtifacts,
  isPainterValidationEnabled,
  isWithinPainterArtifactRetryBudget,
  parsePainterArtifactVerdict,
} from '../functions/_painterArtifactValidation.ts'

const CLEAN_VERDICT = {
  has_decorative_glyphs: false,
  has_slot_label_words: false,
  has_adjacent_duplicate_words: false,
  notes: '',
}

test('parsePainterArtifactVerdict accepts exact and fenced verdict JSON', () => {
  assert.deepEqual(
    parsePainterArtifactVerdict(JSON.stringify(CLEAN_VERDICT)),
    CLEAN_VERDICT,
  )
  assert.deepEqual(
    parsePainterArtifactVerdict(`\`\`\`json
${JSON.stringify({
  ...CLEAN_VERDICT,
  has_decorative_glyphs: true,
  notes: 'Brain icon beside the first bullet.',
})}
\`\`\``),
    {
      ...CLEAN_VERDICT,
      has_decorative_glyphs: true,
      notes: 'Brain icon beside the first bullet.',
    },
  )
  assert.deepEqual(
    parsePainterArtifactVerdict(
      `\`\`\`JSON\r\n${JSON.stringify(CLEAN_VERDICT)}\r\n\`\`\``,
    ),
    CLEAN_VERDICT,
  )
})

test('parsePainterArtifactVerdict rejects prose and multiple JSON fences', () => {
  const cleanJson = JSON.stringify(CLEAN_VERDICT)
  const invalidOutputs = [
    `Verdict: ${cleanJson}`,
    `Verdict:
\`\`\`json
${cleanJson}
\`\`\``,
    `\`\`\`json
${cleanJson}
\`\`\`
Done.`,
    `\`\`\`json
${cleanJson}
\`\`\`
\`\`\`json
${cleanJson}
\`\`\``,
  ]

  for (const output of invalidOutputs) {
    assert.throws(
      () => parsePainterArtifactVerdict(output),
      hasInvalidVerdictCode,
    )
  }
})

test('parsePainterArtifactVerdict rejects missing, extra, and wrongly typed fields', () => {
  const invalidVerdicts = [
    {
      has_decorative_glyphs: false,
      has_slot_label_words: false,
      notes: '',
    },
    {
      ...CLEAN_VERDICT,
      confidence: 1,
    },
    {
      ...CLEAN_VERDICT,
      has_decorative_glyphs: 'false',
    },
    [],
    null,
  ]

  for (const verdict of invalidVerdicts) {
    assert.throws(
      () => parsePainterArtifactVerdict(JSON.stringify(verdict)),
      hasInvalidVerdictCode,
    )
  }
})

test('parsePainterArtifactVerdict rejects oversized output and positive empty notes', () => {
  assert.throws(
    () => parsePainterArtifactVerdict(`${JSON.stringify(CLEAN_VERDICT)}${'x'.repeat(4097)}`),
    hasInvalidVerdictCode,
  )
  assert.throws(
    () => parsePainterArtifactVerdict(JSON.stringify({
      ...CLEAN_VERDICT,
      has_slot_label_words: true,
    })),
    hasInvalidVerdictCode,
  )
})

test('parsePainterArtifactVerdict rejects clean verdicts with non-empty notes', () => {
  assert.throws(
    () => parsePainterArtifactVerdict(JSON.stringify({
      ...CLEAN_VERDICT,
      notes: 'No visible artifact.',
    })),
    hasInvalidVerdictCode,
  )
})

test('parsePainterArtifactVerdict bounds notes by Unicode code point', () => {
  const notes = '界'.repeat(260)
  const verdict = parsePainterArtifactVerdict(JSON.stringify({
    ...CLEAN_VERDICT,
    has_adjacent_duplicate_words: true,
    notes,
  }))

  assert.equal(Array.from(verdict.notes).length, 240)
  assert.equal(verdict.notes, '界'.repeat(240))
})

test('classifyDetectedArtifacts uses fixed retry-clause order', () => {
  assert.deepEqual(classifyDetectedArtifacts({
    has_decorative_glyphs: true,
    has_slot_label_words: true,
    has_adjacent_duplicate_words: true,
    notes: 'Three visible defects.',
  }), [
    'decorative_glyphs',
    'slot_label_words',
    'adjacent_duplicate_words',
  ])
})

test('appendArtifactRetrySuffix is a byte-identical no-op for no classes', () => {
  const prompt = 'Render the exact text: "Ship clearly".\nAvoid extra marks.'

  assert.equal(appendArtifactRetrySuffix(prompt, []), prompt)
})

test('appendArtifactRetrySuffix appends only fixed deterministic clauses', () => {
  const prompt = appendArtifactRetrySuffix('BASE', [
    'adjacent_duplicate_words',
    'decorative_glyphs',
    'adjacent_duplicate_words',
  ])

  assert.equal(prompt.startsWith('BASE\n\nRETRY-ONLY RASTER CORRECTION:'), true)
  assert.match(prompt, /Remove unauthorized standalone decorative icon glyphs/)
  assert.match(prompt, /Render every authorized word exactly once/)
  assert.doesNotMatch(prompt, /slot-label words/)
  assert.equal(prompt.indexOf('decorative icon'), prompt.lastIndexOf('decorative icon'))
  assert.ok(prompt.indexOf('decorative icon') < prompt.indexOf('exactly once'))
})

test('validation request sends an uploaded URL without storing it in trace text', () => {
  const request = buildPainterArtifactValidationRequest(
    'Render only "Ship clearly".',
    'https://assets.example/poster.png?poster_validation=initial',
  )
  const userContent = request.messages[1].content as Array<Record<string, unknown>>
  const imagePart = userContent.find((part) => part.type === 'image_url') as {
    image_url: { url: string }
  }

  assert.equal(
    imagePart.image_url.url,
    'https://assets.example/poster.png?poster_validation=initial',
  )
  assert.equal(request.contentManifest[2].type, 'image')
  assert.equal(request.contentManifest[2].image, undefined)
  assert.equal(JSON.stringify(request.contentManifest).includes('assets.example'), false)
  assert.throws(
    () => buildPainterArtifactValidationRequest('prompt', 'data:image/png;base64,AAAA'),
    hasInvalidVerdictCode,
  )
})

test('painter validation is default-on with explicit operational off values', () => {
  assert.equal(isPainterValidationEnabled(undefined), true)
  assert.equal(isPainterValidationEnabled('true'), true)
  assert.equal(isPainterValidationEnabled('1'), true)
  for (const disabled of ['0', 'false', 'OFF', ' no ']) {
    assert.equal(isPainterValidationEnabled(disabled), false)
  }
})

test('retry budget is strict before 105 seconds', () => {
  assert.equal(isWithinPainterArtifactRetryBudget(0), true)
  assert.equal(
    isWithinPainterArtifactRetryBudget(PAINTER_RETRY_START_DEADLINE_MS - 1),
    true,
  )
  assert.equal(
    isWithinPainterArtifactRetryBudget(PAINTER_RETRY_START_DEADLINE_MS),
    false,
  )
  assert.equal(isWithinPainterArtifactRetryBudget(-1), false)
  assert.equal(isWithinPainterArtifactRetryBudget(Number.NaN), false)
})

function hasInvalidVerdictCode(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && (error as { code?: unknown }).code === 'painter_artifact_verdict_invalid'
}
