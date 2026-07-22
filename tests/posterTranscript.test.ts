import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  derivePosterTranscript,
  type PosterTranscriptInput,
} from '../src/lib/posterTranscript.ts'
import type {
  PosterLayout,
  PosterSpec,
} from '../src/lib/types.ts'

const PALETTE = {
  bg: '#ffffff',
  text: '#111111',
  primary: '#224466',
  accent: '#dd5522',
}

function layout(zones: PosterLayout['zones']): PosterLayout {
  return {
    composition: 'editorial',
    mood: 'direct',
    art_style: 'print',
    palette_roles: PALETTE,
    zones,
  }
}

test('website transcript follows layout-preview band order and includes the composited footer', () => {
  const transcript = derivePosterTranscript({
    product_name: 'Acme',
    scenario: 'product',
    poster_format: 'a4_2x3',
    poster_spec: { qr_label: 'Start here', urls: 'https://acme.example' },
    poster_layout: layout([
      { band: 'lower', role: 'closing', content: 'Built for teams' },
      { band: 'mid', role: 'blank', content: '   ' },
      { band: 'top', role: 'brand', content: 'Acme' },
      { band: 'upper', role: 'headline', content: 'Ship smarter' },
      {
        band: 'future' as PosterLayout['zones'][number]['band'],
        role: 'proof',
        content: '99.9% uptime',
      },
    ]),
  }, {
    locale: 'en-US',
    includeCompositedFooter: true,
  })

  assert.deepEqual(transcript.blocks, [
    { source: 'poster-layout', text: 'Acme' },
    { source: 'poster-layout', text: 'Ship smarter' },
    { source: 'poster-layout', text: '99.9% uptime' },
    { source: 'poster-layout', text: 'Built for teams' },
    { source: 'composited-footer', text: 'Start here' },
    { source: 'composited-footer', text: 'Point your camera here' },
  ])
  assert.equal(
    transcript.plainText,
    'Acme\n\nShip smarter\n\n99.9% uptime\n\nBuilt for teams\n\nStart here\n\nPoint your camera here',
  )
  assert.equal(
    transcript.shortAlt,
    'Poster for Acme: Ship smarter · 99.9% uptime · Built for teams · Start here · Point your camera here',
  )
})

test('Amazon fallback uses structured content and exact normalized deduplication', () => {
  const transcript = derivePosterTranscript({
    product_name: 'Widget One',
    scenario: 'product',
    poster_format: 'a4_2x3',
    poster_layout: null,
    poster_content: {
      headline: ' Widget   One ',
      what_it_does: 'Fast analytics',
      how_it_works: ['Connect data', ' Fast   analytics '],
      why_use_it: ['Act today'],
      features: ['Team ready', 'Connect data'],
      cta: 'Start now',
    },
  }, {
    locale: 'en-US',
    includeCompositedFooter: false,
  })

  assert.deepEqual(transcript.blocks, [
    { source: 'campaign', text: 'Widget One' },
    { source: 'poster-content', text: 'Fast analytics' },
    { source: 'poster-content', text: 'Connect data' },
    { source: 'poster-content', text: 'Act today' },
    { source: 'poster-content', text: 'Team ready' },
    { source: 'poster-content', text: 'Start now' },
  ])
})

test('legacy product poster_copy fallback preserves campaign-first copy order', () => {
  const transcript = derivePosterTranscript({
    product_name: 'Legacy Widget',
    scenario: 'product',
    poster_format: 'rednote_cover_3x4',
    poster_layout: null,
    poster_content: null,
    poster_copy: {
      hook: 'Lead boldly',
      what_it_does: 'Turns notes into posters',
      features: ['Fast setup', 'Clear exports'],
      cta: 'Try it now',
    },
  }, {
    locale: 'en-US',
    includeCompositedFooter: false,
  })

  assert.deepEqual(transcript.blocks, [
    { source: 'campaign', text: 'Legacy Widget' },
    { source: 'poster-copy', text: 'Lead boldly' },
    { source: 'poster-copy', text: 'Turns notes into posters' },
    { source: 'poster-copy', text: 'Fast setup' },
    { source: 'poster-copy', text: 'Clear exports' },
    { source: 'poster-copy', text: 'Try it now' },
  ])
  assert.equal(
    transcript.plainText,
    'Legacy Widget\n\nLead boldly\n\nTurns notes into posters\n\nFast setup\n\nClear exports\n\nTry it now',
  )
  assert.equal(
    transcript.shortAlt,
    'Poster for Legacy Widget: Lead boldly · Turns notes into posters · Fast setup · Clear exports · Try it now',
  )
})

