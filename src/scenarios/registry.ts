import type { CampaignScenario } from '../lib/types'
import { productScenario } from './product'
import { eventScenario } from './event'

// Scenario registry — the single source of truth for how each campaign scenario
// (product, event, …) is created and displayed on the FRONTEND: which wizard
// fields to show, their labels/placeholders, and the editor spec-card rows. Adding
// a scenario = one ScenarioConfig here (plus its backend prompt branch inside the
// edge functions, which Subhosting keeps as an internal dispatch table rather than
// a shared import).
//
// Pure data (no JSX), so it's unit-testable and tree-shaken until the wizard/editor
// wire it up in Phase 1.

// How a wizard field is populated.
//   'input'  — the user types it.
//   'scrape' — auto-filled from the source (e.g. the Luma page); editable, and the
//              manual field is the fallback when the scrape is incomplete.
export type FieldSource = 'input' | 'scrape'

export type FieldType = 'url' | 'text' | 'datetime'

// One field collected by the campaign wizard for a scenario.
export interface ScenarioField {
  key: string // the campaigns column (or an event_details-mapped key) this writes
  label: string
  type: FieldType
  required: boolean
  source: FieldSource
  placeholder?: string
  hint?: string
}

// One row shown in the editor's poster-spec card for a scenario.
export interface ScenarioSpecRow {
  label: string
  key: string // field on the scenario's spec/details object
}

// Everything the frontend needs to drive one scenario.
export interface ScenarioConfig {
  id: CampaignScenario
  label: string
  hint: string
  urlKey: string // which field holds the primary source URL (the scrape target)
  fields: ScenarioField[]
  specRows: ScenarioSpecRow[]
  conversionLabel: string // dashboard label for a "conversion" in this scenario
}

// The registry, keyed by scenario id.
export const SCENARIOS: Record<CampaignScenario, ScenarioConfig> = {
  product: productScenario,
  event: eventScenario,
}

// The scenarios shown in the wizard picker, in display order.
export const SCENARIO_ORDER: CampaignScenario[] = ['product', 'event']

// Resolve a scenario config, falling back to 'product' for an unknown/absent id so
// callers never crash on a stale value.
export function getScenario(id: string | null | undefined): ScenarioConfig {
  return (id && SCENARIOS[id as CampaignScenario]) || productScenario
}
