import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  REDNOTE_POST_FORMAT,
  REDNOTE_POST_MAX_PAGES,
  REDNOTE_UNTITLED_COVER_TITLE,
  REDNOTE_POST_MIN_PAGES,
  getRedNotePageComposition,
  normalizeRedNotePostPlan,
  parseRedNotePostPlan,
  projectRedNotePostPlanToPosterContent,
  splitRedNoteSourceCopy,
  type RedNotePostPlan,
  type RedNoteRect,
  type RedNoteSourceCopyInput,
} from '../src/lib/redNotePost.ts'

const FALLBACK: RedNoteSourceCopyInput = {
  title: 'Launch notes',
  subtitle: 'A practical guide',
  sourceCopy:
    'Start with the problem. Show the method. Close with the result.',
}

test('RedNote foundation is anchored to the registered full-bleed format and page bounds', () => {
  assert.equal(REDNOTE_POST_FORMAT, 'rednote_cover_3x4')
  assert.equal(REDNOTE_POST_MIN_PAGES, 2)
  assert.equal(REDNOTE_POST_MAX_PAGES, 9)
})

test('strict plan parsing clones valid plans and rejects malformed persisted data', () => {
  const raw = {
    schema_version: 1 as const,
    pages: [
      { kind: 'cover' as const, title: 'Field notes', subtitle: 'A clear hook' },
      { kind: 'content' as const, heading: 'Start here', blocks: ['One idea'] },
    ],
  }
  const snapshot = structuredClone(raw)
  const parsed = parseRedNotePostPlan(raw)

  assert.deepEqual(parsed, snapshot)
  assert.notStrictEqual(parsed, raw)
  assert.notStrictEqual(parsed?.pages, raw.pages)
  assert.deepEqual(raw, snapshot)
  assert.equal(parseRedNotePostPlan({ ...raw, schema_version: 2 }), null)
  assert.equal(parseRedNotePostPlan({
    schema_version: 1,
    pages: [...raw.pages].reverse(),
  }), null)
  assert.equal(parseRedNotePostPlan({
    schema_version: 1,
    pages: [{ kind: 'cover', title: '' }, raw.pages[1]],
  }), null)
  assert.equal(parseRedNotePostPlan({
    schema_version: 1,
    pages: [
      raw.pages[0],
      { kind: 'content', heading: 'Body', blocks: 'invalid' },
    ],
  }), null)
})

test('malformed model output falls back to deterministic caller-supplied copy', () => {
  const expected = splitRedNoteSourceCopy(FALLBACK)

  assert.deepEqual(
    normalizeRedNotePostPlan({ schema_version: 1, pages: 'invalid' }, FALLBACK),
    expected,
  )
  assert.deepEqual(
    normalizeRedNotePostPlan({ schema_version: 2, pages: [] }, FALLBACK),
    expected,
  )
  assert.deepEqual(normalizeRedNotePostPlan(null, FALLBACK), expected)
})

test('model text normalization never rewrites deterministic fallback fields', () => {
  const fallback = {
    title: 'User title ✨',
    subtitle: 'User subtitle ✨',
    sourceCopy: 'User body ✨.',
  }
  const normalizedValues: Array<[string, number]> = []
  const plan = normalizeRedNotePostPlan({
    pages: [
      {
        kind: 'cover',
        title: '✨',
      },
      {
        kind: 'content',
        heading: 'Model heading ✨',
        blocks: ['Model block ✨'],
      },
    ],
  }, fallback, (value, maxCodePoints) => {
    normalizedValues.push([value, maxCodePoints])
    return value.replaceAll('✨', '').trim()
  })

  assert.deepEqual(plan, {
    schema_version: 1,
    pages: [
      {
        kind: 'cover',
        title: 'User title ✨',
        subtitle: 'User subtitle ✨',
      },
      {
        kind: 'content',
        heading: 'Model heading',
        blocks: ['Model block'],
      },
    ],
  })
  assert.deepEqual(normalizedValues, [
    ['✨', 48],
    ['Model block ✨', 160],
    ['Model heading ✨', 64],
  ])
  assert.equal(
    normalizedValues.some(([value]) => value.startsWith('User ')),
    false,
  )
})

test('malformed model plans preserve fallback copy without invoking the model normalizer', () => {
  const calls: string[] = []
  const plan = normalizeRedNotePostPlan(
    { schema_version: 1, pages: null },
    FALLBACK,
    (value) => {
      calls.push(value)
      return ''
    },
  )

  assert.deepEqual(plan, splitRedNoteSourceCopy(FALLBACK))
  assert.deepEqual(calls, [])
})

