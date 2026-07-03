-- Posterlytics schema 17 — pure tracked redirect (deprecate landing-page generation)
-- The QR no longer resolves to a hosted landing page. `view` now logs a scan AND
-- a conversion in one atomic step, then 302s straight to the product URL — a scan
-- IS the conversion. This retires the /convert hop and the browser geo beacon.
--
-- ORDER MATTERS: add the new writer FIRST, then revoke/drop the superseded ones,
-- then drop the landing columns (the InsForge CLI applies statement-by-statement).

-- ── 1. log_visit: the single anon writer behind the new `view` ───────────────
-- Published-check, insert the scan AND the conversion, return the destination URL
-- for the 302. Returns NULL if the code is missing or the campaign isn't
-- published (view distinguishes those via link_status). Mirrors the definer-RPC
-- shape from db/11; no geo/visitor columns are written (both were already dropped).
CREATE OR REPLACE FUNCTION public.log_visit(
  p_code TEXT,
  p_device TEXT,
  p_os TEXT,
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

  INSERT INTO scans (placement_id, campaign_id, user_id, device, os, visitor_hash)
  VALUES (v_placement.id, v_placement.campaign_id, v_placement.user_id,
          p_device, p_os, p_visitor_hash);

  INSERT INTO conversions (placement_id, campaign_id, user_id)
  VALUES (v_placement.id, v_placement.campaign_id, v_placement.user_id);

  RETURN v_campaign.destination_url;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.log_visit(TEXT, TEXT, TEXT, TEXT) TO anon;

-- ── 2. Retire the superseded anon RPCs ───────────────────────────────────────
-- log_scan / log_conversion are replaced by the atomic log_visit; the /convert
-- and /scan-geo functions are gone. Revoke EXECUTE (keep the bodies for history)
-- and drop set_scan_geo outright (nothing calls it anymore).
-- Revoke from BOTH the explicit anon grant AND PUBLIC: `CREATE FUNCTION` grants
-- EXECUTE to PUBLIC by default, which anon inherits, so revoking only `FROM anon`
-- would leave anon able to call these directly and forge scan/conversion rows.
REVOKE EXECUTE ON FUNCTION public.log_scan(TEXT, TEXT, TEXT, TEXT) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_conversion(TEXT, TEXT) FROM anon, PUBLIC;
DROP FUNCTION IF EXISTS public.set_scan_geo(UUID, TEXT, TEXT);

-- ── 3. Drop the landing-page columns (generation feature removed) ────────────
-- landing_content is intentionally KEPT — designer.ts still reads it for poster
-- copy. Only the generated hosted-page columns go.
ALTER TABLE campaigns DROP COLUMN IF EXISTS landing_html;
ALTER TABLE campaigns DROP COLUMN IF EXISTS landing_status;