test('social cover uses localized alt framing and never adds a footer to a bandless format', () => {
  const transcript = derivePosterTranscript({
    product_name: 'Lumen',
    scenario: 'product',
    poster_format: 'rednote_cover_3x4',
    poster_spec: { qr_label: 'Should not appear', urls: '' },
    poster_layout: layout([
      { band: 'top', role: 'brand', content: 'Lumen' },
      { band: 'upper', role: 'headline', content: 'Bold cover' },
    ]),
  }, {
    locale: 'zh-CN',
    includeCompositedFooter: true,
  })

  assert.deepEqual(
    transcript.blocks.map((block) => block.text),
    ['Lumen', 'Bold cover'],
  )
  assert.equal(transcript.shortAlt, 'Lumen 海报：Bold cover')
})

test('legacy RedNote transcript preserves the text-baked layout surface', () => {
  const transcript = derivePosterTranscript({
    product_name: 'City Notes',
    scenario: 'product',
    poster_format: 'rednote_cover_3x4',
    poster_content: {
      headline: 'Ignored fallback headline',
      what_it_does: '',
      how_it_works: [],
      why_use_it: [],
      features: [],
      cta: '',
      rednote_post: {
        schema_version: 1,
        pages: [
          { kind: 'cover', title: 'Multi-page cover' },
          { kind: 'content', heading: 'Second page', blocks: ['Deferred copy'] },
        ],
      },
    },
    poster_layout: layout([
      { band: 'upper', role: 'cover title', content: 'Walk Shanghai slowly' },
      { band: 'mid', role: 'cover subtitle', content: 'Five quiet streets' },
    ]),
  }, {
    locale: 'en-US',
    includeCompositedFooter: true,
  })

  assert.deepEqual(
    transcript.blocks.map((block) => block.text),
    ['Walk Shanghai slowly', 'Five quiet streets'],
  )
  assert.doesNotMatch(transcript.plainText, /Second page|Deferred copy/)
})

test('marked RedNote transcript exposes only the DOM-composited cover', () => {
  const transcript = derivePosterTranscript({
    product_name: 'City Notes',
    scenario: 'product',
    use_case: 'rednote_post',
    poster_format: 'rednote_cover_3x4',
    poster_content: {
      headline: 'Projected title',
      what_it_does: 'Projected subtitle',
      how_it_works: [],
      why_use_it: [],
      features: ['Second page'],
      cta: '',
      rednote_post: {
        schema_version: 1,
        pages: [
          {
            kind: 'cover',
            title: 'Walk Shanghai slowly',
            subtitle: 'Five quiet streets',
          },
          {
            kind: 'content',
            heading: 'Second page',
            blocks: ['Deferred copy'],
          },
        ],
      },
    },
    poster_layout: {
      ...layout([]),
      render_mode: 'rednote-background-v1',
    },
  }, {
    locale: 'en-US',
    includeCompositedFooter: false,
  })

  assert.deepEqual(transcript.blocks, [
    { source: 'poster-content', text: 'Walk Shanghai slowly' },
    { source: 'poster-content', text: 'Five quiet streets' },
  ])
  assert.doesNotMatch(
    transcript.plainText,
    /Projected title|Projected subtitle|Second page|Deferred copy/,
  )
})

