-- Posterlytics schema 04 — conversions
-- One row per CTA click on the hosted landing (logged by the public `convert`
-- function via log_conversion before the 302 to the real product page). Anon is
-- write-only, same contract as scans.

CREATE TABLE IF NOT EXISTS conversions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_id UUID NOT NULL REFERENCES placements(id) ON DELETE CASCADE,
  campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  visitor_hash TEXT,
  converted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE conversions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_conversions_placement_id ON conversions(placement_id);
CREATE INDEX IF NOT EXISTS idx_conversions_campaign_id  ON conversions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_conversions_user_id      ON conversions(user_id);

CREATE POLICY "owner read conversions" ON conversions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "anon insert conversions for published" ON conversions
  FOR INSERT TO anon
  WITH CHECK (public.campaign_is_published(campaign_id));

GRANT SELECT ON conversions TO authenticated;
GRANT INSERT ON conversions TO anon;
