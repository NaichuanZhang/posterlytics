import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizePosterLayout,
  compileLayoutPrompt,
  ensurePosterLayoutZones,
  buildParentContextPrompt,
  productPosterActionInstructions,
  type PosterLayout,
} from '../functions/_shared.ts'
import {
  getPosterFrameLabel,
  getPosterSize,
  POSTER_SIZES,
} from '../src/lib/posterSize.ts'
import { stripPainterPromptEmoji } from '../functions/_copySanitizer.ts'
import { appendArtifactRetrySuffix } from '../functions/_painterArtifactValidation.ts'
import { resolveProductUseCaseRecipe } from '../functions/_useCasePolicy.ts'
import { buildPosterPrompt } from '../functions/hero.ts'

const PALETTE = { bg: '#0b1020', text: '#e8ecf5', primary: '#3b82f6', accent: '#f97316' }
const TEXT_BEARING_PAINTER_ARTIFACT_EXCLUSION =
  'PAINTER ARTIFACT EXCLUSION: Do not paint decorative emoji, emoticons, or pictographs. Do not render placeholder or slot-label words such as "Logo", "Headline", or "CTA"; do not add a brand name as unquoted text or append "Logo" to a brand name. These items may appear only when they occur verbatim inside an exact quoted string below.'

test('normalizePosterLayout fills defaults from palette when fields are missing', () => {
  const l = normalizePosterLayout({}, PALETTE)
  assert.equal(l.palette_roles.bg, '#0b1020')
  assert.equal(l.palette_roles.accent, '#f97316')
  assert.ok(l.composition.length > 0)
  assert.ok(l.mood.length > 0)
  assert.ok(l.art_style.length > 0)
  assert.deepEqual(l.zones, [])
})

test('normalizePosterLayout keeps valid zones, drops empty ones, clamps band/emphasis/align', () => {
  const raw = {
    composition: 'asymmetric hero top-left',
    mood: 'editorial, premium',
    art_style: 'flat vector',
    palette_roles: { bg: '#fff', text: '#111', primary: '#222', accent: '#f00', surface: '#eee' },
    zones: [
      { band: 'top', role: 'brand row', content: 'Acme', emphasis: 'low', align: 'left' },
      { band: 'nonsense', role: 'hero', content: 'Big', emphasis: 'wild', align: 'sideways' },
      { band: 'lower', role: '', content: '' }, // dropped: no role/content
    ],
  }
  const l = normalizePosterLayout(raw, PALETTE)
  assert.equal(l.zones.length, 2)
  assert.equal(l.zones[0].band, 'top')
  assert.equal(l.zones[0].emphasis, 'low')
  assert.equal(l.zones[0].align, 'left')
  // invalid band → 'mid'; invalid emphasis/align dropped
  assert.equal(l.zones[1].band, 'mid')
  assert.equal(l.zones[1].emphasis, undefined)
  assert.equal(l.zones[1].align, undefined)
  assert.equal(l.palette_roles.surface, '#eee')
})

test('normalizePosterLayout caps zones at 7 and truncates long strings', () => {
  const zones = Array.from({ length: 12 }, (_, i) => ({ band: 'mid', role: `r${i}`, content: `c${i}` }))
  const l = normalizePosterLayout({ zones, composition: 'x'.repeat(500) }, PALETTE)
  assert.equal(l.zones.length, 7)
  assert.ok(l.composition.length <= 240)
})

test('normalizePosterLayout keeps role-only zones when copy is rejected', () => {
  const l = normalizePosterLayout({
    zones: [
      { band: 'upper', role: 'hero headline', content: '{headline}' },
      { band: 'mid', role: '', content: '[headline]' },
    ],
  }, PALETTE, {}, {})

  assert.deepEqual(l.zones, [{
    band: 'upper',
    role: 'hero headline',
    content: '',
  }])
})

