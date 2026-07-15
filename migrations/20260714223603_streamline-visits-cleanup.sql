-- Replace the old conversion-shaped analytics contract before dropping its
-- backing table.
DROP FUNCTION IF EXISTS public.placement_stats(UUID);

CREATE FUNCTION public.placement_stats(p_campaign_id UUID)
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
  LEFT JOIN public.scans s ON s.placement_id = pl.id
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
  WITH owned AS (
    SELECT
      COALESCE(NULLIF(s.device, ''), 'Unknown') AS device,
      COALESCE(NULLIF(s.os, ''), 'Unknown') AS os,
      COALESCE(NULLIF(s.country, ''), 'Unknown') AS country
    FROM public.scans s
    WHERE s.campaign_id = p_campaign_id
      AND s.user_id = (SELECT auth.uid())
  ),
  devices AS (
    SELECT jsonb_agg(
      jsonb_build_object('key', device, 'visits', count)
      ORDER BY count DESC, device
    ) AS items
    FROM (SELECT device, COUNT(*) AS count FROM owned GROUP BY device) rows
  ),
  operating_systems AS (
    SELECT jsonb_agg(
      jsonb_build_object('key', os, 'visits', count)
      ORDER BY count DESC, os
    ) AS items
    FROM (SELECT os, COUNT(*) AS count FROM owned GROUP BY os) rows
  ),
  countries AS (
    SELECT jsonb_agg(
      jsonb_build_object('key', country, 'visits', count)
      ORDER BY count DESC, country
    ) AS items
    FROM (SELECT country, COUNT(*) AS count FROM owned GROUP BY country) rows
  )
  SELECT jsonb_build_object(
    'devices', COALESCE((SELECT items FROM devices), '[]'::jsonb),
    'os', COALESCE((SELECT items FROM operating_systems), '[]'::jsonb),
    'countries', COALESCE((SELECT items FROM countries), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.campaign_breakdowns(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campaign_breakdowns(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.link_status(p_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_campaign_status TEXT;
BEGIN
  SELECT c.status
  INTO v_campaign_status
  FROM public.placements p
  JOIN public.campaigns c ON c.id = p.campaign_id
  WHERE p.code = p_code;

  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;

  IF v_campaign_status = 'published' THEN
    RETURN 'published';
  END IF;

  RETURN 'unpublished';
END;
$$;

REVOKE ALL ON FUNCTION public.link_status(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_status(TEXT) TO anon;

-- Remove the superseded public/table surfaces before removing their helper.
DROP POLICY IF EXISTS "anon read published campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "anon read placements of published" ON public.placements;
DROP POLICY IF EXISTS "anon insert scans for published" ON public.scans;
DROP POLICY IF EXISTS "anon insert conversions for published" ON public.conversions;

REVOKE ALL ON public.campaigns FROM anon;
REVOKE ALL ON public.placements FROM anon;
REVOKE ALL ON public.scans FROM anon;
REVOKE ALL ON public.scans FROM authenticated;
GRANT SELECT ON public.scans TO authenticated;

DROP FUNCTION IF EXISTS public.log_scan(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.log_scan(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.log_conversion(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.set_scan_geo(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.campaign_is_published(UUID);

DROP TABLE IF EXISTS public.conversions;
DROP TABLE IF EXISTS public.agent_traces;

ALTER TABLE public.campaigns
  DROP COLUMN IF EXISTS qr_zone,
  DROP COLUMN IF EXISTS poster_style;
