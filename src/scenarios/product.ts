import type { ScenarioConfig } from './registry'

// The original 'product' scenario: a product with a website. This encodes the
// campaign wizard's fields EXACTLY as they are today (see CampaignWizardPage), so
// once the wizard reads from this config (Phase 1) the product flow is unchanged.
//
// `key` is the campaigns column each field writes. `source` marks how a field is
// populated: 'input' = the user types it. (The event scenario adds 'scrape'.)
export const productScenario: ScenarioConfig = {
  id: 'product',
  label: 'Product',
  hint: 'Promote a product from its website',
  urlKey: 'product_url',
  fields: [
    {
      key: 'product_url',
      label: 'Product website URL',
      type: 'url',
      required: true,
      source: 'input',
      placeholder: 'https://yourproduct.com',
      hint: 'We scrape this for your brand style, logo, imagery, and product story.',
    },
    {
      key: 'product_name',
      label: 'Product name',
      type: 'text',
      required: true,
      source: 'input',
      placeholder: 'Acme Analytics',
    },
    {
      key: 'tagline',
      label: 'Tagline',
      type: 'text',
      required: false,
      source: 'input',
      placeholder: 'The fastest way to ship dashboards',
    },
    {
      key: 'cta_text',
      label: 'Call to action',
      type: 'text',
      required: true,
      source: 'input',
      placeholder: 'Start free trial',
    },
    {
      key: 'destination_url',
      label: 'Destination URL',
      type: 'url',
      required: true,
      source: 'input',
      placeholder: 'https://yourproduct.com/signup',
      hint: 'Where the QR ultimately sends people (after we log the conversion).',
    },
  ],
  // Editor spec-card rows come from poster_spec/poster_copy for products; no
  // scenario-specific rows are needed (the existing isSaas/isDesigner branches
  // in PosterEditorPage keep handling those), so this stays empty.
  specRows: [],
  // The dashboard's conversion metric label for this scenario.
  conversionLabel: 'Conversions',
}