test('scaled event artwork and footer use only poster_spec provenance', () => {
  const input = {
    product_name: 'Fallback event',
    scenario: 'event',
    poster_format: 'a4_2x3',
    poster_copy: {
      hook: 'Forbidden poster copy hook',
      what_it_does: '',
      features: [],
      cta: '',
    },
    poster_spec: {
      title: 'Design Night',
      date_line: 'Sat, Jul 4',
      time_line: '6:30 PM PDT',
      location_line: 'The Grand Hall',
      host_line: 'Hosted by Studio North',
      rsvp_label: 'Reserve a seat',
      price_line: '$20',
      urls: 'https://events.example/rsvp',
    } as unknown as PosterSpec,
  } satisfies PosterTranscriptInput

  const artworkOnly = derivePosterTranscript(input, {
    locale: 'en-US',
    includeCompositedFooter: false,
  })
  assert.deepEqual(
    artworkOnly.blocks.map((block) => block.text),
    ['Design Night', 'Hosted by Studio North'],
  )

  const withFooter = derivePosterTranscript(input, {
    locale: 'en-US',
    includeCompositedFooter: true,
  })
  assert.deepEqual(withFooter.blocks, [
    { source: 'poster-spec', text: 'Design Night' },
    { source: 'poster-spec', text: 'Hosted by Studio North' },
    { source: 'composited-footer', text: 'Reserve a seat' },
    { source: 'composited-footer', text: 'Sat, Jul 4 · 6:30 PM PDT' },
    { source: 'composited-footer', text: 'The Grand Hall' },
  ])
  assert.doesNotMatch(
    withFooter.plainText,
    /Forbidden poster copy hook|\$20|events\.example/,
  )
})

test('event title falls back to product_name when poster_spec title is empty', () => {
  const transcript = derivePosterTranscript({
    product_name: 'Fallback Event Name',
    scenario: 'event',
    poster_format: 'a4_2x3',
    poster_spec: {
      title: '',
      hook: 'Meet the makers',
      host_line: 'Hosted by North Studio',
    } as PosterSpec,
  }, {
    locale: 'en-US',
    includeCompositedFooter: false,
  })

  assert.deepEqual(transcript.blocks, [
    { source: 'poster-spec', text: 'Fallback Event Name' },
    { source: 'poster-spec', text: 'Meet the makers' },
    { source: 'poster-spec', text: 'Hosted by North Studio' },
  ])
})

test('bandless legacy event adds authoritative logistics but omits RSVP, price, and URLs', () => {
  const transcript = derivePosterTranscript({
    product_name: 'Fallback title',
    scenario: 'event',
    poster_format: 'rednote_cover_3x4',
    poster_copy: {
      hook: 'Wrong hook',
      what_it_does: '',
      features: [],
      cta: '',
    },
    poster_spec: {
      title: 'Summer Assembly',
      hook: 'Meet beyond the screen',
      host_line: 'Presented by Field Office',
      date_line: 'Thu, Aug 20',
      time_line: '7:00 PM',
      location_line: 'Harbor Room',
      rsvp_label: 'Join us',
      price_line: 'Free',
      urls: 'https://events.example/summer',
    } as unknown as PosterSpec,
  }, {
    locale: 'en-US',
    includeCompositedFooter: true,
  })

  assert.deepEqual(
    transcript.blocks.map((block) => block.text),
    [
      'Summer Assembly',
      'Meet beyond the screen',
      'Presented by Field Office',
      'Thu, Aug 20',
      '7:00 PM',
      'Harbor Room',
    ],
  )
  assert.doesNotMatch(transcript.plainText, /Wrong hook|Join us|Free|events\.example/)
})

test('null content and layout degrade to historical campaign copy, then to Generated poster', () => {
  const historical = derivePosterTranscript({
    product_name: 'Archive launch',
    tagline: 'The original line',
    scenario: 'product',
    poster_content: null,
    poster_copy: null,
    poster_layout: null,
  }, {
    locale: 'en-US',
    includeCompositedFooter: false,
  })
  assert.deepEqual(
    historical.blocks.map((block) => block.text),
    ['Archive launch', 'The original line'],
  )

  const empty = derivePosterTranscript({
    product_name: '  ',
    tagline: '\n\t',
    scenario: 'product',
    poster_content: null,
    poster_layout: null,
  }, {
    locale: 'zh-CN',
    includeCompositedFooter: false,
  })
  assert.deepEqual(empty.blocks, [])
  assert.equal(empty.plainText, '')
  assert.equal(empty.shortAlt, '生成的海报')
})

