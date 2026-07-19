import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildEventPrompt } from '../functions/hero.ts'
import { getPosterSize } from '../src/lib/posterSize.ts'

const EVENT = {
  product_name: 'Founders Mixer',
  brand_essence: 'An energetic founder community',
  style_profile: {
    palette: {
      primary: '#10243a',
      accent: '#f15b40',
    },
  },
  poster_spec: {
    title: 'Founders Mixer',
    hook: 'Build together',
    host_line: 'Hosted by Northstar',
    date_line: 'Sat, Jul 4',
    time_line: '6:30 PM PDT',
    location_line: 'The Grand Hall - San Francisco',
  },
}

test('scaled event prompt leaves authoritative logistics for the external footer', () => {
  const prompt = buildEventPrompt(EVENT, false, getPosterSize('a4_2x3'))

  assert.match(prompt, /real date\/time\/location and a scannable QR/)
  assert.match(prompt, /printed separately below the artwork/)
  assert.doesNotMatch(prompt, /reading "Sat, Jul 4"/)
  assert.doesNotMatch(prompt, /reading "6:30 PM PDT"/)
  assert.doesNotMatch(prompt, /reading "The Grand Hall - San Francisco"/)
})

test('bandless event prompt paints exact logistics without promising a footer', () => {
  const prompt = buildEventPrompt(
    EVENT,
    false,
    getPosterSize('rednote_cover_3x4'),
  )

  assert.match(prompt, /PORTRAIT 3:4 EVENT PROMOTION/)
  assert.match(prompt, /date line reading "Sat, Jul 4"/)
  assert.match(prompt, /time line reading "6:30 PM PDT"/)
  assert.match(prompt, /location line reading "The Grand Hall - San Francisco"/)
  assert.match(prompt, /artwork-only format has no footer/i)
  assert.match(
    prompt,
    /Do NOT paint any QR code, barcode, URL, registration link, link call-to-action/,
  )
  assert.doesNotMatch(prompt, /printed separately below the artwork/)
  assert.doesNotMatch(prompt, /Do NOT paint any date, time, address/)
})
