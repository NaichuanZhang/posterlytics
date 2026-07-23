import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  REDNOTE_BACKGROUND_RENDER_MODE,
  clampRedNotePageIndex,
  contrastCheckedColor,
  contrastRatio,
  getRedNotePageRenderModel,
  redNoteCodePointLength,
  resolveRedNoteCoverContrast,
  resolveRedNotePalette,
  resolveRedNoteRenderState,
} from '../src/lib/redNoteRender.ts'
import type { RedNotePostPlan } from '../src/lib/redNotePost.ts'
import type { PosterLayout } from '../src/lib/types.ts'
import { parseColor, type RGB } from '../src/lib/colorUtils.ts'

const plan: RedNotePostPlan = {
  schema_version: 1,
  pages: [
    {
      kind: 'cover',
      title: '标题'.repeat(24),
      subtitle: '副标题'.repeat(24),
    },
    {
      kind: 'content',
      heading: '第一章',
      blocks: ['正文内容'],
    },
  ],
}

const layout: PosterLayout = {
  render_mode: REDNOTE_BACKGROUND_RENDER_MODE,
  composition: 'editorial sweep',
  mood: 'focused',
  art_style: 'photographic',
  palette_roles: {
    bg: '#f7f4ed',
    surface: '#f7f4ed',
    text: '#eeeedd',
    primary: '#235789',
    accent: '#f45b69',
  },
  zones: [],
}

const LIGHT_BACKGROUND = '#f7f4ed'
const DARK_BACKGROUND = '#152238'
const BLACK: RGB = [0, 0, 0]
const WHITE: RGB = [255, 255, 255]
const DARK_TEXT: RGB = [17, 17, 17]

test('render-state resolution isolates legacy, composite, and invalid marked rows', () => {
  assert.equal(resolveRedNoteRenderState({
    use_case: 'rednote_post',
    poster_format: 'rednote_cover_3x4',
    poster_layout: { ...layout, render_mode: undefined },
    poster_content: { rednote_post: plan },
  }), 'legacy')

  const composite = resolveRedNoteRenderState({
    use_case: 'rednote_post',
    poster_format: 'rednote_cover_3x4',
    poster_layout: layout,
    poster_content: { rednote_post: plan },
  })
  assert.notEqual(composite, 'legacy')
  assert.notEqual(composite, 'invalid')
  if (composite === 'legacy' || composite === 'invalid') return
  assert.deepEqual(composite.plan, plan)
  assert.notStrictEqual(composite.plan, plan)

  for (const input of [
    {
      use_case: 'social_cover',
      poster_format: 'rednote_cover_3x4',
      poster_layout: layout,
      poster_content: { rednote_post: plan },
    },
    {
      use_case: 'rednote_post',
      poster_format: 'a4_2x3',
      poster_layout: layout,
      poster_content: { rednote_post: plan },
    },
    {
      use_case: 'rednote_post',
      poster_format: 'rednote_cover_3x4',
      poster_layout: layout,
      poster_content: { rednote_post: { schema_version: 1, pages: [] } },
    },
  ]) {
    assert.equal(resolveRedNoteRenderState(input), 'invalid')
  }
})

test('page index clamping handles invalid requests and page-count shrinkage', () => {
  assert.equal(clampRedNotePageIndex(-1, 5), 0)
  assert.equal(clampRedNotePageIndex(10, 5), 4)
  assert.equal(clampRedNotePageIndex(1.5, 5), 0)
  assert.equal(clampRedNotePageIndex(Number.NaN, 5), 0)
  assert.equal(clampRedNotePageIndex(4, 2), 1)
  assert.equal(clampRedNotePageIndex(1, 0), 0)
  assert.equal(clampRedNotePageIndex(1, 2.5), 0)
})

test('cover render model maps native geometry and uses the maximum CJK size tier', () => {
  const snapshot = structuredClone(plan)
  const model = getRedNotePageRenderModel(plan, 0)

  assert.equal(model.kind, 'cover')
  if (model.kind !== 'cover') return
  assert.equal(model.page.title, '标题'.repeat(24))
  assert.equal(model.titleSize, 70)
  assert.equal(model.subtitleSize, 34)
  assert.equal(model.pageMarker, '01 / 02')
  assert.deepEqual(model.composition.coverText, {
    x: 96,
    y: 852,
    width: 1050,
    height: 636,
  })
  assert.deepEqual(plan, snapshot)
})

