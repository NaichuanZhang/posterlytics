ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS current_generation_id UUID;

CREATE TABLE public.poster_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_generation_id UUID,
  version_number INTEGER,
  status TEXT NOT NULL DEFAULT 'created',
  generation_mode TEXT NOT NULL,
  instruction TEXT,
  reference_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  scenario TEXT NOT NULL DEFAULT 'product',
  event_details JSONB,
  style_profile JSONB,
  poster_copy JSONB,
  poster_content JSONB,
  brand_assets JSONB,
  brand_essence TEXT,
  poster_spec JSONB,
  design_tokens JSONB,
  screenshot_url TEXT,
  screenshot_key TEXT,
  poster_layout JSONB,
  design_status TEXT,
  hero_image_url TEXT,
  hero_image_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_stage TEXT,
  failure_code TEXT,
  failure_message TEXT,
  CONSTRAINT poster_generations_campaign_id_id_unique UNIQUE (campaign_id, id),
  CONSTRAINT poster_generations_status_valid
    CHECK (status IN ('created', 'analyzing', 'designing', 'painting', 'ready', 'failed')),
  CONSTRAINT poster_generations_mode_valid
    CHECK (generation_mode IN ('iteration', 'website_refresh')),
  CONSTRAINT poster_generations_instruction_length
    CHECK (instruction IS NULL OR char_length(instruction) <= 4000),
  CONSTRAINT poster_generations_reference_images_shape
    CHECK (
      jsonb_typeof(reference_images) = 'array'
      AND jsonb_array_length(reference_images) <= 5
    ),
  CONSTRAINT poster_generations_version_state
    CHECK (
      (
        status = 'ready'
        AND version_number IS NOT NULL
        AND version_number > 0
        AND hero_image_url IS NOT NULL
        AND completed_at IS NOT NULL
      )
      OR
      (
        status <> 'ready'
        AND version_number IS NULL
        AND completed_at IS NULL
      )
    ),
  CONSTRAINT poster_generations_failure_state
    CHECK (
      (
        status = 'failed'
        AND failed_at IS NOT NULL
        AND failure_message IS NOT NULL
      )
      OR
      (
        status <> 'failed'
        AND failed_at IS NULL
        AND failure_stage IS NULL
        AND failure_code IS NULL
        AND failure_message IS NULL
      )
    ),
  CONSTRAINT poster_generations_failure_stage_valid
    CHECK (
      failure_stage IS NULL
      OR failure_stage IN ('analyze', 'designer', 'hero', 'complete')
    )
);

ALTER TABLE public.poster_generations
  ADD CONSTRAINT poster_generations_parent_same_campaign
  FOREIGN KEY (campaign_id, parent_generation_id)
  REFERENCES public.poster_generations(campaign_id, id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_poster_generations_campaign_created
  ON public.poster_generations(campaign_id, created_at DESC);
CREATE INDEX idx_poster_generations_user_id
  ON public.poster_generations(user_id);
CREATE INDEX idx_poster_generations_parent_id
  ON public.poster_generations(parent_generation_id);
CREATE UNIQUE INDEX idx_poster_generations_campaign_version
  ON public.poster_generations(campaign_id, version_number)
  WHERE version_number IS NOT NULL;
CREATE UNIQUE INDEX idx_poster_generations_one_active
  ON public.poster_generations(campaign_id)
  WHERE status IN ('created', 'analyzing', 'designing', 'painting');

CREATE OR REPLACE FUNCTION public.guard_poster_generation_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.status IN ('ready', 'failed') THEN
    RAISE EXCEPTION 'terminal poster generations are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF (
    NEW.id,
    NEW.campaign_id,
    NEW.user_id,
    NEW.parent_generation_id,
    NEW.generation_mode,
    NEW.instruction,
    NEW.reference_images,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.id,
    OLD.campaign_id,
    OLD.user_id,
    OLD.parent_generation_id,
    OLD.generation_mode,
    OLD.instruction,
    OLD.reference_images,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'poster generation identity and inputs are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.version_number IS DISTINCT FROM OLD.version_number
    AND NOT (OLD.status = 'painting' AND NEW.status = 'ready') THEN
    RAISE EXCEPTION 'version_number is server maintained'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'created' AND NEW.status IN ('analyzing', 'designing', 'painting', 'failed'))
    OR (OLD.status = 'analyzing' AND NEW.status IN ('designing', 'painting', 'failed'))
    OR (OLD.status = 'designing' AND NEW.status IN ('painting', 'failed'))
    OR (OLD.status = 'painting' AND NEW.status IN ('ready', 'failed'))
  ) THEN
    RAISE EXCEPTION 'invalid poster generation status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER poster_generations_guard_update
  BEFORE UPDATE ON public.poster_generations
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_poster_generation_update();

CREATE TRIGGER poster_generations_updated_at
  BEFORE UPDATE ON public.poster_generations
  FOR EACH ROW
  EXECUTE FUNCTION system.update_updated_at();