test('normalizePosterLayout preserves sourced emoji and removes decorative emoji', () => {
  const l = normalizePosterLayout({
    zones: [{
      band: 'upper',
      role: 'hero headline',
      content: 'Visit Café ☕ Roasters 🚀',
    }],
  }, PALETTE, {}, {
    verbatimTexts: ['Café ☕ Roasters'],
    emojiSourceTexts: ['Café ☕ Roasters'],
  })

  assert.equal(l.zones[0].content, 'Visit Café ☕ Roasters')
})

test('normalizePosterLayout bounds zone copy by code point', () => {
  const l = normalizePosterLayout({
    zones: [{
      band: 'upper',
      role: 'hero headline',
      content: '界'.repeat(300),
    }],
  }, PALETTE)

  assert.equal(Array.from(l.zones[0].content).length, 280)
})

test('ensurePosterLayoutZones repairs sparse model output to three zones immutably', () => {
  const layout = normalizePosterLayout({
    zones: [{ band: 'upper', role: 'hero headline', content: 'One clear idea' }],
  }, PALETTE)
  const repaired = ensurePosterLayoutZones(layout, [
    { band: 'top', role: 'plain-text brand row', content: 'Acme' },
    { band: 'upper', role: 'hero headline', content: 'One clear idea' },
    { band: 'mid', role: 'source-derived imagery focal area', content: '' },
  ])
  assert.equal(layout.zones.length, 1)
  assert.equal(repaired.zones.length, 3)
  assert.equal(repaired.zones[2].role, 'source-derived imagery focal area')
})

const LAYOUT: PosterLayout = {
  composition: 'asymmetric, oversized hero top-left',
  mood: 'editorial, calm, premium',
  art_style: 'flat vector + soft gradients',
  palette_roles: PALETTE,
  zones: [
    { band: 'lower', role: 'call to action', content: 'Start free today', emphasis: 'high', align: 'center' },
    { band: 'top', role: 'brand row', content: 'Acme Analytics' },
    { band: 'upper', role: 'hero headline', content: 'Ship dashboards fast' },
  ],
}

test('compileLayoutPrompt orders zones top→lower regardless of input order', () => {
  const prompt = compileLayoutPrompt(LAYOUT, { product: 'Acme', essence: 'a crisp blue data brand' })
  const iTop = prompt.indexOf('Acme Analytics')
  const iUpper = prompt.indexOf('Ship dashboards fast')
  const iLower = prompt.indexOf('Start free today')
  assert.ok(iTop > -1 && iUpper > -1 && iLower > -1)
  assert.ok(iTop < iUpper && iUpper < iLower, 'top must come before upper before lower')
})

test('product and social prompts include the exact painter artifact exclusion', () => {
  const prompts = [
    compileLayoutPrompt(
      LAYOUT,
      { product: 'Acme', essence: 'a crisp blue data brand' },
    ),
    compileLayoutPrompt(
      LAYOUT,
      { product: 'Acme', essence: 'a crisp blue data brand' },
      getPosterSize('yt_thumb_16x9'),
      resolveProductUseCaseRecipe('social_cover'),
    ),
  ]

  for (const prompt of prompts) {
    assert.ok(prompt.includes(TEXT_BEARING_PAINTER_ARTIFACT_EXCLUSION))
    assert.ok(
      prompt.indexOf(TEXT_BEARING_PAINTER_ARTIFACT_EXCLUSION)
        < prompt.indexOf('Arrange the poster top to bottom'),
    )
  }
})

test('assembled product prompts strip painter-bound emoji from copy and context', () => {
  const layout = {
    ...LAYOUT,
    motifs: ['speech 💬', 'amber 🟠', 'gear ⚙️', 'search 🔍'],
    zones: [
      {
        band: 'upper' as const,
        role: 'hero headline',
        content: 'Plan work 💬 clearly ☕',
        emphasis: 'high' as const,
      },
    ],
  }
  const prompts = [
    stripPainterPromptEmoji(compileLayoutPrompt(layout, {
      product: 'Taskpilot ☕',
      essence: 'A focused system with amber tools 🟠',
    })),
    stripPainterPromptEmoji(compileLayoutPrompt(
      { ...layout, zones: [] },
      { product: 'Taskpilot ☕', essence: '' },
    )),
  ]

  for (const prompt of prompts) {
    for (const emoji of ['💬', '🟠', '⚙️', '🔍', '☕']) {
      assert.equal(prompt.includes(emoji), false)
    }
  }
  assert.match(prompts[0], /Render the exact text: "Plan work clearly"/)
  assert.match(prompts[0], /A focused system with amber tools/)
  assert.match(prompts[1], /Taskpilot/)
})

