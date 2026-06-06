-- Posterlytics schema 06 — RPC revision (cookie-based visitor identity + browser geo beacon)
-- The functions edge strips the client IP on direct hits, so geo/visitor identity
-- moved to a first-party cookie (visitor_hash) + a browser geo beacon. log_scan
-- now returns { scan_id, is_unique } so the landing can later attach geo via
-- set_scan_geo. Old 6-arg log_scan is dropped.

DROP FUNCTION IF EXISTS public.log_scan(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

-- log_scan: published-check, compute is_unique, insert; returns the new scan id
-- and whether this visitor was new for the placement.
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
  v_is_unique BOOLEAN;
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

  SELECT NOT EXISTS (
    SELECT 1 FROM scans WHERE placement_id = v_placement.id AND visitor_hash = p_visitor_hash
  ) INTO v_is_unique;

  INSERT INTO scans (placement_id, campaign_id, user_id, device, os, visitor_hash, is_unique)
  VALUES (v_placement.id, v_placement.campaign_id, v_placement.user_id,
          p_device, p_os, p_visitor_hash, v_is_unique)
  RETURNING id INTO v_scan_id;

  RETURN jsonb_build_object('scan_id', v_scan_id, 'is_unique', v_is_unique);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- set_scan_geo: browser geo beacon fills country/city for a just-created scan.
-- Only writes when geo is still null (idempotent, prevents overwrite/abuse).
CREATE OR REPLACE FUNCTION public.set_scan_geo(
  p_scan_id UUID,
  p_country TEXT,
  p_city TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE scans
  SET country = p_country, city = p_city
  WHERE id = p_scan_id AND country IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.log_scan(TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.set_scan_geo(UUID, TEXT, TEXT) TO anon;
