-- Posterlytics schema 05 — RPCs (SECURITY DEFINER)
-- These three functions are the controlled bridge across the RLS boundary:
--   * log_scan / log_conversion: let the anon `view`/`convert` functions do the
--     published-check + read-existing + insert that plain anon RLS forbids,
--     without granting anon any SELECT on scans/conversions.
--   * placement_stats: owner-only aggregation in a single round-trip.

-- log_scan: published-check, compute is_unique (needs a read anon can't do),
-- insert the scan. Returns is_unique (NULL if code missing/unpublished).
CREATE OR REPLACE FUNCTION public.log_scan(
  p_code TEXT,
  p_device TEXT,
  p_os TEXT,
  p_country TEXT,
  p_city TEXT,
  p_visitor_hash TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_placement placements%ROWTYPE;
  v_published BOOLEAN;
  v_is_unique BOOLEAN;
BEGIN
  SELECT * INTO v_placement FROM placements WHERE code = p_code;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT (status = 'published') INTO v_published FROM campaigns WHERE id = v_placement.campaign_id;
  IF v_published IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM scans WHERE placement_id = v_placement.id AND visitor_hash = p_visitor_hash
  ) INTO v_is_unique;

  INSERT INTO scans (placement_id, campaign_id, user_id, device, os, country, city, visitor_hash, is_unique)
  VALUES (v_placement.id, v_placement.campaign_id, v_placement.user_id,
          p_device, p_os, p_country, p_city, p_visitor_hash, v_is_unique);

  RETURN v_is_unique;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- log_conversion: published-check, insert the conversion, return the real
-- destination URL for the 302. Returns NULL if code missing/unpublished.
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

  INSERT INTO conversions (placement_id, campaign_id, user_id, visitor_hash)
  VALUES (v_placement.id, v_placement.campaign_id, v_placement.user_id, p_visitor_hash);

  RETURN v_campaign.destination_url;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- placement_stats: per-placement scans / unique visitors / conversions / rate
-- for one campaign. Ownership is re-enforced INSIDE the definer function so a
-- user can never aggregate another user's data.
CREATE OR REPLACE FUNCTION public.placement_stats(p_campaign_id UUID)
RETURNS TABLE (
  placement_id UUID,
  label TEXT,
  code TEXT,
  scans BIGINT,
  unique_visitors BIGINT,
  conversions BIGINT,
  conversion_rate NUMERIC
) AS $$
  SELECT
    pl.id,
    pl.label,
    pl.code,
    COUNT(DISTINCT s.id)           AS scans,
    COUNT(DISTINCT s.visitor_hash) AS unique_visitors,
    COUNT(DISTINCT c.id)           AS conversions,
    ROUND(
      COUNT(DISTINCT c.id)::numeric
      / NULLIF(COUNT(DISTINCT s.visitor_hash), 0) * 100, 1
    ) AS conversion_rate
  FROM placements pl
  LEFT JOIN scans s       ON s.placement_id = pl.id
  LEFT JOIN conversions c ON c.placement_id = pl.id
  WHERE pl.campaign_id = p_campaign_id
    AND pl.user_id = (SELECT auth.uid())
  GROUP BY pl.id, pl.label, pl.code
  ORDER BY scans DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.log_scan(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.log_conversion(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.placement_stats(UUID) TO authenticated;
