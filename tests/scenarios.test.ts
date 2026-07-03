import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCENARIOS, SCENARIO_ORDER, getScenario } from '../src/scenarios/registry.ts'
import { productScenario } from '../src/scenarios/product.ts'
import { eventScenario } from '../src/scenarios/event.ts'

test('registry exposes product + event, keyed by id', () => {
  assert.equal(SCENARIOS.product, productScenario)
  assert.equal(SCENARIOS.event, eventScenario)
  for (const [id, cfg] of Object.entries(SCENARIOS)) {
    assert.equal(cfg.id, id, `key ${id} must match its config id`)
    assert.ok(cfg.label.length > 0, `${id} has a label`)
    assert.ok(cfg.fields.length > 0, `${id} has at least one field`)
    assert.ok(cfg.conversionLabel.length > 0, `${id} has a conversion label`)
    // The declared primary URL field must exist among the scenario's fields.
    assert.ok(
      cfg.fields.some((f) => f.key === cfg.urlKey),
      `${id}.urlKey (${cfg.urlKey}) must be one of its fields`,
    )
  }
})

test('SCENARIO_ORDER lists product first and only known scenarios', () => {
  assert.deepEqual(SCENARIO_ORDER, ['product', 'event'])
  for (const id of SCENARIO_ORDER) assert.ok(SCENARIOS[id], `${id} is a known scenario`)
})

test('product scenario preserves the current wizard fields', () => {
  const keys = productScenario.fields.map((f) => f.key)
  assert.deepEqual(keys, ['product_url', 'product_name', 'tagline', 'cta_text', 'destination_url'])
  // Everything the user types today stays an input field (nothing scraped).
  assert.ok(productScenario.fields.every((f) => f.source === 'input'))
  assert.equal(productScenario.conversionLabel, 'Conversions')
})

test('event scenario scrapes logistics and relabels the conversion metric', () => {
  assert.equal(eventScenario.urlKey, 'product_url') // repurposed as the event URL
  const scraped = eventScenario.fields.filter((f) => f.source === 'scrape').map((f) => f.key)
  assert.ok(scraped.includes('product_name'))
  assert.ok(scraped.includes('event_starts_at'))
  assert.ok(scraped.includes('event_location'))
  assert.equal(eventScenario.conversionLabel, 'RSVP clicks')
  assert.ok(eventScenario.specRows.length > 0)
})

test('getScenario falls back to product for unknown/absent ids', () => {
  assert.equal(getScenario('event'), eventScenario)
  assert.equal(getScenario('product'), productScenario)
  assert.equal(getScenario(null), productScenario)
  assert.equal(getScenario('nope'), productScenario)
})
