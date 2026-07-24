CREATE OR REPLACE FUNCTION public.campaign_breakdowns(p_campaign_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH owned_scans AS (
    SELECT s.device, s.os, s.country, s.visitor_hash
    FROM public.scans s
    WHERE s.campaign_id = p_campaign_id
      AND s.user_id = (SELECT auth.uid())
  ),
  filtered AS (
    SELECT
      COALESCE(NULLIF(device, ''), 'Unknown') AS device,
      COALESCE(NULLIF(os, ''), 'Unknown') AS os,
      COALESCE(NULLIF(country, ''), 'Unknown') AS country,
      visitor_hash
    FROM owned_scans
    WHERE device IS DISTINCT FROM 'bot'
  ),
  totals AS (
    SELECT
      COUNT(*) AS visits,
      COUNT(DISTINCT visitor_hash) AS unique_visitors
    FROM filtered
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
    'visits', (SELECT visits FROM totals),
    'unique_visitors', (SELECT unique_visitors FROM totals),
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
