// Shared types mirroring the InsForge schema.

export type CampaignStatus = 'draft' | 'analyzing' | 'ready' | 'published'

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