test('content render model is page-index ready without exposing pager state', () => {
  const model = getRedNotePageRenderModel(plan, 1)

  assert.equal(model.kind, 'content')
  if (model.kind !== 'content') return
  assert.equal(model.page.heading, '第一章')
  assert.deepEqual(model.page.blocks, ['正文内容'])
  assert.equal(model.pageMarker, '02 / 02')
  assert.deepEqual(model.composition.panel, {
    x: 72,
    y: 72,
    width: 1098,
    height: 1512,
  })
})

test('maximum bounded CJK content keeps native geometry and conservative tiers', () => {
  const maxContentPlan: RedNotePostPlan = {
    schema_version: 1,
    pages: [
      { kind: 'cover', title: '封面' },
      {
        kind: 'content',
        heading: '章节'.repeat(32),
        blocks: Array.from({ length: 4 }, () => '内容'.repeat(80)),
      },
    ],
  }
  const model = getRedNotePageRenderModel(maxContentPlan, 1)

  assert.equal(model.kind, 'content')
  if (model.kind !== 'content') return
  const heading = model.composition.heading
  const body = model.composition.body
  assert.ok(heading)
  assert.ok(body)
  assert.equal(redNoteCodePointLength(model.page.heading), 64)
  assert.deepEqual(
    model.page.blocks.map(redNoteCodePointLength),
    [160, 160, 160, 160],
  )
  assert.deepEqual(heading, {
    x: 144,
    y: 168,
    width: 954,
    height: 216,
  })
  assert.deepEqual(body, {
    x: 144,
    y: 432,
    width: 954,
    height: 896,
  })
  assert.equal(model.headingSize, 48)
  assert.equal(model.bodySize, 26)
})

test('strict render model still rejects an out-of-range internal index', () => {
  assert.throws(() => getRedNotePageRenderModel(plan, 2), RangeError)
})

test('contrast helpers retain compliant colors and choose a readable fallback', () => {
  assert.equal(
    contrastCheckedColor('#111111', '#ffffff'),
    '#111111',
  )
  const fallback = contrastCheckedColor('#eeeeee', '#ffffff')
  assert.equal(fallback, '#111111')
  const foreground = parseColor(fallback)
  const background = parseColor('#ffffff')
  assert.ok(foreground && background)
  assert.ok(contrastRatio(foreground, background) >= 4.5)

  const palette = resolveRedNotePalette(layout)
  assert.equal(palette.text, '#111111')
})

test('light backgrounds use dark cover text and an AA-safe white scrim', () => {
  const palette = resolveRedNotePalette(layout)
  const cover = resolveRedNoteCoverContrast(LIGHT_BACKGROUND)

  assert.equal(palette.coverText, '#111111')
  assert.equal(
    palette.coverScrim,
    'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.3) 34%, rgba(255,255,255,0.49) 50%, rgba(255,255,255,0.9) 100%)',
  )
  assert.deepEqual(cover.scrim, WHITE)
  assert.equal(cover.textBandAlpha, 0.49)
  assertCoverContrastAtLeastAa(cover, [
    colorOf(LIGHT_BACKGROUND),
    BLACK,
    WHITE,
  ])
  assert.ok(
    renderedContrast(DARK_TEXT, WHITE, BLACK, 0.48) < 4.5,
    'the preceding alpha step must remain below AA',
  )
})

test('dark backgrounds use light cover text and an AA-safe black scrim', () => {
  const darkBackgroundLayout: PosterLayout = {
    ...layout,
    palette_roles: {
      ...layout.palette_roles,
      bg: DARK_BACKGROUND,
    },
  }
  const palette = resolveRedNotePalette(darkBackgroundLayout)
  const cover = resolveRedNoteCoverContrast(DARK_BACKGROUND)

  assert.equal(palette.coverText, '#ffffff')
  assert.equal(
    palette.coverScrim,
    'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.22) 34%, rgba(0,0,0,0.54) 50%, rgba(0,0,0,0.78) 100%)',
  )
  assert.deepEqual(cover.scrim, BLACK)
  assert.equal(cover.textBandAlpha, 0.54)
  assertCoverContrastAtLeastAa(cover, [
    colorOf(DARK_BACKGROUND),
    BLACK,
    WHITE,
  ])
  assert.ok(
    renderedContrast(WHITE, BLACK, WHITE, 0.53) < 4.5,
    'the preceding alpha step must remain below AA',
  )
})