for (const size of POSTER_SIZES) {
  test(`compileLayoutPrompt embeds exact content and ${size.slug} framing`, () => {
    const prompt = compileLayoutPrompt(
      LAYOUT,
      { product: 'Acme', essence: 'a crisp blue data brand' },
      size,
    )
    assert.ok(prompt.includes('"Start free today"'))
    assert.ok(prompt.includes('"Ship dashboards fast"'))
    assert.ok(prompt.includes(getPosterFrameLabel(size)))
    assert.match(prompt, /primary brand blue fill/)
    assert.match(prompt, /accent orange fill/)
    assert.doesNotMatch(prompt, /#[0-9a-f]{3,8}/i)
    assert.ok(prompt.includes('a crisp blue data brand'))
    assert.ok(/QR code or barcode drawn by you/i.test(prompt))
  })
}

test('compileLayoutPrompt lets the artwork fill the frame — no crop or reserved-margin instructions', () => {
  // All four bands present, so every band label lands in the prompt.
  const fullFrame: PosterLayout = {
    ...LAYOUT,
    zones: [...LAYOUT.zones, { band: 'mid', role: 'feature grid', content: 'Fast · Safe · Easy' }],
  }
  const prompt = compileLayoutPrompt(fullFrame, { product: 'Acme', essence: '' })
  assert.ok(
    !/BOTTOM ~26%|reserved bottom margin|cropped off|FINISH all artwork/i.test(prompt),
    'must not reserve or crop any part of the frame',
  )
  // The band labels cover the complete frame.
  assert.ok(prompt.includes('0-12%'))
  assert.ok(prompt.includes('12-42%'))
  assert.ok(prompt.includes('42-72%'))
  assert.ok(prompt.includes('72-100%'))
})

test('compileLayoutPrompt forbids painted buttons (printed poster, not a web UI)', () => {
  const prompt = compileLayoutPrompt(LAYOUT, { product: 'Acme', essence: '' })
  assert.ok(/do NOT draw buttons/i.test(prompt), 'must instruct the model not to draw buttons')
  assert.ok(/painted buttons \/ pills \/ clickable UI controls/i.test(prompt), 'Avoid list must call out buttons')
})

test('compileLayoutPrompt forbids a redundant CTA without forcing dense filler', () => {
  const prompt = compileLayoutPrompt(LAYOUT, { product: 'Acme', essence: '' })
  assert.ok(/QR footer bar.*IS the call-to-action/i.test(prompt), 'QR footer is the CTA')
  assert.ok(/do NOT render any "Get started"/i.test(prompt), 'must forbid a painted CTA line')
  assert.ok(!/INFORMATION-DENSE/i.test(prompt), 'must not impose universal density')
  assert.ok(!/feature grid, a stat or proof row/i.test(prompt), 'must not impose generic filler zones')
})

test('bandless product prompts never promise a footer and still forbid link artwork', () => {
  const size = getPosterSize('rednote_cover_3x4')
  const prompt = compileLayoutPrompt(
    LAYOUT,
    { product: 'Acme', essence: '' },
    size,
  )
  const instructions = productPosterActionInstructions(size)

  assert.doesNotMatch(prompt, /printed separately below|footer bar.*call-to-action/i)
  assert.match(prompt, /artwork-only format has no QR footer/i)
  assert.match(prompt, /Do NOT render any QR code, barcode, URL, link call-to-action/i)
  assert.match(instructions.designerRule, /artwork-only export with no footer/i)
  assert.match(instructions.designerRule, /QR code, barcode, URL, link call-to-action/i)
  assert.doesNotMatch(instructions.designerRule, /footer bar.*IS the call-to-action/i)
  assert.match(instructions.designerRequest, /no QR code, URL, link CTA/i)
})

test('scaled product prompts retain the placement QR footer contract', () => {
  const instructions = productPosterActionInstructions(getPosterSize('a4_2x3'))

  assert.match(instructions.designerRule, /tracked QR footer bar.*IS the call-to-action/i)
  assert.match(instructions.painterRule, /scannable QR footer bar.*IS the call-to-action/i)
  assert.match(instructions.designerRequest, /QR footer is the action/i)
})

test('reference-only policy suppresses tracking even for a malformed banded format', () => {
  for (const useCase of ['social_cover', 'rednote_post'] as const) {
    const instructions = productPosterActionInstructions(
      getPosterSize('a4_2x3'),
      resolveProductUseCaseRecipe(useCase),
    )

    assert.match(instructions.designerRule, /no footer or tracking mechanics/i)
    assert.match(instructions.painterRule, /FULL-BLEED SOCIAL ARTWORK/)
    assert.doesNotMatch(instructions.painterRule, /scannable QR footer/i)
  }
})

test('compileLayoutPrompt preserves sparse source rhythm and visual treatment', () => {
  const prompt = compileLayoutPrompt({
    ...LAYOUT,
    density: 'sparse',
    imagery: 'full-bleed cinematic character art',
    typography_treatment: 'metallic gold high-contrast display lettering',
    lighting: 'low-key violet rim light',
    texture: 'polished metal and film grain',
    motifs: ['constellation lines'],
    palette_roles: {
      ...PALETTE,
      supporting: ['#241447'],
      proportions: [
        { color: '#050711', proportion: 0.72 },
        { color: '#7c3aed', proportion: 0.12 },
      ],
    },
  }, { product: 'Acme', essence: '', hasStyleBoard: true })
  assert.match(prompt, /SPARSE rhythm/)
  assert.match(prompt, /generous intentional negative space/)
  assert.match(prompt, /metallic gold/)
  assert.match(prompt, /low-key violet rim light/)
  assert.match(prompt, /black about 72%/)
  assert.match(prompt, /violet about 12%/)
  assert.doesNotMatch(prompt, /#[0-9a-f]{3,8}/i)
  assert.match(prompt, /labeled STYLE BOARD image captured from the real source page is attached/)
})

test('compileLayoutPrompt preserves hex-like quoted zone copy only', () => {
  const prompt = compileLayoutPrompt({
    ...LAYOUT,
    composition: 'high contrast #123456 field',
    palette_roles: {
      ...PALETTE,
      bg: '#FF5733',
    },
    zones: [{
      band: 'upper',
      role: 'hero headline',
      content: 'Launch #FF5733 at #facade',
      emphasis: 'high',
    }],
  }, {
    product: 'Acme',
    essence: 'A bright #decade identity',
  })

  const quotedCopy = '"Launch #FF5733 at #facade"'
  assert.match(prompt, /background coral fill/)
  assert.ok(prompt.includes(quotedCopy))
  assert.doesNotMatch(prompt.replace(quotedCopy, ''), /#[0-9a-f]{3,8}/i)
})

test('buildPosterPrompt scrubs hex in fallback and parent iteration context', () => {
  const prompt = buildPosterPrompt({
    product_name: 'Acme',
    tagline: 'Ship with confidence',
    instruction: 'Keep the #123456 field and refine the hierarchy.',
    brand_essence: 'A precise #abcdef identity',
    poster_content: {
      headline: 'Move faster',
      what_it_does: 'One clear workflow',
      features: ['Fast setup'],
    },
    style_profile: {
      palette: PALETTE,
    },
    reference_images: [],
  }, 'designer', false, false, {
    ...LAYOUT,
    composition: 'parent #fedcba composition',
  }, true)

  assert.match(prompt, /USER REQUEST: Keep the \w+(?: \w+)* field and refine the hierarchy\./)
  assert.match(prompt, /PARENT LAYOUT JSON/)
  assert.doesNotMatch(prompt, /#[0-9a-f]{3,8}/i)
})

test('painter retry suffix preserves the first pass and appends deterministic retry-only clauses', () => {
  const prompt = buildPosterPrompt({
    product_name: 'Acme',
    poster_layout: LAYOUT,
    reference_images: [],
  }, 'designer', false)

  assert.equal(appendArtifactRetrySuffix(prompt, []), prompt)
  assert.equal(
    appendArtifactRetrySuffix(prompt, [
      'slot_label_words',
      'decorative_glyphs',
    ]),
    `${prompt}

RETRY-ONLY RASTER CORRECTION:
- Remove unauthorized standalone decorative icon glyphs, icon bullets, checkboxes, badges, and pictographs. Use spacing, typography, plain dots, or simple non-symbol geometry instead.
- Remove placeholder and structural slot-label words. Render only the exact authorized strings already specified in the painter contract.`,
  )
})

test('compileLayoutPrompt includes a logo instruction only when hasLogo', () => {
  const withLogo = compileLayoutPrompt(LAYOUT, { product: 'Acme', essence: '', hasLogo: true })
  const noLogo = compileLayoutPrompt(LAYOUT, { product: 'Acme', essence: '', hasLogo: false })
  assert.ok(/reference image of the brand LOGO/i.test(withLogo), 'logo line present when hasLogo')
  assert.ok(!/reference image of the brand LOGO/i.test(noLogo), 'no logo line when no logo')
  assert.match(noLogo, /render only the product name/i)
  assert.match(noLogo, /Do not invent or render any logo, icon, emblem, monogram, mascot, or brand symbol/i)
})

test('compileLayoutPrompt tolerates an empty zone list with a sensible default', () => {
  const prompt = compileLayoutPrompt({ ...LAYOUT, zones: [] }, { product: 'Acme', essence: '' })
  assert.ok(prompt.includes('2:3'))
  assert.ok(prompt.includes('UPPER area: a bold hero headline'))
  assert.ok(!/BOTTOM ~26%/.test(prompt))
})

test('buildParentContextPrompt isolates the requested delta and preserves everything else', () => {
  const prompt = buildParentContextPrompt({
    instruction: 'Make the headline larger and leave the rest alone.',
    parentLayout: LAYOUT,
    hasPreviousPoster: true,
  })

  assert.match(prompt, /Edit the current poster into its next version/)
  assert.match(prompt, /PREVIOUS-POSTER reference is the primary/)
  assert.match(prompt, /Make the headline larger/)
  assert.match(prompt, /Keep every element.*user did not explicitly ask to change/)
  assert.match(prompt, /PARENT LAYOUT JSON/)
  assert.match(prompt, /BRAND SNAPSHOT/)
})

test('buildParentContextPrompt identifies a first website-backed version', () => {
  const prompt = buildParentContextPrompt({
    instruction: null,
    parentLayout: null,
    hasPreviousPoster: false,
    refreshWebsite: true,
  })

  assert.match(prompt, /first poster version/)
  assert.match(prompt, /freshly captured website evidence/)
})

test('buildParentContextPrompt gives one factual reflow instruction for a format change', () => {
  const prompt = buildParentContextPrompt({
    instruction: 'Keep the message.',
    parentLayout: LAYOUT,
    hasPreviousPoster: true,
    parentPosterSize: getPosterSize('a4_2x3'),
    posterSize: getPosterSize('rednote_3x4'),
  })
  const formatLines = prompt
    .split('\n')
    .filter((line) => line.startsWith('FORMAT CHANGE:'))

  assert.deepEqual(formatLines, [
    'FORMAT CHANGE: The target frame is PORTRAIT 3:4. Recompose the poster for this frame.',
  ])
})

test('buildParentContextPrompt omits reflow instructions when the format is unchanged', () => {
  const size = getPosterSize('yt_thumb_16x9')
  const prompt = buildParentContextPrompt({
    instruction: null,
    parentLayout: LAYOUT,
    hasPreviousPoster: true,
    parentPosterSize: size,
    posterSize: size,
  })

  assert.doesNotMatch(prompt, /FORMAT CHANGE/)
})
