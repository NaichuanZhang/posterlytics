import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  REDNOTE_BACKGROUND_RENDER_MODE,
  buildRedNoteBackgroundPrompt,
  deriveRedNoteBackgroundLayout,
  hasCompatibleRedNoteBackgroundParent,
} from '../functions/_redNoteBackground.ts'

const posterContent = {
  headline: 'Forbidden projected title',
  rednote_post: {
    schema_version: 1,
    pages: [
      {
        kind: 'cover',
        title: 'Lantern paths after rain',
        subtitle: 'Five quiet turns',
      },
      {
        kind: 'content',
        heading: 'Follow reflections',
        blocks: ['Walk where the light breaks across the street.'],
      },
    ],
  },
}

const styleProfile = {
  palette: {
    bg: '#111111',
    text: '#f7f4ed',
    primary: '#f45b69',
    accent: '#70c1b3',
    supporting: ['#235789'],
    proportions: [
      { color: '#111111', proportion: 0.62 },
      { color: '#f45b69', proportion: 0.2 },
    ],
  },
  fonts: { heading: 'Fixture Display', body: 'Fixture Sans' },
  tone: 'kinetic, luminous',
  layout_hint: 'full-bleed diagonal editorial sweep',
  imagery: 'silhouetted figure crossing a luminous field',
  typography_treatment: 'condensed display lettering',
  lighting: 'hard side light with a saturated glow',
  texture: 'fine photographic grain',
  motifs: ['cropped circles', 'diagonal light bands'],
  composition: 'full-bleed diagonal editorial sweep',
  density: 'balanced',
}

test('deterministic RedNote layout carries the marker and only role-only zones', () => {
  const contentSnapshot = structuredClone(posterContent)
  const styleSnapshot = structuredClone(styleProfile)
  const layout = deriveRedNoteBackgroundLayout({
    posterContent,
    styleProfile,
    posterFormat: 'rednote_cover_3x4',
  })

  assert.equal(layout.render_mode, REDNOTE_BACKGROUND_RENDER_MODE)
  assert.equal(layout.zones.length, 4)
  assert.equal(layout.zones.every((zone) => zone.content === ''), true)
  assert.match(layout.zones[3].role, /x 96, y 852, width 1050, height 636/)
  assert.equal(layout.typography_treatment, undefined)
  assert.deepEqual(posterContent, contentSnapshot)
  assert.deepEqual(styleProfile, styleSnapshot)
})

test('background prompt excludes every plan/campaign string and bans all glyphs', () => {
  const layout = deriveRedNoteBackgroundLayout({
    posterContent,
    styleProfile,
    posterFormat: 'rednote_cover_3x4',
  })
  const prompt = buildRedNoteBackgroundPrompt(
    layout,
    'rednote_cover_3x4',
    posterContent,
  )

  for (const forbidden of [
    'Forbidden projected title',
    'Lantern paths after rain',
    'Five quiet turns',
    'Follow reflections',
    'Walk where the light breaks across the street.',
    'Fixture Display',
    'Fixture Sans',
    'condensed display lettering',
  ]) {
    assert.doesNotMatch(prompt, new RegExp(forbidden.replaceAll('.', '\\.')))
  }
  assert.match(prompt, /ABSOLUTE TEXT EXCLUSION/)
  assert.match(prompt, /no letters, words, numbers, punctuation/)
  assert.match(prompt, /logos, wordmarks, watermarks/)
  assert.match(prompt, /faux typography, or text-like glyphs/)
  assert.match(prompt, /Do not imitate writing in any language/)
})

test('background generation rejects missing contracts before image generation', () => {
  const layout = deriveRedNoteBackgroundLayout({
    posterContent,
    styleProfile,
    posterFormat: 'rednote_cover_3x4',
  })

  assert.throws(
    () => deriveRedNoteBackgroundLayout({
      posterContent: {},
      styleProfile,
      posterFormat: 'rednote_cover_3x4',
    }),
    /valid multi-page post plan/,
  )
  assert.throws(
    () => buildRedNoteBackgroundPrompt(
      { ...layout, render_mode: undefined },
      'rednote_cover_3x4',
      posterContent,
    ),
    /layout marker/,
  )
  assert.throws(
    () => buildRedNoteBackgroundPrompt(layout, 'a4_2x3', posterContent),
    /full-bleed 3:4 format/,
  )
})

test('only a parent with the same background marker is compatible', () => {
  assert.equal(hasCompatibleRedNoteBackgroundParent(null), false)
  assert.equal(hasCompatibleRedNoteBackgroundParent({}), false)
  assert.equal(
    hasCompatibleRedNoteBackgroundParent({
      render_mode: REDNOTE_BACKGROUND_RENDER_MODE,
    }),
    true,
  )
})
