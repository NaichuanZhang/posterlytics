// Shared types mirroring the InsForge schema.

export type CampaignStatus = 'draft' | 'analyzing' | 'published'

export type VisualTheme = 'light' | 'dark' | 'mixed'
export type VisualDensity = 'sparse' | 'balanced' | 'dense'

export interface WeightedPaletteColor {
  color: string
  proportion: number
}

export interface Palette {
  primary: string
  bg: string
  text: string
  accent: string
  secondary?: string
  supporting?: string[]
  proportions?: WeightedPaletteColor[]
}

export interface StyleProfile {
  palette: Palette
  fonts: { heading: string; body: string }
  tone: string
  layout_hint?: string
  imagery?: string
  typography_treatment?: string
  lighting?: string
  texture?: string
  motifs?: string[]
  composition?: string
  density?: VisualDensity
}

export interface PosterCopy {
  hook: string
  what_it_does: string
  features: string[]
  cta: string
}

// Structured product copy produced by `analyze` and read by `designer`.
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

export interface ReferenceImage {
  key: string
  url: string
  name: string
  mime_type: string
  size_bytes: number
}

export type PosterGenerationStatus =
  | 'created'
  | 'analyzing'
  | 'designing'
  | 'painting'
  | 'ready'
  | 'failed'

export type PosterGenerationMode = 'iteration' | 'website_refresh'

export type PosterGenerationStage = 'analyze' | 'designer' | 'hero' | 'complete'

export type GenerationTraceStage = 'analyze' | 'designer' | 'hero'

export type GenerationJobStage = GenerationTraceStage

export type GenerationJobStatus =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'succeeded'
  | 'failed'

export type GenerationNotificationOutcome = 'ready' | 'failed'

