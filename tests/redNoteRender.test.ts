import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  REDNOTE_BACKGROUND_RENDER_MODE,
  contrastCheckedColor,
  contrastRatio,
  getRedNotePageRenderModel,
  resolveRedNotePalette,
  resolveRedNoteRenderState,
} from '../src/lib/redNoteRender.ts'
import type { RedNotePostPlan } from '../src/lib/redNotePost.ts'
import type { PosterLayout } from '../src/lib/types.ts'
import { parseColor } from '../src/lib/colorUtils.ts'

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
  assert.equal(palette.coverText, '#ffffff')
  assert.match(palette.coverScrim, /rgba\(0,0,0,0\.78\)/)

  const darkCover = resolveRedNotePalette({
    ...layout,
    palette_roles: {
      ...layout.palette_roles,
      text: '#152238',
    },
  })
  assert.equal(darkCover.coverText, '#111111')
  assert.match(darkCover.coverScrim, /rgba\(255,255,255,0\.9\)/)
})
