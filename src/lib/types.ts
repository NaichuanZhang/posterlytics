// Shared types mirroring the InsForge schema.

export type CampaignStatus = 'draft' | 'analyzing' | 'ready' | 'published'

// How the poster is rendered: deterministic HTML/CSS template, or an AI-generated
// image (hero_image_url) with the real QR overlaid. Chosen by the user at creation.
export type PosterMode = 'template' | 'image'

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
  theme_color?: string
}

export type PosterStyle = 'cozy_scrapbook' | 'saas_glassmorphism'

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
  poster_mode: PosterMode
  poster_spec: PosterSpec | null
  hero_image_url: string | null
  hero_image_key: string | null
  status: CampaignStatus
  created_at: string
  updated_at: string
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

// Response from the `agent` edge function (Campaign Optimizer).
export interface AgentProposal {
  rationale: string
  poster_copy: PosterCopy
  landing_content: LandingContent
}

export interface AgentResult {
  summary: string
  proposal: AgentProposal | null
  toolCalls: string[]
  steps: number
}
