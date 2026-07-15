ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS reference_context TEXT,
  ADD COLUMN IF NOT EXISTS reference_images JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_reference_context_length,
  ADD CONSTRAINT campaigns_reference_context_length
    CHECK (reference_context IS NULL OR char_length(reference_context) <= 4000),
  DROP CONSTRAINT IF EXISTS campaigns_reference_images_shape,
  ADD CONSTRAINT campaigns_reference_images_shape
    CHECK (
      jsonb_typeof(reference_images) = 'array'
      AND jsonb_array_length(reference_images) <= 5
    );

-- Keep generated/reference assets publicly readable while restricting mutations
-- to the authenticated user who uploaded each object.
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS posterlytics_assets_public_read ON storage.objects;
DROP POLICY IF EXISTS posterlytics_assets_owner_insert ON storage.objects;
DROP POLICY IF EXISTS posterlytics_assets_owner_update ON storage.objects;
DROP POLICY IF EXISTS posterlytics_assets_owner_delete ON storage.objects;

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

-- A visit is the only observable event. Keep the existing signature so the
-- currently deployed view function remains compatible during rollout.
CREATE OR REPLACE FUNCTION public.log_visit(
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

REVOKE ALL ON FUNCTION public.log_visit(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_visit(TEXT, TEXT, TEXT, TEXT) TO anon;
