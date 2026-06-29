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

export interface LandingContent {
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

export type PosterStyle = 'cozy_scrapbook' | 'saas_glassmorphism' | 'designer'

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

// Lifecycle of the AI-designed poster layout (UI hint), same shape as LandingStatus.
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
  fontLinks: string[] // web-font stylesheet URLs to <link> in the landing
}

// Lifecycle of the AI-generated landing page (UI hint).
export type LandingStatus = 'generating' | 'ready' | 'failed'

// Vision-detected calm zone for the AI-poster QR, as 0..1 fractions (top-left
// origin) of the hero image. null → AiPoster falls back to the per-style ANCHORS.
export interface QrZone {
  x: number
  y: number
  w: number
  h: number
}

export interface StatNode {
  icon: string
  label: string
  stars: number
}

export interface QuestCard {
  icon: string
  title: string
  desc: string
}

// Cozy-scrapbook gamified poster (9:16-cropped) zones.
export interface CozyPosterSpec {
  hook_line1: string
  hook_line2: string
  subtitle: string
  level_badge: string
  xp: string
  mascot: string
  stat_nodes: StatNode[]
  quest_cards: QuestCard[]
  conv_left: { heading: string; lines: string[] }
  conv_right: { heading: string; steps: string[] }
  qr_label: string
  footer_formula: string
  urls: string
}

export interface SaasCard {
  icon: string
  title: string
  desc: string
}

// Premium SaaS / glassmorphism product-launch poster (2:3) zones.
export interface SaasPosterSpec {
  headline: string
  sub_name: string
  slogan: string
  product_intro: string
  device_context: string
  hero_metric: string
  float_cards: SaasCard[]
  feature_matrix: SaasCard[]
  reasons: SaasCard[]
  cta_main: string
  cta_sub: string
  qr_label: string
  footer_slogan: string
  urls: string
}

// poster_spec is one of these, discriminated by Campaign.poster_style. Kept as a
// loose union (both shapes are optional-friendly) so older rows still type-check.
export type PosterSpec = CozyPosterSpec | SaasPosterSpec

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
  landing_content: LandingContent | null
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
  landing_html: string | null
  landing_status: LandingStatus | null
  poster_layout: PosterLayout | null
  design_status: DesignStatus | null
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