test('partial model plans use deterministic source-copy pages after the model cover', () => {
  const fallbackPages = splitRedNoteSourceCopy(FALLBACK).pages.slice(1)
  const plan = normalizeRedNotePostPlan({
    schema_version: 1,
    pages: [{ kind: 'cover', title: 'Optimized hook' }],
  }, FALLBACK)

  assert.deepEqual(plan.pages, [
    {
      kind: 'cover',
      title: 'Optimized hook',
      subtitle: FALLBACK.subtitle,
    },
    ...fallbackPages,
  ])
})

test('normalization moves one cover to the front and preserves unique content order', () => {
  const plan = normalizeRedNotePostPlan({
    pages: [
      {
        kind: 'content',
        heading: 'First idea',
        blocks: [' Evidence ', 'Evidence', 'Action'],
      },
      {
        kind: 'cover',
        title: ' Model title ',
        subtitle: ' Model subtitle ',
      },
      {
        kind: 'cover',
        title: 'Ignored duplicate cover',
      },
      {
        kind: 'content',
        heading: 'First idea',
        blocks: ['Evidence', 'Action'],
      },
      {
        kind: 'content',
        heading: 'Second idea',
        blocks: ['Result'],
      },
    ],
  }, FALLBACK)

  assert.deepEqual(plan, {
    schema_version: 1,
    pages: [
      {
        kind: 'cover',
        title: 'Model title',
        subtitle: 'Model subtitle',
      },
      {
        kind: 'content',
        heading: 'First idea',
        blocks: ['Evidence', 'Action'],
      },
      {
        kind: 'content',
        heading: 'Second idea',
        blocks: ['Result'],
      },
    ],
  })
})

test('splitting always returns a cover and one content page its own validator accepts', () => {
  // A blank title with no usable source copy previously produced title: '', which
  // parseRedNotePostPlan rejects (a cover title may not be empty) — dropping the
  // poster into the 'invalid' render state. The synthesized title keeps the plan
  // self-consistent; the content heading inherits it rather than staying blank.
  for (const sourceCopy of ['', '   ', '...', '。。。', '!!!']) {
    const plan = splitRedNoteSourceCopy({ title: '', subtitle: '', sourceCopy })

    assert.deepEqual(plan, {
      schema_version: 1,
      pages: [
        { kind: 'cover', title: REDNOTE_UNTITLED_COVER_TITLE },
        {
          kind: 'content',
          heading: REDNOTE_UNTITLED_COVER_TITLE,
          blocks: [],
        },
      ],
    })
    assert.notEqual(parseRedNotePostPlan(plan), null)
  }

  // A NULL campaign title behaves identically to a blank one.
  assert.deepEqual(
    splitRedNoteSourceCopy({ title: null, subtitle: null, sourceCopy: '' }),
    splitRedNoteSourceCopy({ title: '', subtitle: '', sourceCopy: '' }),
  )
})

test('normalization and fallback splitting cap posts at nine pages', () => {
  const rawPlan = normalizeRedNotePostPlan({
    schema_version: 1,
    pages: [
      { kind: 'cover', title: 'Cover' },
      ...Array.from({ length: 12 }, (_, index) => ({
        kind: 'content',
        heading: `Raw page ${index}`,
        blocks: [],
      })),
    ],
  }, FALLBACK)
  const splitPlan = splitRedNoteSourceCopy({
    title: 'Long post',
    sourceCopy: Array.from(
      { length: 100 },
      (_, index) => `Sentence ${index}.`,
    ).join(' '),
  })

  assert.equal(rawPlan.pages.length, REDNOTE_POST_MAX_PAGES)
  assert.equal(splitPlan.pages.length, REDNOTE_POST_MAX_PAGES)
  assert.equal(
    rawPlan.pages.filter((page) => page.kind === 'cover').length,
    1,
  )
})

test('source splitting recognizes English and Chinese sentence punctuation', () => {
  const plan = splitRedNoteSourceCopy({
    title: 'Mixed-language source',
    sourceCopy:
      'First sentence. Second question? 第一句。第二问？最后一项！',
  })
  const content = plan.pages[1]
  assert.equal(content.kind, 'content')
  if (content.kind !== 'content') return

  assert.deepEqual(
    [content.heading, ...content.blocks],
    [
      'First sentence.',
      'Second question?',
      '第一句。',
      '第二问？',
      '最后一项！',
    ],
  )
})

