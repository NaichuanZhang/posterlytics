-- Replace the four-argument function with defaulted trailing geo arguments.
-- Existing callers can omit both fields while the new view function rolls out.
DROP FUNCTION IF EXISTS public.log_visit(TEXT, TEXT, TEXT, TEXT);

CREATE FUNCTION public.log_visit(
  p_code TEXT,
  p_device TEXT,
  p_os TEXT,
  p_visitor_hash TEXT,
  p_country TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL
)
RETURNS TEXT
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

  RETURN v_campaign.destination_url;
END;
$$;

REVOKE ALL ON FUNCTION public.log_visit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_visit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;

CREATE OR REPLACE FUNCTION public.placement_stats(p_campaign_id UUID)
RETURNS TABLE (
  placement_id UUID,
  label TEXT,
  code TEXT,
  visits BIGINT,
  unique_visitors BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT
    pl.id,
    pl.label,
    pl.code,
    COUNT(s.id) AS visits,
    COUNT(DISTINCT s.visitor_hash) AS unique_visitors
  FROM public.placements pl
  LEFT JOIN public.scans s
    ON s.placement_id = pl.id
    AND s.device IS DISTINCT FROM 'bot'
  WHERE pl.campaign_id = p_campaign_id
    AND pl.user_id = (SELECT auth.uid())
  GROUP BY pl.id, pl.label, pl.code, pl.created_at
  ORDER BY visits DESC, pl.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.placement_stats(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.placement_stats(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.campaign_breakdowns(p_campaign_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH owned_scans AS (
    SELECT s.device, s.os, s.country
    FROM public.scans s
    WHERE s.campaign_id = p_campaign_id
      AND s.user_id = (SELECT auth.uid())
  ),
  filtered AS (
    SELECT
      COALESCE(NULLIF(device, ''), 'Unknown') AS device,
      COALESCE(NULLIF(os, ''), 'Unknown') AS os,
      COALESCE(NULLIF(country, ''), 'Unknown') AS country
    FROM owned_scans
    WHERE device IS DISTINCT FROM 'bot'
  ),
  devices AS (
    SELECT jsonb_agg(
      jsonb_build_object('key', device, 'visits', visit_count)
      ORDER BY visit_count DESC, device
    ) AS items
    FROM (
      SELECT device, COUNT(*) AS visit_count
      FROM filtered
      GROUP BY device
    ) rows
  ),
  operating_systems AS (
    SELECT jsonb_agg(
      jsonb_build_object('key', os, 'visits', visit_count)
      ORDER BY visit_count DESC, os
    ) AS items
    FROM (
      SELECT os, COUNT(*) AS visit_count
      FROM filtered
      GROUP BY os
    ) rows
  ),
  countries AS (
    SELECT jsonb_agg(
      jsonb_build_object('key', country, 'visits', visit_count)
      ORDER BY visit_count DESC, country
    ) AS items
    FROM (
      SELECT country, COUNT(*) AS visit_count
      FROM filtered
      GROUP BY country
    ) rows
  )
  SELECT jsonb_build_object(
    'devices', COALESCE((SELECT items FROM devices), '[]'::jsonb),
    'os', COALESCE((SELECT items FROM operating_systems), '[]'::jsonb),
    'countries', COALESCE((SELECT items FROM countries), '[]'::jsonb),
    'bots_filtered', (
      SELECT COUNT(*)
      FROM owned_scans
      WHERE device = 'bot'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.campaign_breakdowns(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campaign_breakdowns(UUID) TO authenticated;
