ALTER TABLE public.campaigns
  ADD COLUMN use_case TEXT;

ALTER TABLE public.poster_generations
  ADD COLUMN use_case TEXT;

-- Terminal generation rows must participate in the backfill. The migration is
-- transactional, so the guard is absent only while these statements execute.
DROP TRIGGER poster_generations_guard_update
  ON public.poster_generations;

-- Scenario was historically app-enforced. Normalize unexpected persisted
-- values before adding the database constraint and classifying intent.
UPDATE public.campaigns
SET scenario = 'product'
WHERE scenario NOT IN ('product', 'event');

UPDATE public.poster_generations
SET scenario = 'product'
WHERE scenario NOT IN ('product', 'event');

UPDATE public.campaigns
SET use_case = CASE
  WHEN scenario = 'event' THEN 'event'
  WHEN SUBSTRING(
    LOWER(BTRIM(product_url))
    FROM '^https?://(?:[^/?#]*@)?([^:/?#]+)(?::[0-9]+)?(?:[/?#]|$)'
  ) IN (
    'amazon.com',
    'www.amazon.com',
    'a.co',
    'amzn.to',
    'amzn.asia',
    'amzn.eu'
  ) THEN 'amazon_listing'
  ELSE 'website_product'
END;

UPDATE public.poster_generations AS generation
SET use_case = CASE
  WHEN generation.scenario = 'event' THEN 'event'
  WHEN SUBSTRING(
    LOWER(BTRIM(campaign.product_url))
    FROM '^https?://(?:[^/?#]*@)?([^:/?#]+)(?::[0-9]+)?(?:[/?#]|$)'
  ) IN (
    'amazon.com',
    'www.amazon.com',
    'a.co',
    'amzn.to',
    'amzn.asia',
    'amzn.eu'
  ) THEN 'amazon_listing'
  ELSE 'website_product'
END
FROM public.campaigns AS campaign
WHERE campaign.id = generation.campaign_id;

ALTER TABLE public.campaigns
  ALTER COLUMN use_case SET DEFAULT 'website_product';

ALTER TABLE public.poster_generations
  ALTER COLUMN use_case SET DEFAULT 'website_product';

ALTER TABLE public.campaigns
  ALTER COLUMN use_case SET NOT NULL;

ALTER TABLE public.poster_generations
  ALTER COLUMN use_case SET NOT NULL;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_scenario_valid
    CHECK (scenario IN ('product', 'event')),
  ADD CONSTRAINT campaigns_use_case_valid
    CHECK (use_case IN ('website_product', 'amazon_listing', 'event')),
  ADD CONSTRAINT campaigns_scenario_use_case_consistent
    CHECK ((scenario = 'event') = (use_case = 'event'));

ALTER TABLE public.poster_generations
  ADD CONSTRAINT poster_generations_scenario_valid
    CHECK (scenario IN ('product', 'event')),
  ADD CONSTRAINT poster_generations_use_case_valid
    CHECK (use_case IN ('website_product', 'amazon_listing', 'event')),
  ADD CONSTRAINT poster_generations_scenario_use_case_consistent
    CHECK ((scenario = 'event') = (use_case = 'event'));

CREATE OR REPLACE FUNCTION public.guard_poster_generation_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.status IN ('ready', 'failed', 'canceled') THEN
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
    NEW.poster_format,
    NEW.scenario,
    NEW.use_case,
    NEW.trace_schema_version,
    NEW.asset_selection_mode,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.id,
    OLD.campaign_id,
    OLD.user_id,
    OLD.parent_generation_id,
    OLD.generation_mode,
    OLD.instruction,
    OLD.reference_images,
    OLD.poster_format,
    OLD.scenario,
    OLD.use_case,
    OLD.trace_schema_version,
    OLD.asset_selection_mode,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'poster generation identity and inputs are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.trace_incomplete AND NOT NEW.trace_incomplete THEN
    RAISE EXCEPTION 'trace_incomplete cannot be cleared'
      USING ERRCODE = '23514';
  END IF;

  IF (
    NEW.asset_selection_status,
    NEW.asset_selection_method,
    NEW.asset_selection_completed_at
  ) IS DISTINCT FROM (
    OLD.asset_selection_status,
    OLD.asset_selection_method,
    OLD.asset_selection_completed_at
  ) AND NOT (
    OLD.trace_schema_version = 2
    AND OLD.asset_selection_status = 'pending'
    AND NEW.asset_selection_status = 'completed'
    AND NEW.asset_selection_method IN ('user', 'ai', 'rules_fallback', 'retry_reuse')
    AND NEW.asset_selection_completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'invalid generation asset selection transition'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.version_number IS DISTINCT FROM OLD.version_number
    AND NOT (OLD.status = 'painting' AND NEW.status = 'ready') THEN
    RAISE EXCEPTION 'version_number is server maintained'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (
      OLD.status = 'created'
      AND NEW.status IN ('analyzing', 'reviewing', 'designing', 'painting', 'failed')
    )
    OR (
      OLD.status = 'analyzing'
      AND NEW.status IN ('reviewing', 'designing', 'painting', 'failed')
    )
    OR (
      OLD.status = 'reviewing'
      AND NEW.status IN ('designing', 'painting', 'failed', 'canceled')
    )
    OR (OLD.status = 'designing' AND NEW.status IN ('painting', 'failed'))
    OR (OLD.status = 'painting' AND NEW.status IN ('ready', 'failed'))
  ) THEN
    RAISE EXCEPTION 'invalid poster generation status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.trace_schema_version = 2
    AND NEW.status IN ('designing', 'painting', 'ready')
    AND NEW.asset_selection_status <> 'completed' THEN
    RAISE EXCEPTION 'assets must be selected before final generation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER poster_generations_guard_update
  BEFORE UPDATE ON public.poster_generations
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_poster_generation_update();