ALTER TABLE public.poster_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY poster_generations_owner_read
  ON public.poster_generations
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY poster_generations_owner_update
  ON public.poster_generations
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.poster_generations FROM anon, authenticated;
GRANT SELECT ON public.poster_generations TO authenticated;
GRANT UPDATE (
  status,
  scenario,
  event_details,
  style_profile,
  poster_copy,
  poster_content,
  brand_assets,
  brand_essence,
  poster_spec,
  design_tokens,
  screenshot_url,
  screenshot_key,
  poster_layout,
  design_status,
  failed_at,
  failure_stage,
  failure_code,
  failure_message
) ON public.poster_generations TO authenticated;

CREATE OR REPLACE FUNCTION public.create_poster_generation(
  p_campaign_id UUID,
  p_instruction TEXT DEFAULT NULL,
  p_reference_images JSONB DEFAULT '[]'::jsonb,
  p_refresh_website BOOLEAN DEFAULT FALSE
)
RETURNS public.poster_generations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_campaign public.campaigns%ROWTYPE;
  v_parent public.poster_generations%ROWTYPE;
  v_generation public.poster_generations%ROWTYPE;
  v_instruction TEXT := NULLIF(BTRIM(p_instruction), '');
  v_reference_images JSONB := COALESCE(p_reference_images, '[]'::jsonb);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_instruction IS NOT NULL AND char_length(v_instruction) > 4000 THEN
    RAISE EXCEPTION 'instruction must be 4000 characters or fewer'
      USING ERRCODE = '22001';
  END IF;

  IF jsonb_typeof(v_reference_images) <> 'array'
    OR jsonb_array_length(v_reference_images) > 5 THEN
    RAISE EXCEPTION 'reference_images must be an array with at most 5 items'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_campaign
  FROM public.campaigns
  WHERE id = p_campaign_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign not found' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.poster_generations
    WHERE campaign_id = p_campaign_id
      AND status IN ('created', 'analyzing', 'designing', 'painting')
  ) THEN
    RAISE EXCEPTION 'a poster generation is already active for this campaign'
      USING ERRCODE = '23505';
  END IF;

  IF v_campaign.current_generation_id IS NOT NULL THEN
    SELECT *
    INTO v_parent
    FROM public.poster_generations
    WHERE id = v_campaign.current_generation_id
      AND campaign_id = v_campaign.id
      AND user_id = v_user_id
      AND status = 'ready';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'current poster generation is invalid'
        USING ERRCODE = '23503';
    END IF;
  ELSIF NOT p_refresh_website THEN
    RAISE EXCEPTION 'the first poster generation must re-read the website'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.poster_generations (
    campaign_id,
    user_id,
    parent_generation_id,
    generation_mode,
    instruction,
    reference_images,
    scenario,
    event_details,
    style_profile,
    poster_copy,
    poster_content,
    brand_assets,
    brand_essence,
    poster_spec,
    design_tokens,
    screenshot_url,
    screenshot_key,
    poster_layout,
    design_status
  )
  VALUES (
    v_campaign.id,
    v_user_id,
    v_campaign.current_generation_id,
    CASE WHEN p_refresh_website THEN 'website_refresh' ELSE 'iteration' END,
    v_instruction,
    v_reference_images,
    CASE WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.scenario ELSE v_parent.scenario END,
    CASE WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.event_details ELSE v_parent.event_details END,
    CASE WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.style_profile ELSE v_parent.style_profile END,
    CASE WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.poster_copy ELSE v_parent.poster_copy END,
    CASE WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.poster_content ELSE v_parent.poster_content END,
    CASE WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.brand_assets ELSE v_parent.brand_assets END,
    CASE WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.brand_essence ELSE v_parent.brand_essence END,
    CASE WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.poster_spec ELSE v_parent.poster_spec END,
    CASE WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.design_tokens ELSE v_parent.design_tokens END,
    CASE WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.screenshot_url ELSE v_parent.screenshot_url END,
    CASE WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.screenshot_key ELSE v_parent.screenshot_key END,
    CASE WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.poster_layout ELSE v_parent.poster_layout END,
    CASE WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.design_status ELSE v_parent.design_status END
  )
  RETURNING * INTO v_generation;

  RETURN v_generation;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_poster_generation(
  p_generation_id UUID,
  p_hero_image_url TEXT,
  p_hero_image_key TEXT
)
RETURNS public.poster_generations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_campaign public.campaigns%ROWTYPE;
  v_generation public.poster_generations%ROWTYPE;
  v_next_version INTEGER;
  v_hero_url TEXT := NULLIF(BTRIM(p_hero_image_url), '');
  v_hero_key TEXT := NULLIF(BTRIM(p_hero_image_key), '');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_hero_url IS NULL OR v_hero_key IS NULL THEN
    RAISE EXCEPTION 'hero image URL and key are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_generation
  FROM public.poster_generations
  WHERE id = p_generation_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'poster generation not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_generation.status <> 'painting' THEN
    RAISE EXCEPTION 'poster generation is not ready to complete'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_campaign
  FROM public.campaigns
  WHERE id = v_generation.campaign_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_next_version
  FROM public.poster_generations
  WHERE campaign_id = v_generation.campaign_id
    AND version_number IS NOT NULL;

  UPDATE public.poster_generations
  SET
    version_number = v_next_version,
    status = 'ready',
    hero_image_url = v_hero_url,
    hero_image_key = v_hero_key,
    completed_at = NOW()
  WHERE id = v_generation.id
  RETURNING * INTO v_generation;

  UPDATE public.campaigns
  SET
    scenario = v_generation.scenario,
    event_details = v_generation.event_details,
    style_profile = v_generation.style_profile,
    poster_copy = v_generation.poster_copy,
    poster_content = v_generation.poster_content,
    brand_assets = v_generation.brand_assets,
    brand_essence = v_generation.brand_essence,
    poster_spec = v_generation.poster_spec,
    design_tokens = v_generation.design_tokens,
    screenshot_url = v_generation.screenshot_url,
    screenshot_key = v_generation.screenshot_key,
    poster_layout = v_generation.poster_layout,
    design_status = v_generation.design_status,
    hero_image_url = v_generation.hero_image_url,
    hero_image_key = v_generation.hero_image_key,
    reference_context = v_generation.instruction,
    reference_images = v_generation.reference_images,
    current_generation_id = v_generation.id
  WHERE id = v_campaign.id;

  RETURN v_generation;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_poster_generation(
  p_generation_id UUID
)
RETURNS public.poster_generations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_generation public.poster_generations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_generation
  FROM public.poster_generations
  WHERE id = p_generation_id
    AND user_id = v_user_id
    AND status = 'ready';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ready poster generation not found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.campaigns
  WHERE id = v_generation.campaign_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.campaigns
  SET
    scenario = v_generation.scenario,
    event_details = v_generation.event_details,
    style_profile = v_generation.style_profile,
    poster_copy = v_generation.poster_copy,
    poster_content = v_generation.poster_content,
    brand_assets = v_generation.brand_assets,
    brand_essence = v_generation.brand_essence,
    poster_spec = v_generation.poster_spec,
    design_tokens = v_generation.design_tokens,
    screenshot_url = v_generation.screenshot_url,
    screenshot_key = v_generation.screenshot_key,
    poster_layout = v_generation.poster_layout,
    design_status = v_generation.design_status,
    hero_image_url = v_generation.hero_image_url,
    hero_image_key = v_generation.hero_image_key,
    reference_context = v_generation.instruction,
    reference_images = v_generation.reference_images,
    current_generation_id = v_generation.id
  WHERE id = v_generation.campaign_id;

  RETURN v_generation;
