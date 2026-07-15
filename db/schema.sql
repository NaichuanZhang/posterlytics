-- Posterlytics fresh-project baseline.
-- Do not apply this file to an existing backend. Existing projects advance
-- through the timestamped files in migrations/.

CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_url TEXT NOT NULL,
  product_name TEXT NOT NULL,
  tagline TEXT,
  cta_text TEXT NOT NULL DEFAULT 'Learn more',
  destination_url TEXT NOT NULL,
  style_profile JSONB,
  poster_copy JSONB,
  poster_content JSONB,
  brand_assets JSONB,
  hero_image_url TEXT,
  hero_image_key TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  poster_spec JSONB,
  brand_essence TEXT,
  design_tokens JSONB,
  screenshot_url TEXT,
  screenshot_key TEXT,
  poster_layout JSONB,
  design_status TEXT,
  scenario TEXT NOT NULL DEFAULT 'product',
  event_details JSONB,
  reference_context TEXT,
  reference_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT campaigns_reference_context_length
    CHECK (reference_context IS NULL OR char_length(reference_context) <= 4000),
  CONSTRAINT campaigns_reference_images_shape
    CHECK (
      jsonb_typeof(reference_images) = 'array'
      AND jsonb_array_length(reference_images) <= 5
    )
);

CREATE INDEX idx_campaigns_user_id ON public.campaigns(user_id);

CREATE TABLE public.placements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_placements_campaign_id ON public.placements(campaign_id);
CREATE INDEX idx_placements_user_id ON public.placements(user_id);

CREATE TABLE public.scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_id UUID NOT NULL REFERENCES public.placements(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device TEXT,
  os TEXT,
  country TEXT,
  city TEXT,
  visitor_hash TEXT NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scans_placement_id ON public.scans(placement_id);
CREATE INDEX idx_scans_campaign_id ON public.scans(campaign_id);
CREATE INDEX idx_scans_user_id ON public.scans(user_id);
CREATE INDEX idx_scans_scanned_at ON public.scans(scanned_at);
CREATE INDEX idx_scans_placement_visitor ON public.scans(placement_id, visitor_hash);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY posterlytics_campaigns_owner ON public.campaigns
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY posterlytics_placements_owner ON public.placements
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY posterlytics_scans_owner_read ON public.scans
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

GRANT USAGE ON SCHEMA public TO anon, authenticated;

REVOKE ALL ON public.campaigns FROM anon, authenticated;
REVOKE ALL ON public.placements FROM anon, authenticated;
REVOKE ALL ON public.scans FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.placements TO authenticated;
GRANT SELECT ON public.scans TO authenticated;

CREATE FUNCTION public.log_visit(
  p_code TEXT,
  p_device TEXT,
  p_os TEXT,
  p_visitor_hash TEXT
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
    visitor_hash
  )
  VALUES (
    v_placement.id,
    v_placement.campaign_id,
    v_placement.user_id,
    p_device,
    p_os,
    p_visitor_hash
  );

  RETURN v_campaign.destination_url;
END;
$$;

CREATE FUNCTION public.link_status(p_code TEXT)
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

CREATE FUNCTION public.campaign_breakdowns(p_campaign_id UUID)
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
      jsonb_build_object('key', device, 'visits', visit_count)
      ORDER BY visit_count DESC, device
    ) AS items
    FROM (
      SELECT device, COUNT(*) AS visit_count
      FROM owned
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
      FROM owned
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
      FROM owned
      GROUP BY country
    ) rows
  )
  SELECT jsonb_build_object(
    'devices', COALESCE((SELECT items FROM devices), '[]'::jsonb),
    'os', COALESCE((SELECT items FROM operating_systems), '[]'::jsonb),
    'countries', COALESCE((SELECT items FROM countries), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.log_visit(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_status(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.placement_stats(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.campaign_breakdowns(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.log_visit(TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.link_status(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.placement_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_breakdowns(UUID) TO authenticated;

-- The `assets` bucket must be created as a public bucket with the InsForge CLI.
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS storage_objects_owner_select ON storage.objects;
DROP POLICY IF EXISTS storage_objects_owner_insert ON storage.objects;
DROP POLICY IF EXISTS storage_objects_owner_update ON storage.objects;
DROP POLICY IF EXISTS storage_objects_owner_delete ON storage.objects;

CREATE POLICY posterlytics_assets_public_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket = 'assets');

CREATE POLICY posterlytics_assets_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket = 'assets'
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
  );

CREATE POLICY posterlytics_assets_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket = 'assets'
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
  )
  WITH CHECK (
    bucket = 'assets'
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
  );

CREATE POLICY posterlytics_assets_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket = 'assets'
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
  );

GRANT USAGE ON SCHEMA storage TO anon, authenticated;
GRANT SELECT ON storage.objects TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
