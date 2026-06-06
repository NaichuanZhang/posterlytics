-- Posterlytics schema 03 — scans
-- One row per QR scan / landing view. Written by the public `view` function via
-- the log_scan RPC. Anon is WRITE-ONLY here (no SELECT policy/grant) so scan
-- data can never be read back by the public role. visitor_hash is a salted,
-- day-bucketed digest — we never store a raw IP.

CREATE TABLE IF NOT EXISTS scans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_id UUID NOT NULL REFERENCES placements(id) ON DELETE CASCADE,
  campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device       TEXT,   -- mobile | tablet | desktop | bot | unknown
  os           TEXT,
  country      TEXT,   -- ISO code, or 'unknown'
  city         TEXT,
  visitor_hash TEXT NOT NULL,
  is_unique    BOOLEAN NOT NULL DEFAULT false,
  scanned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE scans ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_scans_placement_id ON scans(placement_id);
CREATE INDEX IF NOT EXISTS idx_scans_campaign_id  ON scans(campaign_id);
CREATE INDEX IF NOT EXISTS idx_scans_scanned_at   ON scans(scanned_at);
CREATE INDEX IF NOT EXISTS idx_scans_user_id      ON scans(user_id);
CREATE INDEX IF NOT EXISTS idx_scans_placement_visitor ON scans(placement_id, visitor_hash);

-- Owner reads their own scans for the dashboard.
CREATE POLICY "owner read scans" ON scans
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Anon may INSERT a scan for a published campaign (belt-and-suspenders; the
-- log_scan DEFINER RPC is the normal write path). No anon SELECT — write-only.
CREATE POLICY "anon insert scans for published" ON scans
  FOR INSERT TO anon
  WITH CHECK (public.campaign_is_published(campaign_id));

GRANT SELECT ON scans TO authenticated;
GRANT INSERT ON scans TO anon;
