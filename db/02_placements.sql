-- Posterlytics schema 02 — placements
-- A placement is one promotion channel ("Bulletin board", "LinkedIn", ...).
-- Each owns a UNIQUE short code that becomes its QR/link. The code is the hot
-- lookup path for the public view/convert functions.

CREATE TABLE IF NOT EXISTS placements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,  -- denormalized owner
  label       TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE placements ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_placements_code ON placements(code);
CREATE INDEX IF NOT EXISTS idx_placements_campaign_id ON placements(campaign_id);
CREATE INDEX IF NOT EXISTS idx_placements_user_id ON placements(user_id);

CREATE POLICY "owner all placements" ON placements
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Anon may read a placement by code only if its campaign is published, so the
-- public landing render can resolve code -> campaign content.
CREATE POLICY "anon read placements of published" ON placements
  FOR SELECT TO anon
  USING (public.campaign_is_published(campaign_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON placements TO authenticated;
GRANT SELECT ON placements TO anon;
