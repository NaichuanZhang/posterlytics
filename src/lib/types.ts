// Shared types mirroring the InsForge schema.

export type CampaignStatus = 'draft' | 'analyzing' | 'published'

export interface Palette {
  primary: string
  bg: string
  text: string
  accent: string
}

export interface StyleProfile {
  palette: Palette
  fonts: { heading: string; body: string }
  tone: string
  layout_hint?: string
}

export interface PosterCopy {
  hook: string
  what_it_does: string
  features: string[]
  cta: string
}

// Structured product copy produced by `analyze` (headline, story, features) and
// read by `designer` to enrich the poster text. Named PosterContent because
// that's what it feeds — the retired AI landing page (db/17) never comes back.
export interface PosterContent {
  headline: string
  what_it_does: string
  how_it_works: string[]
  why_use_it: string[]
  features: string[]
  cta: string
}

export interface BrandAssets {
  logo_url?: string
  logo_key?: string
  images: Array<{ url: string; key: string }>
  primary_image_url?: string
}

// Every product poster is agentic now: the `designer` function designs a bespoke
// poster_layout and `hero` paints it. The fixed template modes (cozy_scrapbook,
// saas_glassmorphism) were removed; db/19 backfilled old rows to 'designer'.
export type PosterStyle = 'designer'

// Designer mode: an LLM-designed bespoke poster layout (produced by the
// `designer` edge function) that `hero` compiles into the image prompt — instead
// of one of the two hardcoded template prompts. Mirror of `PosterLayout` in
// functions/_shared.ts (Deno bundle can't import across the boundary).
export type LayoutBand = 'top' | 'upper' | 'mid' | 'lower'

export interface PosterLayoutZone {
  band: LayoutBand
  role: string
  content: string
  emphasis?: 'low' | 'med' | 'high'
  align?: 'left' | 'center' | 'right'
}

export interface PosterLayout {
  composition: string
  mood: string
  art_style: string
  palette_roles: { bg: string; surface?: string; text: string; primary: string; accent: string }
  zones: PosterLayoutZone[]
}

// Lifecycle of the AI-designed poster layout (UI hint).
export type DesignStatus = 'generating' | 'ready' | 'failed'

// Programmatic design tokens read from the live site via a real headless browser
// (computed styles, not regex guesses). Produced by the capture-service, then
// normalized by normalizeDesignTokens(). All optional so partial/empty captures
// still type-check. This is the brand-styling source of truth when present.
export interface DesignTokens {
  typography: {
    headingFamily: string
    bodyFamily: string
    scale: number[] // representative font sizes, px, ascending
    weights: number[] // font weights seen, ascending
  }
  colors: {
    bg: string // page background
    text: string // body text
    primary: string // dominant brand / primary-action color
    accent: string // vivid accent
    palette: string[] // ranked distinct colors (hex)
  }
  radii: number[] // representative border-radius scale, px
  shadows: string[] // a few representative box-shadow values
  spacing: number[] // inferred spacing scale, px
  button: {
    bg: string
    color: string
    radius: number
    paddingX: number
    paddingY: number
    weight: number
    shadow?: string
  } | null
  fontLinks: string[] // web-font stylesheet URLs the captured site loads
}

// Vision-detected calm zone for the AI-poster QR, as 0..1 fractions (top-left
// origin) of the hero image. null → AiPoster falls back to the per-style ANCHORS.
export interface QrZone {
  x: number
  y: number
  w: number
  h: number
}

// Product poster_spec: the SPA band only needs the scan caption; the layout
// itself lives in poster_layout (designed by the `designer` agent).
export interface ProductPosterSpec {
  qr_label: string
  urls: string
}

// Which kind of thing a campaign promotes. Mirrors the `scenario` column
// (db/16). 'product' is the original flow; 'event' is a Luma event. No exhaustive
// switch depends on this being closed — future scenarios extend it without a
// migration (the column has no CHECK).
export type CampaignScenario = 'product' | 'event'

