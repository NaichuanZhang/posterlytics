-- Posterlytics schema 01 — campaigns
-- A campaign is one product GTM push: the product site we scrape, the GTM
-- inputs, the agent-generated content (poster + landing), real brand assets,
-- and an optional AI hero fallback image. Owner-only for the dashboard; anon
-- may read ONLY published campaigns (the public landing render path).

CREATE TABLE IF NOT EXISTS campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- GTM inputs
  product_url     TEXT NOT NULL,
  product_name    TEXT NOT NULL,
  tagline         TEXT,
  cta_text        TEXT NOT NULL DEFAULT 'Learn more',
  destination_url TEXT NOT NULL,
  -- agent-generated content (small structured JSON; image bytes live in Storage)
  style_profile   JSONB,   -- { palette:{primary,bg,text,accent}, fonts:{heading,body}, tone, layout_hint }
  poster_copy     JSONB,   -- { hook, what_it_does, features:[3], cta }  (scannable poster)
  landing_content JSONB,   -- { headline, what_it_does, how_it_works:[], why_use_it:[], features:[], cta }
  brand_assets    JSONB,   -- { logo_url, logo_key, images:[{url,key}], primary_image_url }
  hero_image_url  TEXT,    -- AI hero fallback (public Storage URL) — only when no real imagery
  hero_image_key  TEXT,
  status          TEXT NOT NULL DEFAULT 'draft',  -- draft | analyzing | ready | published
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);

-- SECURITY DEFINER helper: "is this campaign published?" — called from the RLS
-- policies on placements/scans/conversions. DEFINER so it bypasses RLS on
-- campaigns and cannot create an RLS-on-RLS recursion chain.
CREATE OR REPLACE FUNCTION public.campaign_is_published(cid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM campaigns WHERE id = cid AND status = 'published');
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Owner does everything from the authenticated dashboard.
CREATE POLICY "owner all campaigns" ON campaigns
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Anon (the public view/convert functions) may read only published campaigns.
-- Column exposure is further limited by each function's .select(...).
CREATE POLICY "anon read published campaigns" ON campaigns
  FOR SELECT TO anon
  USING (status = 'published');

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns TO authenticated;
GRANT SELECT ON campaigns TO anon;

CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON campaigns FOR EACH ROW
  EXECUTE FUNCTION system.update_updated_at();