CREATE FUNCTION public.guard_campaign_source_intent_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF (
    NEW.product_url,
    NEW.use_case
  ) IS NOT DISTINCT FROM (
    OLD.product_url,
    OLD.use_case
  ) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.poster_generations
    WHERE campaign_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'campaign source intent is immutable after generation starts'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER campaigns_guard_source_intent_update
  BEFORE UPDATE OF product_url, use_case ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_campaign_source_intent_update();

CREATE OR REPLACE FUNCTION public.enqueue_poster_generation(
  p_campaign_id UUID,
  p_instruction TEXT DEFAULT NULL,
  p_reference_images JSONB DEFAULT '[]'::jsonb,
  p_refresh_website BOOLEAN DEFAULT FALSE,
  p_color_scheme TEXT DEFAULT 'light',
  p_asset_selection_mode TEXT DEFAULT 'yolo'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_campaign public.campaigns%ROWTYPE;
  v_parent public.poster_generations%ROWTYPE;
  v_generation public.poster_generations%ROWTYPE;
  v_job public.generation_jobs%ROWTYPE;
  v_instruction TEXT := NULLIF(BTRIM(p_instruction), '');
  v_reference_images JSONB := COALESCE(p_reference_images, '[]'::jsonb);
  v_color_scheme TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_color_scheme), ''), 'light'));
  v_asset_selection_mode TEXT := LOWER(
    COALESCE(NULLIF(BTRIM(p_asset_selection_mode), ''), 'yolo')
  );
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

  IF v_color_scheme NOT IN ('light', 'dark') THEN
    RAISE EXCEPTION 'color_scheme must be light or dark'
      USING ERRCODE = '22023';
  END IF;

  IF v_asset_selection_mode NOT IN ('editor', 'yolo') THEN
    RAISE EXCEPTION 'asset_selection_mode must be editor or yolo'
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
      AND status IN ('created', 'analyzing', 'reviewing', 'designing', 'painting')
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
    poster_format,
    scenario,
    use_case,
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
    trace_schema_version,
    asset_selection_mode,
    asset_selection_status
  )
  VALUES (
    v_campaign.id,
    v_user_id,
    v_campaign.current_generation_id,
    CASE WHEN p_refresh_website THEN 'website_refresh' ELSE 'iteration' END,
    v_instruction,
    v_reference_images,
    v_campaign.poster_format,
    CASE
      WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.scenario
      ELSE v_parent.scenario
    END,
    CASE
      WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.use_case
      ELSE v_parent.use_case
    END,
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
    CASE WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.design_status ELSE v_parent.design_status END,
    2,
    v_asset_selection_mode,
    'pending'
  )
  RETURNING * INTO v_generation;

  INSERT INTO public.generation_jobs (
    generation_id,
    campaign_id,
    user_id,
    status,
    stage,
    color_scheme
  )
  VALUES (
    v_generation.id,
    v_generation.campaign_id,
    v_generation.user_id,
    'queued',
    CASE
      WHEN v_generation.generation_mode = 'website_refresh' THEN 'analyze'
      ELSE 'assets'
    END,
    v_color_scheme
  )
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'generation', to_jsonb(v_generation),
    'job', to_jsonb(v_job)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_poster_generation(
  p_job_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_previous_job public.generation_jobs%ROWTYPE;
  v_previous_generation public.poster_generations%ROWTYPE;
  v_campaign public.campaigns%ROWTYPE;
  v_generation public.poster_generations%ROWTYPE;
  v_job public.generation_jobs%ROWTYPE;
  v_reuse_selection BOOLEAN;
  v_resume_stage TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_previous_job
  FROM public.generation_jobs
  WHERE id = p_job_id
    AND user_id = v_user_id
    AND status = 'failed'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'failed generation job not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_previous_generation
  FROM public.poster_generations
  WHERE id = v_previous_job.generation_id
    AND user_id = v_user_id
    AND status = 'failed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'failed poster generation not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_campaign
  FROM public.campaigns
  WHERE id = v_previous_job.campaign_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign not found' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.poster_generations
    WHERE campaign_id = v_campaign.id
      AND status IN ('created', 'analyzing', 'reviewing', 'designing', 'painting')
  ) THEN
    RAISE EXCEPTION 'a poster generation is already active for this campaign'
      USING ERRCODE = '23505';
  END IF;

  v_reuse_selection := v_previous_generation.asset_selection_status = 'completed';
  v_resume_stage := CASE
    WHEN v_reuse_selection AND v_previous_job.stage IN ('designer', 'hero')
      THEN v_previous_job.stage
    WHEN v_previous_generation.generation_mode = 'website_refresh' THEN 'analyze'
    ELSE 'assets'
  END;

  INSERT INTO public.poster_generations (
    campaign_id,
    user_id,
    parent_generation_id,
    generation_mode,
    instruction,
    reference_images,
    poster_format,
    scenario,
    use_case,
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
    trace_schema_version,
    asset_selection_mode,
    asset_selection_status,
    asset_selection_method,
    asset_selection_completed_at
  )
  VALUES (
    v_previous_generation.campaign_id,
    v_previous_generation.user_id,
    v_previous_generation.parent_generation_id,
    v_previous_generation.generation_mode,
    v_previous_generation.instruction,
    v_previous_generation.reference_images,
    v_previous_generation.poster_format,
    v_previous_generation.scenario,
    v_previous_generation.use_case,
    v_previous_generation.event_details,
    v_previous_generation.style_profile,
    v_previous_generation.poster_copy,
    v_previous_generation.poster_content,
    v_previous_generation.brand_assets,
    v_previous_generation.brand_essence,
    v_previous_generation.poster_spec,
    v_previous_generation.design_tokens,
    v_previous_generation.screenshot_url,
    v_previous_generation.screenshot_key,
    v_previous_generation.poster_layout,
    v_previous_generation.design_status,
    2,
    COALESCE(v_previous_generation.asset_selection_mode, 'yolo'),
    'pending',
    NULL,
    NULL
  )
  RETURNING * INTO v_generation;

  IF v_reuse_selection THEN
    INSERT INTO public.generation_assets (
      generation_id,
      campaign_id,
      user_id,
      candidate_key,
      source,
      url,
      object_key,
      filename,
      mime_type,
      size_bytes,
      storage_source,
      purpose,
      metadata,
      availability,
      availability_reason,
      included,
      selection_rank,
      selection_reason,
      candidate_position
    )
    SELECT
      v_generation.id,
      v_generation.campaign_id,
      v_generation.user_id,
      candidate_key,
      source,
      url,
      object_key,
      filename,
      mime_type,
      size_bytes,
      storage_source,
      purpose,
      metadata,
      availability,
      availability_reason,
      included,
      selection_rank,
      selection_reason,
      candidate_position
    FROM public.generation_assets
    WHERE generation_id = v_previous_generation.id
    ORDER BY candidate_position;

    UPDATE public.poster_generations
    SET
      asset_selection_status = 'completed',
      asset_selection_method = 'retry_reuse',
      asset_selection_completed_at = NOW()
    WHERE id = v_generation.id
    RETURNING * INTO v_generation;

    UPDATE public.generation_stage_traces
    SET
      status = 'succeeded',
      started_at = NOW(),
      completed_at = NOW(),
      candidate_images = public.generation_asset_trace_assets(v_generation.id, FALSE),
      attached_images = public.generation_asset_trace_assets(v_generation.id, TRUE),
      skipped_images = public.generation_asset_trace_skips(v_generation.id),
      failure_metadata = jsonb_build_object(
        'selection_mode',
        v_generation.asset_selection_mode,
        'selection_method',
        'retry_reuse',
        'source_generation_id',
        v_previous_generation.id
      )
    WHERE generation_id = v_generation.id
      AND stage = 'assets'
      AND status = 'pending';

    UPDATE public.generation_stage_traces
    SET
      status = 'skipped',
      completed_at = NOW(),
      failure_metadata = jsonb_build_object('reason', 'retry_reused_completed_selection')
    WHERE generation_id = v_generation.id
      AND stage = 'analyze'
      AND status = 'pending';

    IF v_resume_stage = 'hero' THEN
      UPDATE public.generation_stage_traces
      SET
        status = 'skipped',
        completed_at = NOW(),
        failure_metadata = jsonb_build_object('reason', 'retry_resumed_at_hero')
      WHERE generation_id = v_generation.id
        AND stage = 'designer'
        AND status = 'pending';
    END IF;
  END IF;

  INSERT INTO public.generation_jobs (
    generation_id,
    campaign_id,
    user_id,
    retry_of_job_id,
    status,
    stage,
    color_scheme
  )
  VALUES (
    v_generation.id,
    v_generation.campaign_id,
    v_generation.user_id,
    v_previous_job.id,
    'queued',
    v_resume_stage,
    v_previous_job.color_scheme
  )
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'generation', to_jsonb(v_generation),
    'job', to_jsonb(v_job)
  );
END;
$$;

GRANT INSERT (use_case) ON public.campaigns TO authenticated;
GRANT UPDATE (use_case) ON public.campaigns TO authenticated;
