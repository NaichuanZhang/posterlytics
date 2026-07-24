ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_social_cover_qr_destination_required
    CHECK (
      use_case <> 'social_cover'
      OR poster_format IS DISTINCT FROM 'rednote_3x4'
      OR NULLIF(BTRIM(destination_url), '') IS NOT NULL
    );

CREATE OR REPLACE FUNCTION public.guard_placement_tracking_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_use_case TEXT;
  v_destination_url TEXT;
BEGIN
  -- Serialize placement writes with campaign use-case changes.
  SELECT use_case, destination_url
  INTO v_use_case, v_destination_url
  FROM public.campaigns
  WHERE id = NEW.campaign_id
    AND user_id = NEW.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'placement campaign not found or not owned by placement user'
      USING ERRCODE = '23503';
  END IF;

  IF v_use_case = 'social_cover'
    AND NULLIF(BTRIM(v_destination_url), '') IS NULL THEN
    RAISE EXCEPTION 'Social cover campaigns require a destination before placements can be added.'
      USING ERRCODE = '23514';
  ELSIF v_use_case = 'rednote_post' THEN
    RAISE EXCEPTION 'RedNote post campaigns cannot have placements.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_campaign_tracking_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.use_case IS DISTINCT FROM OLD.use_case
    AND EXISTS (
      SELECT 1
      FROM public.placements
      WHERE campaign_id = OLD.id
    ) THEN
    IF NEW.use_case = 'social_cover'
      AND NULLIF(BTRIM(NEW.destination_url), '') IS NULL THEN
      RAISE EXCEPTION 'Add a social cover destination or remove campaign placements before switching.'
        USING ERRCODE = '23514';
    ELSIF NEW.use_case = 'rednote_post' THEN
      RAISE EXCEPTION 'Remove campaign placements before switching to RedNote post.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_visit_attributed(
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

  IF v_campaign.status <> 'published'
    OR v_campaign.use_case = 'rednote_post'
    OR NULLIF(BTRIM(v_campaign.destination_url), '') IS NULL THEN
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