test('product-name-only transcript uses localized name poster short alt', () => {
  const transcript = derivePosterTranscript({
    product_name: 'Solo Product',
    tagline: null,
    scenario: 'product',
    poster_format: 'rednote_cover_3x4',
    poster_layout: null,
    poster_content: {
      headline: '',
      what_it_does: '',
      how_it_works: [],
      why_use_it: [],
      features: [],
      cta: '',
    },
    poster_copy: {
      hook: '',
      what_it_does: '',
      features: [],
      cta: '',
    },
  }, {
    locale: 'zh-CN',
    includeCompositedFooter: false,
  })

  assert.deepEqual(transcript.blocks, [
    { source: 'campaign', text: 'Solo Product' },
  ])
  assert.equal(transcript.blocks.length, 1)
  assert.equal(transcript.plainText, 'Solo Product')
  assert.equal(transcript.shortAlt, 'Solo Product 海报')
})

test('malformed blank zones are skipped and normalized duplicates keep the first source', () => {
  const transcript = derivePosterTranscript({
    product_name: 'Case test',
    scenario: 'product',
    poster_layout: layout([
      { band: 'lower', role: 'one', content: '  Proof   point  ' },
      { band: 'top', role: 'blank', content: '\n\t' },
      { band: 'mid', role: 'duplicate', content: 'Proof point' },
      { band: 'mid', role: 'case-sensitive', content: 'proof point' },
    ]),
  }, {
    locale: 'en-US',
    includeCompositedFooter: false,
  })

  assert.deepEqual(
    transcript.blocks.map((block) => block.text),
    ['Proof point', 'proof point'],
  )
})

test('short alt truncation is code-point safe and bounded to 150 code points', () => {
  const transcript = derivePosterTranscript({
    product_name: null,
    scenario: 'product',
    poster_layout: layout([
      { band: 'upper', role: 'headline', content: `Launch ${'🚀'.repeat(200)}` },
    ]),
  }, {
    locale: 'en-US',
    includeCompositedFooter: false,
  })

  assert.equal(Array.from(transcript.shortAlt).length, 150)
  assert.equal(transcript.shortAlt.endsWith('…'), true)
  assert.equal(transcript.shortAlt.includes('\ufffd'), false)
})

test('product footer fallbacks are exact and gated by caller intent', () => {
  const input: PosterTranscriptInput = {
    product_name: 'Fallback footer',
    scenario: 'product',
    poster_format: 'a4_2x3',
    poster_layout: layout([
      { band: 'upper', role: 'headline', content: 'One clear message' },
    ]),
    poster_spec: { qr_label: ' ', urls: '' },
  }

  const withoutFooter = derivePosterTranscript(input, {
    locale: 'en-US',
    includeCompositedFooter: false,
  })
  assert.deepEqual(
    withoutFooter.blocks.map((block) => block.text),
    ['One clear message'],
  )

  const withFooter = derivePosterTranscript(input, {
    locale: 'zh-CN',
    includeCompositedFooter: true,
  })
  assert.deepEqual(
    withFooter.blocks.map((block) => block.text),
    ['One clear message', 'Scan to start', 'Point your camera here'],
  )
})

test('invalid poster_format degrades to a transcript without a composited footer', () => {
  const transcript = derivePosterTranscript({
    product_name: 'Corrupt format',
    scenario: 'product',
    poster_format: (
      'not_a_real_format' as unknown as PosterTranscriptInput['poster_format']
    ),
    poster_layout: layout([
      { band: 'upper', role: 'headline', content: 'Still readable' },
    ]),
    poster_spec: { qr_label: 'Should not appear', urls: '' },
  }, {
    locale: 'en-US',
    includeCompositedFooter: true,
  })

  assert.deepEqual(transcript.blocks, [
    { source: 'poster-layout', text: 'Still readable' },
  ])
  assert.equal(transcript.plainText, 'Still readable')
  assert.equal(
    transcript.shortAlt,
    'Poster for Corrupt format: Still readable',
  )
})

test('derivation never mutates a deeply frozen input', () => {
  const input = deepFreeze({
    product_name: 'Frozen',
    scenario: 'product' as const,
    poster_format: 'a4_2x3' as const,
    poster_layout: layout([
      { band: 'lower', role: 'closing', content: 'Last' },
      { band: 'top', role: 'brand', content: 'Frozen' },
      { band: 'upper', role: 'headline', content: 'First' },
    ]),
    poster_spec: { qr_label: 'Start frozen', urls: '' },
  })
  const before = structuredClone(input)

  derivePosterTranscript(input, {
    locale: 'en-US',
    includeCompositedFooter: true,
  })

  assert.deepEqual(input, before)
})

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
