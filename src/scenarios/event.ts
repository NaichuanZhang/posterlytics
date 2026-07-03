import type { ScenarioConfig } from './registry'

// The 'event' scenario: a Luma event. The wizard collects just the Luma URL + a
// name; analyze scrapes the event's schema.org/Event JSON-LD to fill event_details
// (date/time/location/host), so those are 'scrape'-sourced with manual-entry
// fallbacks that surface when the scrape is incomplete (e.g. "Register to See
// Address" events). product_url/product_name/destination_url are repurposed for
// events (event URL / title / Luma RSVP target); event_details.event_name is the
// canonical title.
export const eventScenario: ScenarioConfig = {
  id: 'event',
  label: 'Luma event',
  hint: 'Promote a Luma event with a tracked QR',
  urlKey: 'product_url',
  fields: [
    {
      key: 'product_url',
      label: 'Luma event URL',
      type: 'url',
      required: true,
      source: 'input',
      placeholder: 'https://luma.com/your-event',
      hint: 'We read the event’s date, time, location, and host from its Luma page.',
    },
    {
      key: 'product_name',
      label: 'Event name',
      type: 'text',
      required: true,
      source: 'scrape',
      placeholder: 'Founders & Funders Mixer',
      hint: 'Auto-filled from the Luma page — edit if needed.',
    },
    // Date/time/location/host are auto-filled from the Luma scrape; these manual
    // fields are the fallback for incomplete scrapes and are editable pre-generate.
    {
      key: 'event_starts_at',
      label: 'Date & time',
      type: 'datetime',
      required: false,
      source: 'scrape',
      hint: 'Shown in the event’s local time.',
    },
    {
      key: 'event_location',
      label: 'Location',
      type: 'text',
      required: false,
      source: 'scrape',
      placeholder: 'Venue name · City (or “Online”)',
    },
    {
      key: 'event_host',
      label: 'Host',
      type: 'text',
      required: false,
      source: 'scrape',
      placeholder: 'Hosted by …',
    },
    {
      key: 'cta_text',
      label: 'Call to action',
      type: 'text',
      required: true,
      source: 'input',
      placeholder: 'Scan to RSVP',
    },
  ],
  // Editor spec-card rows for an event campaign, read from event_details.
  specRows: [
    { label: 'Date', key: 'starts_at' },
    { label: 'Time', key: 'starts_at' },
    { label: 'Location', key: 'location_name' },
    { label: 'Host', key: 'host_name' },
    { label: 'RSVP', key: 'register_url' },
  ],
  // For events a "conversion" is a tracked click-through to the Luma RSVP page.
  conversionLabel: 'RSVP clicks',
}