export interface GenerationJob {
  id: string
  generation_id: string
  campaign_id: string
  user_id: string
  retry_of_job_id: string | null
  status: GenerationJobStatus
  stage: GenerationJobStage
  color_scheme: 'light' | 'dark'
  attempt_count: number
  retry_count: number
  max_attempts: number
  available_at: string
  lease_owner: string | null
  lease_expires_at: string | null
  last_error_code: string | null
  last_error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface GenerationNotification {
  id: string
  job_id: string
  generation_id: string
  campaign_id: string
  user_id: string
  outcome: GenerationNotificationOutcome
  read_at: string | null
  created_at: string
}

export interface GenerationActivityItem {
  job_id: string
  generation_id: string
  campaign_id: string
  campaign_name: string
  status: GenerationJobStatus
  stage: GenerationJobStage
  color_scheme: 'light' | 'dark'
  attempt_count: number
  retry_count: number
  max_attempts: number
  available_at: string
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  last_error_code: string | null
  last_error_message: string | null
  generation_status: PosterGenerationStatus
  version_number: number | null
  generation_mode: PosterGenerationMode
  scenario: CampaignScenario
  instruction: string | null
  hero_image_url: string | null
  generation_created_at: string
  notification_id: string | null
  notification_outcome: GenerationNotificationOutcome | null
  read_at: string | null
  notification_created_at: string | null
}

export interface GenerationActivity {
  items: GenerationActivityItem[]
  unread_count: number
  refreshed_at: string
}

export type GenerationStageTraceStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'

export type TraceImageSource =
  | 'previous-poster'
  | 'style-board'
  | 'user-reference'
  | 'logo'
  | 'product'

export type TraceImageSkipReason =
  | 'missing_url'
  | 'duplicate'
  | 'candidate_limit'
  | 'fetch_failed'
  | 'unsupported_format'
  | 'empty_image'
  | 'image_too_large'
  | 'byte_budget'
  | 'image_limit'

export interface TraceImageAsset {
  source: TraceImageSource
  purpose: string
  url: string | null
  key: string | null
  filename: string | null
  mime_type: string | null
  size_bytes: number | null
  storage_source: string
  candidate_position: number
  model_position: number | null
}

export interface TraceImageSkip {
  asset: TraceImageAsset
  reason: TraceImageSkipReason
  detail: string
}

export interface TraceContentManifestEntry {
  position: number
  role: string
  type: 'text' | 'image'
  text?: string
  image?: TraceImageAsset
}

export interface ModelCallTrace {
  attempt: number
  operation: 'chat' | 'image'
  provider: 'openrouter'
  model_id: string
  status: 'running' | 'succeeded' | 'failed'
  started_at: string
  completed_at: string | null
  prompt: {
    system?: string
    user?: string
    image?: string
  }
  provider_settings: Record<string, unknown>
  content_manifest: TraceContentManifestEntry[]
  failure: {
    code: string
    message: string
    retryable: boolean
    upstream_status?: number
  } | null
}

export interface GenerationTraceArtifact {
  kind: 'style-board' | 'layout' | 'poster' | 'analysis'
  url?: string | null
  key?: string | null
  mime_type?: string | null
  size_bytes?: number | null
  snapshot?: unknown
  metadata?: Record<string, unknown>
}

export interface GenerationStageTrace {
  id: string
  generation_id: string
  campaign_id: string
  user_id: string
  stage: GenerationTraceStage
  status: GenerationStageTraceStatus
  started_at: string | null
  completed_at: string | null
  model_calls: ModelCallTrace[]
  candidate_images: TraceImageAsset[]
  attached_images: TraceImageAsset[]
  skipped_images: TraceImageSkip[]
  artifacts: GenerationTraceArtifact[]
  failure_code: string | null
  failure_message: string | null
  failure_metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

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
  imagery?: string
  typography_treatment?: string
  lighting?: string
  texture?: string
  motifs?: string[]
  density?: VisualDensity
  palette_roles: {
    bg: string
    surface?: string
    text: string
    primary: string
    accent: string
    secondary?: string
    supporting?: string[]
    proportions?: WeightedPaletteColor[]
  }
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
    visualPalette?: WeightedPaletteColor[] // pixel-weighted colors from the style board
    theme?: VisualTheme
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

// Product poster_spec: the SPA band only needs the scan caption; the layout
// itself lives in poster_layout (designed by the `designer` agent).
export interface ProductPosterSpec {
  qr_label: string
  urls: string
}

// New campaigns are products. `event` remains for historical rows.
export type CampaignScenario = 'product' | 'event'

// Scraped details for a historical event campaign. Null for product campaigns.
// Every field is optional so a partial
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
  poster_spec: PosterSpec | null
  hero_image_url: string | null
  hero_image_key: string | null
  design_tokens: DesignTokens | null
  screenshot_url: string | null
  screenshot_key: string | null
  poster_layout: PosterLayout | null
  design_status: DesignStatus | null
  reference_context: string | null
  reference_images: ReferenceImage[]
  // New rows use product. For historical events, product_url/product_name/destination_url are
  // repurposed (event URL / title / Luma RSVP target) and event_details is set.
  scenario: CampaignScenario
  event_details: EventDetails | null
  current_generation_id: string | null
  status: CampaignStatus
  created_at: string
}

export interface PosterGeneration {
  id: string
  campaign_id: string
  user_id: string
  parent_generation_id: string | null
  version_number: number | null
  status: PosterGenerationStatus
  generation_mode: PosterGenerationMode
  instruction: string | null
  reference_images: ReferenceImage[]
  scenario: CampaignScenario
  event_details: EventDetails | null
  style_profile: StyleProfile | null
  poster_copy: PosterCopy | null
  poster_content: PosterContent | null
  brand_assets: BrandAssets | null
  brand_essence: string | null
  poster_spec: PosterSpec | null
  design_tokens: DesignTokens | null
  screenshot_url: string | null
  screenshot_key: string | null
  poster_layout: PosterLayout | null
  design_status: DesignStatus | null
  hero_image_url: string | null
  hero_image_key: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  failed_at: string | null
  failure_stage: PosterGenerationStage | null
  failure_code: string | null
  failure_message: string | null
  trace_schema_version: number | null
  trace_incomplete: boolean
}

export interface Placement {
  id: string
  campaign_id: string
  user_id: string
  label: string
  code: string
  created_at: string
}

export interface PlacementStat {
  placement_id: string
  label: string
  code: string
  visits: number
  unique_visitors: number
}

// One row of an audience breakdown (a device type, OS, or country).
export interface BreakdownBucket {
  key: string
  visits: number
}

// Campaign-wide audience breakdowns from the `campaign_breakdowns` RPC.
export interface CampaignBreakdowns {
  devices: BreakdownBucket[]
  os: BreakdownBucket[]
  countries: BreakdownBucket[]
}
