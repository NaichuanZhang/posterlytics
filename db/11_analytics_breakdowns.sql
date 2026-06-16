-- Posterlytics schema 11 — analytics breakdowns + append-only cleanup
-- Adds campaign_breakdowns (owner-only geo + device/OS aggregation, one row per
-- dimension value across the whole campaign), and completes the cleanup of
-- write-only/unused columns: scans.is_unique, conversions.visitor_hash, and the
-- never-read campaigns.updated_at (+ its trigger).
--
-- ORDER MATTERS: log_scan / log_conversion are redefined FIRST so no live
-- function body references a column we then DROP (the InsForge CLI applies the
-- file statement-by-statement; a dropped column would break every scan/convert).

-- ── 1. Redefine writers BEFORE dropping the columns they write ───────────────

-- log_scan: same 4-arg signature + JSONB return (view.ts depends on scan_id).
-- Stops computing/inserting is_unique. Still returns scan_id for the geo beacon.
CREATE OR REPLACE FUNCTION public.log_scan(
  p_code TEXT,
  p_device TEXT,
  p_os TEXT,
  p_visitor_hash TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_placement placements%ROWTYPE;
  v_published BOOLEAN;
  v_scan_id UUID;
BEGIN
  SELECT * INTO v_placement FROM placements WHERE code = p_code;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT (status = 'published') INTO v_published FROM campaigns WHERE id = v_placement.campaign_id;
  IF v_published IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  INSERT INTO scans (placement_id, campaign_id, user_id, device, os, visitor_hash)
  VALUES (v_placement.id, v_placement.campaign_id, v_placement.user_id,
          p_device, p_os, p_visitor_hash)
  RETURNING id INTO v_scan_id;

  RETURN jsonb_build_object('scan_id', v_scan_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- log_conversion: same 2-arg signature + TEXT return (convert.ts + the anon
-- GRANT depend on it). p_visitor_hash retained for signature stability but no
-- longer stored.
CREATE OR REPLACE FUNCTION public.log_conversion(
  p_code TEXT,
  p_visitor_hash TEXT
)
RETURNS TEXT AS $$
DECLARE
  v_placement placements%ROWTYPE;
  v_campaign campaigns%ROWTYPE;
BEGIN
  SELECT * INTO v_placement FROM placements WHERE code = p_code;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_campaign FROM campaigns WHERE id = v_placement.campaign_id;
  IF v_campaign.status <> 'published' THEN
    RETURN NULL;
  END IF;

  INSERT INTO conversions (placement_id, campaign_id, user_id)
  VALUES (v_placement.id, v_placement.campaign_id, v_placement.user_id);

  RETURN v_campaign.destination_url;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 2. New owner-only breakdown RPC ──────────────────────────────────────────
-- Geo + device/OS aggregation for one campaign. Ownership is re-enforced INSIDE
-- the definer function: scans.user_id is denormalized, so the
-- user_id = auth.uid() predicate both scopes to the caller AND blocks
-- aggregating another user's data even if a foreign campaign id is passed.
-- NULL/empty dimensions collapse to 'Unknown' (country is frequently NULL when
-- the browser geo beacon never fires).
CREATE OR REPLACE FUNCTION public.campaign_breakdowns(p_campaign_id UUID)
RETURNS JSONB AS $$
  WITH owned AS (
    SELECT
      COALESCE(NULLIF(s.device, ''), 'Unknown')  AS device,
      COALESCE(NULLIF(s.os, ''), 'Unknown')      AS os,
      COALESCE(NULLIF(s.country, ''), 'Unknown') AS country
    FROM scans s
    WHERE s.campaign_id = p_campaign_id
      AND s.user_id = (SELECT auth.uid())
  ),
  dev AS (
    SELECT jsonb_agg(jsonb_build_object('key', device, 'scans', n) ORDER BY n DESC, device) AS arr
    FROM (SELECT device, COUNT(*) AS n FROM owned GROUP BY device) d
  ),
  oss AS (
    SELECT jsonb_agg(jsonb_build_object('key', os, 'scans', n) ORDER BY n DESC, os) AS arr
    FROM (SELECT os, COUNT(*) AS n FROM owned GROUP BY os) o
  ),
  ctry AS (
    SELECT jsonb_agg(jsonb_build_object('key', country, 'scans', n) ORDER BY n DESC, country) AS arr
    FROM (SELECT country, COUNT(*) AS n FROM owned GROUP BY country) c
  )
  SELECT jsonb_build_object(
    'devices',   COALESCE((SELECT arr FROM dev),  '[]'::jsonb),
    'os',        COALESCE((SELECT arr FROM oss),  '[]'::jsonb),
    'countries', COALESCE((SELECT arr FROM ctry), '[]'::jsonb)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.campaign_breakdowns(UUID) TO authenticated;

-- ── 3. Cleanup: drop now-unused columns (writers already redefined above) ─────
ALTER TABLE scans DROP COLUMN IF EXISTS is_unique;
ALTER TABLE conversions DROP COLUMN IF EXISTS visitor_hash;

-- ── 4. Cleanup: campaigns.updated_at was never read by the app. Drop the
--      trigger FIRST, then the column. Do NOT drop system.update_updated_at —
--      it lives in the shared `system` schema (InsForge built-in). ────────────
DROP TRIGGER IF EXISTS campaigns_updated_at ON campaigns;
ALTER TABLE campaigns DROP COLUMN IF EXISTS updated_at;