// The scraped/entered details for an 'event' scenario campaign (the `event_details`
// JSONB, db/16). NULL for product campaigns. Every field is optional so a partial
// Luma scrape round-trips — e.g. a "Register to See Address" event exposes a city
// but no street. Times are ISO-8601 strings carrying the event's own tz offset
// (e.g. "2026-07-04T18:30:00-07:00"); render the event's LOCAL time, don't convert
// to the viewer's zone.
export interface EventDetails {
  event_name?: string
  starts_at?: string // ISO-8601 with tz offset
  ends_at?: string // ISO-8601 with tz offset
  tz_offset?: string // e.g. "-07:00"
  tz_label?: string // e.g. "PDT" (best-effort; may be absent)
  location_name?: string
  location_address?: string
  location_city?: string
  location_region?: string
  location_country?: string
  attendance_mode?: 'offline' | 'online'
  online_platform?: string
  address_hidden?: boolean // true for "Register to See Address" events
  host_name?: string
  host_url?: string
  host_logo_url?: string
  hosts?: string[]
  price_label?: string // e.g. "Free" / "$20"
  register_url?: string // the luma.com/<slug> RSVP page
  cover_image_url?: string // Flow A (Phase 2) — the 1:1 Luma cover
  cover_image_key?: string
}

// Event promo-poster zones (poster_spec when Campaign.scenario === 'event').
// Logistics lines (date/time/location) are authoritative from EventDetails and
// composited as real text by AiPoster — never AI-painted — so they stay legible
// and accurate.
export interface EventPosterSpec {
  title: string
  date_line: string
  time_line: string
  location_line: string
  host_line: string
  rsvp_label: string // <=4 words, e.g. "Scan to RSVP"
  price_line?: string
  urls: string
}

// poster_spec is one of these, discriminated by Campaign.scenario. Kept as a
// loose union so older rows (which may carry retired template-spec shapes)
// still type-check — readers only touch qr_label / the event logistics lines.
export type PosterSpec = ProductPosterSpec | EventPosterSpec

export interface Campaign {
  id: string
  user_id: string
  product_url: string
  product_name: string
  tagline: string | null
  cta_text: string
  destination_url: string
  style_profile: StyleProfile | null
  poster_copy: PosterCopy | null
  poster_content: PosterContent | null
  brand_assets: BrandAssets | null
  brand_essence: string | null
  poster_style: PosterStyle
  poster_spec: PosterSpec | null
  hero_image_url: string | null
  hero_image_key: string | null
  qr_zone: QrZone | null
  design_tokens: DesignTokens | null
  screenshot_url: string | null
  screenshot_key: string | null
  poster_layout: PosterLayout | null
  design_status: DesignStatus | null
  // Which scenario this campaign promotes (db/16). Defaults to 'product' for every
  // existing row. For 'event', product_url/product_name/destination_url are
  // repurposed (event URL / title / Luma RSVP target) and event_details is set.
  scenario: CampaignScenario
  event_details: EventDetails | null
  status: CampaignStatus
  created_at: string
}

export interface Placement {
  id: string
  campaign_id: string
  user_id: string
  label: string
  code: string
  created_at: string
}

// A recorded failure/degrade event from the generation pipeline (agent_traces
// table, db/15). Written best-effort by the edge functions; owner-read only.
export type AgentTraceStep = 'analyze' | 'designer' | 'hero' | 'capture'
export type AgentTraceStatus = 'failed' | 'degraded'

export interface AgentTrace {
  id: string
  campaign_id: string
  user_id: string
  step: AgentTraceStep
  status: AgentTraceStatus
  detail: string | null
  request: Record<string, unknown> | null
  response: Record<string, unknown> | null
  created_at: string
}

export interface PlacementStat {
  placement_id: string
  label: string
  code: string
  scans: number
  unique_visitors: number
  conversions: number
  conversion_rate: number | null
}

// One row of an audience breakdown (a device type, OS, or country) with its scan count.
export interface BreakdownBucket {
  key: string
  scans: number
}

// Campaign-wide audience breakdowns from the `campaign_breakdowns` RPC.
export interface CampaignBreakdowns {
  devices: BreakdownBucket[]
  os: BreakdownBucket[]
  countries: BreakdownBucket[]
}