test('background stays authoritative over palette proportions', () => {
  const palette = resolveRedNotePalette({
    ...layout,
    palette_roles: {
      ...layout.palette_roles,
      proportions: [{ color: DARK_BACKGROUND, proportion: 1 }],
    },
  })

  assert.equal(palette.coverText, '#111111')
  assert.match(palette.coverScrim, /rgba\(255,255,255,0\.49\) 50%/)
})

test('invalid cover backgrounds use the deterministic light fallback', () => {
  const cover = resolveRedNoteCoverContrast('not-a-color')
  const palette = resolveRedNotePalette({
    ...layout,
    palette_roles: {
      ...layout.palette_roles,
      bg: 'not-a-color',
    },
  })

  assert.equal(palette.background, '#f4f5f1')
  assert.equal(palette.coverText, '#111111')
  assert.equal(cover.text, '#111111')
  assert.deepEqual(cover.scrim, WHITE)
  assert.equal(cover.textBandAlpha, 0.49)
})

test('cover contrast is never worse than the legacy ramp', () => {
  const cases = [
    {
      label: 'light background and light legacy text',
      background: LIGHT_BACKGROUND,
      legacyLightText: true,
    },
    {
      label: 'light background and dark legacy text',
      background: LIGHT_BACKGROUND,
      legacyLightText: false,
    },
    {
      label: 'dark background and light legacy text',
      background: DARK_BACKGROUND,
      legacyLightText: true,
    },
    {
      label: 'dark background and dark legacy text',
      background: DARK_BACKGROUND,
      legacyLightText: false,
    },
  ] as const

  for (const fixture of cases) {
    const background = colorOf(fixture.background)
    const cover = resolveRedNoteCoverContrast(fixture.background)
    const text = colorOf(cover.text)
    const endAlpha = cover.text === '#ffffff' ? 0.78 : 0.9

    for (const stop of [50, 100] as const) {
      const newAlpha = stop === 50 ? cover.textBandAlpha : endAlpha
      const nextContrast = renderedContrast(
        text,
        cover.scrim,
        background,
        newAlpha,
      )
      const previousContrast = legacyCoverContrast(
        background,
        fixture.legacyLightText,
        stop,
      )
      assert.ok(
        nextContrast >= previousContrast,
        `${fixture.label} regressed at ${stop}%: ${nextContrast} < ${previousContrast}`,
      )
    }
  }
})

function assertCoverContrastAtLeastAa(
  cover: ReturnType<typeof resolveRedNoteCoverContrast>,
  pixels: readonly RGB[],
): void {
  const text = colorOf(cover.text)
  for (const pixel of pixels) {
    assert.ok(
      renderedContrast(text, cover.scrim, pixel, cover.textBandAlpha) >= 4.5,
    )
  }
}

function legacyCoverContrast(
  background: RGB,
  usesLightText: boolean,
  stop: 50 | 100,
): number {
  const text = usesLightText ? WHITE : DARK_TEXT
  const scrim = usesLightText ? BLACK : WHITE
  const midAlpha = usesLightText ? 0.22 : 0.3
  const endAlpha = usesLightText ? 0.78 : 0.9
  const alpha = stop === 100
    ? endAlpha
    : midAlpha + (endAlpha - midAlpha) * ((stop - 34) / (100 - 34))
  return renderedContrast(text, scrim, background, alpha)
}

function renderedContrast(
  text: RGB,
  scrim: RGB,
  pixel: RGB,
  alpha: number,
): number {
  const composited = pixel.map((channel, index) =>
    scrim[index] * alpha + channel * (1 - alpha)
  ) as RGB
  return contrastRatio(text, composited)
}

function colorOf(value: string): RGB {
  const color = parseColor(value)
  if (!color) throw new TypeError(`Expected a valid color, received ${value}.`)
  return color
}