test('normalization truncates by Unicode code point without splitting surrogate pairs', () => {
  const plan = normalizeRedNotePostPlan({
    pages: [
      {
        kind: 'cover',
        title: '😀'.repeat(60),
        subtitle: '🚀'.repeat(120),
      },
      {
        kind: 'content',
        heading: '🧠'.repeat(90),
        blocks: ['✨'.repeat(200)],
      },
    ],
  }, FALLBACK)
  const cover = plan.pages[0]
  const content = plan.pages[1]
  assert.equal(cover.kind, 'cover')
  assert.equal(content.kind, 'content')
  if (cover.kind !== 'cover' || content.kind !== 'content') return

  assert.equal(Array.from(cover.title).length, 48)
  assert.equal(Array.from(cover.subtitle ?? '').length, 96)
  assert.equal(Array.from(content.heading).length, 64)
  assert.equal(Array.from(content.blocks[0]).length, 160)
  assert.doesNotMatch(
    [cover.title, cover.subtitle, content.heading, ...content.blocks].join(''),
    /\uFFFD/u,
  )
})

test('CJK and Latin model copy obeys every Unicode code-point bound', () => {
  const plan = normalizeRedNotePostPlan({
    pages: [
      {
        kind: 'cover',
        title: '标题'.repeat(30),
        subtitle: '副标题A'.repeat(40),
      },
      {
        kind: 'content',
        heading: '章节Heading'.repeat(20),
        blocks: Array.from(
          { length: 6 },
          (_, index) => `第${index + 1}段Block`.repeat(40),
        ),
      },
    ],
  }, FALLBACK)
  const cover = plan.pages[0]
  const content = plan.pages[1]
  assert.equal(cover.kind, 'cover')
  assert.equal(content.kind, 'content')
  if (cover.kind !== 'cover' || content.kind !== 'content') return

  assert.equal(Array.from(cover.title).length, 48)
  assert.equal(Array.from(cover.subtitle ?? '').length, 96)
  assert.equal(Array.from(content.heading).length, 64)
  assert.equal(content.blocks.length, 4)
  assert.equal(
    content.blocks.every((block) => Array.from(block).length <= 160),
    true,
  )
})

test('normalization removes repeated blocks and duplicate content pages', () => {
  const repeatedPage = {
    kind: 'content',
    heading: 'One idea',
    blocks: ['Repeat', ' Repeat ', 'Other', 'Repeat'],
  }
  const plan = normalizeRedNotePostPlan({
    pages: [
      { kind: 'cover', title: 'Cover' },
      repeatedPage,
      structuredClone(repeatedPage),
    ],
  }, FALLBACK)

  assert.deepEqual(plan.pages, [
    { kind: 'cover', title: 'Cover', subtitle: 'A practical guide' },
    {
      kind: 'content',
      heading: 'One idea',
      blocks: ['Repeat', 'Other'],
    },
  ])
})

test('fallback output contains only caller-supplied text or its substrings', () => {
  const input = {
    title: 'Field guide',
    subtitle: 'For careful teams',
    sourceCopy:
      'Observe the signal. Keep the evidence intact; Share the conclusion!',
  }
  const sourceValues = [input.title, input.subtitle, input.sourceCopy]
  const visibleValues = visibleText(splitRedNoteSourceCopy(input))

  for (const value of visibleValues) {
    assert.ok(
      value === '' || sourceValues.some((source) => source.includes(value)),
      `Unexpected fallback text: ${value}`,
    )
  }
})

