-- Return all redirect attribution data from the same RPC that records the scan.
-- Keep log_visit's text response as a compatibility wrapper for staggered
-- function/database deploys.
CREATE FUNCTION public.log_visit_attributed(
  p_code TEXT,
  p_device TEXT,
  p_os TEXT,
  p_visitor_hash TEXT,
  p_country TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_placement public.placements%ROWTYPE;
  v_campaign public.campaigns%ROWTYPE;
BEGIN
  SELECT * INTO v_placement
  FROM public.placements
  WHERE code = p_code;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_campaign
  FROM public.campaigns
  WHERE id = v_placement.campaign_id;

  IF v_campaign.status <> 'published' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.scans (
    placement_id,
    campaign_id,
    user_id,
    device,
    os,
    country,
    city,
    visitor_hash
  )
  VALUES (
    v_placement.id,
    v_placement.campaign_id,
    v_placement.user_id,
    p_device,
    p_os,
    CASE
      WHEN BTRIM(p_country) ~ '^[A-Za-z]{2}$' THEN UPPER(BTRIM(p_country))
      ELSE NULL
    END,
    LEFT(NULLIF(BTRIM(p_city), ''), 120),
    p_visitor_hash
  );

  RETURN jsonb_build_object(
    'destination_url', v_campaign.destination_url,
    'campaign_name', v_campaign.product_name,
    'placement_code', v_placement.code
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.log_visit(
  p_code TEXT,
  p_device TEXT,
  p_os TEXT,
  p_visitor_hash TEXT,
  p_country TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.log_visit_attributed(
    p_code,
    p_device,
    p_os,
    p_visitor_hash,
    p_country,
    p_city
  ) ->> 'destination_url';
$$;

REVOKE ALL ON FUNCTION public.log_visit_attributed(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_visit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.log_visit_attributed(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO anon;
GRANT EXECUTE ON FUNCTION public.log_visit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO anon;