END;
$$;

REVOKE ALL ON FUNCTION public.create_poster_generation(UUID, TEXT, JSONB, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_poster_generation(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_poster_generation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_poster_generation(UUID, TEXT, JSONB, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_poster_generation(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_poster_generation(UUID) TO authenticated;

INSERT INTO public.poster_generations (
  campaign_id,
  user_id,
  version_number,
  status,
  generation_mode,
  instruction,
  reference_images,
  scenario,
  event_details,
  style_profile,
  poster_copy,
  poster_content,
  brand_assets,
  brand_essence,
  poster_spec,
  design_tokens,
  screenshot_url,
  screenshot_key,
  poster_layout,
  design_status,
  hero_image_url,
  hero_image_key,
  created_at,
  updated_at,
  completed_at
)
SELECT
  c.id,
  c.user_id,
  1,
  'ready',
  'website_refresh',
  c.reference_context,
  c.reference_images,
  c.scenario,
  c.event_details,
  c.style_profile,
  c.poster_copy,
  c.poster_content,
  c.brand_assets,
  c.brand_essence,
  c.poster_spec,
  c.design_tokens,
  c.screenshot_url,
  c.screenshot_key,
  c.poster_layout,
  c.design_status,
  c.hero_image_url,
  c.hero_image_key,
  c.created_at,
  c.created_at,
  c.created_at
FROM public.campaigns c
WHERE c.hero_image_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.poster_generations g
    WHERE g.campaign_id = c.id
  );

UPDATE public.campaigns c
SET current_generation_id = g.id
FROM public.poster_generations g
WHERE g.campaign_id = c.id
  AND g.version_number = 1
  AND c.current_generation_id IS NULL;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_current_generation_same_campaign
  FOREIGN KEY (id, current_generation_id)
  REFERENCES public.poster_generations(campaign_id, id)
  DEFERRABLE INITIALLY DEFERRED;

REVOKE INSERT, UPDATE ON public.campaigns FROM authenticated;
GRANT INSERT (
  user_id,
  product_url,
  product_name,
  tagline,
  cta_text,
  destination_url,
  status,
  scenario,
  reference_context,
  reference_images
) ON public.campaigns TO authenticated;
GRANT UPDATE (
  product_url,
  product_name,
  tagline,
  cta_text,
  destination_url,
  status,
  scenario,
  reference_context,
  reference_images
) ON public.campaigns TO authenticated;