test('projection maps the optimized cover and first six unique headings', () => {
  const plan: RedNotePostPlan = {
    schema_version: 1,
    pages: [
      {
        kind: 'cover',
        title: 'A stronger hook',
        subtitle: 'A clearer promise',
      },
      { kind: 'content', heading: 'Start here', blocks: ['One'] },
      { kind: 'content', heading: 'Start here', blocks: ['Two'] },
      { kind: 'content', heading: 'Second', blocks: ['Three'] },
      { kind: 'content', heading: 'Third', blocks: ['Four'] },
      { kind: 'content', heading: 'Fourth', blocks: ['Five'] },
      { kind: 'content', heading: 'Fifth', blocks: ['Six'] },
      { kind: 'content', heading: 'Sixth', blocks: ['Seven'] },
      { kind: 'content', heading: 'Seventh', blocks: ['Eight'] },
    ],
  }
  const snapshot = structuredClone(plan)

  assert.deepEqual(projectRedNotePostPlanToPosterContent(plan), {
    headline: 'A stronger hook',
    what_it_does: 'A clearer promise',
    how_it_works: [],
    why_use_it: [],
    features: ['Start here', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'],
    cta: '',
    rednote_post: snapshot,
  })
  assert.deepEqual(plan, snapshot)
})

test('projection uses an empty supporting line when the cover has no subtitle', () => {
  const plan: RedNotePostPlan = {
    schema_version: 1,
    pages: [
      { kind: 'cover', title: 'Cover only' },
      { kind: 'content', heading: 'Body', blocks: [] },
    ],
  }

  assert.equal(
    projectRedNotePostPlanToPosterContent(plan).what_it_does,
    '',
  )
})

test('normalization and splitting do not mutate caller inputs', () => {
  const raw = deepFreeze({
    pages: [
      { kind: 'content', heading: 'Body', blocks: ['One', 'Two'] },
      { kind: 'cover', title: 'Cover' },
    ],
  })
  const fallback = deepFreeze({
    title: 'Fallback title',
    subtitle: 'Fallback subtitle',
    sourceCopy: 'Fallback body.',
  })
  const rawSnapshot = structuredClone(raw)
  const fallbackSnapshot = structuredClone(fallback)

  normalizeRedNotePostPlan(raw, fallback)
  splitRedNoteSourceCopy(fallback)

  assert.deepEqual(raw, rawSnapshot)
  assert.deepEqual(fallback, fallbackSnapshot)
})

test('page composition returns the approved native rectangles', () => {
  const cover = getRedNotePageComposition(
    { kind: 'cover', title: 'Cover' },
    0,
    2,
  )
  const content = getRedNotePageComposition(
    { kind: 'content', heading: 'Body', blocks: [] },
    1,
    2,
  )

  assert.deepEqual(cover, {
    pageIndex: 0,
    pageCount: 2,
    frame: { x: 0, y: 0, width: 1242, height: 1656 },
    background: { x: 0, y: 0, width: 1242, height: 1656 },
    coverText: { x: 96, y: 852, width: 1050, height: 636 },
    panel: null,
    heading: null,
    body: null,
    pageMarker: { x: 1002, y: 1516, width: 144, height: 40 },
  })
  assert.deepEqual(content, {
    pageIndex: 1,
    pageCount: 2,
    frame: { x: 0, y: 0, width: 1242, height: 1656 },
    background: { x: 0, y: 0, width: 1242, height: 1656 },
    coverText: null,
    panel: { x: 72, y: 72, width: 1098, height: 1512 },
    heading: { x: 144, y: 168, width: 954, height: 216 },
    body: { x: 144, y: 432, width: 954, height: 896 },
    pageMarker: { x: 1002, y: 1516, width: 144, height: 40 },
  })
})

test('every composition rectangle is contained and text regions are disjoint', () => {
  const frame = { x: 0, y: 0, width: 1242, height: 1656 }
  const compositions = [
    getRedNotePageComposition({ kind: 'cover', title: 'Cover' }, 0, 2),
    getRedNotePageComposition(
      { kind: 'content', heading: 'Body', blocks: [] },
      1,
      2,
    ),
  ]

  for (const composition of compositions) {
    for (const rect of compositionRects(composition)) {
      assert.equal(isContainedBy(rect, frame), true)
    }
    for (const contentRect of [
      composition.coverText,
      composition.heading,
      composition.body,
    ]) {
      if (contentRect) {
        assert.equal(overlaps(composition.pageMarker, contentRect), false)
      }
    }
    if (composition.heading && composition.body) {
      assert.equal(overlaps(composition.heading, composition.body), false)
    }
  }
})

function visibleText(plan: ReturnType<typeof splitRedNoteSourceCopy>): string[] {
  return plan.pages.flatMap((page) =>
    page.kind === 'cover'
      ? [page.title, page.subtitle ?? '']
      : [page.heading, ...page.blocks]
  )
}

function compositionRects(
  composition: ReturnType<typeof getRedNotePageComposition>,
): RedNoteRect[] {
  return [
    composition.frame,
    composition.background,
    composition.coverText,
    composition.panel,
    composition.heading,
    composition.body,
    composition.pageMarker,
  ].filter((rect): rect is RedNoteRect => rect !== null)
}

function isContainedBy(rect: RedNoteRect, frame: RedNoteRect): boolean {
  return (
    rect.x >= frame.x
    && rect.y >= frame.y
    && rect.x + rect.width <= frame.x + frame.width
    && rect.y + rect.height <= frame.y + frame.height
  )
}

function overlaps(left: RedNoteRect, right: RedNoteRect): boolean {
  return (
    left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
  )
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child)
    }
  }
  return value
}
