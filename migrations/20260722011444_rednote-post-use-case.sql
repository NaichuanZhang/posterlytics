ALTER TABLE public.campaigns
  DROP CONSTRAINT campaigns_use_case_valid,
  DROP CONSTRAINT campaigns_source_urls_required,
  DROP CONSTRAINT campaigns_platform_hint_valid;

ALTER TABLE public.poster_generations
  DROP CONSTRAINT poster_generations_use_case_valid,
  DROP CONSTRAINT poster_generations_platform_hint_valid;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_use_case_valid
    CHECK (
      use_case IN (
        'website_product',
        'amazon_listing',
        'social_cover',
        'rednote_post',
        'event'
      )
    ),
  ADD CONSTRAINT campaigns_source_urls_required
    CHECK (
      use_case IN ('social_cover', 'rednote_post')
      OR (product_url IS NOT NULL AND destination_url IS NOT NULL)
    ),
  ADD CONSTRAINT campaigns_platform_hint_valid
    CHECK (
      (
        platform_hint IS NULL
        OR (
          platform_hint = BTRIM(platform_hint)
          AND char_length(platform_hint) BETWEEN 1 AND 80
        )
      )
      AND (use_case IN ('social_cover', 'rednote_post') OR platform_hint IS NULL)
    );

ALTER TABLE public.poster_generations
  ADD CONSTRAINT poster_generations_use_case_valid
    CHECK (
      use_case IN (
        'website_product',
        'amazon_listing',
        'social_cover',
        'rednote_post',
        'event'
      )
    ),
  ADD CONSTRAINT poster_generations_platform_hint_valid
    CHECK (
      (
        platform_hint IS NULL
        OR (
          platform_hint = BTRIM(platform_hint)
          AND char_length(platform_hint) BETWEEN 1 AND 80
        )
      )
      AND (use_case IN ('social_cover', 'rednote_post') OR platform_hint IS NULL)
    );

CREATE OR REPLACE FUNCTION public.guard_placement_tracking_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_use_case TEXT;
BEGIN
  -- Serialize placement writes with campaign use-case changes.
  SELECT use_case
  INTO v_use_case
  FROM public.campaigns
  WHERE id = NEW.campaign_id
    AND user_id = NEW.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'placement campaign not found or not owned by placement user'
      USING ERRCODE = '23503';
  END IF;

  IF v_use_case = 'social_cover' THEN
    RAISE EXCEPTION 'Social cover campaigns cannot have placements.'
      USING ERRCODE = '23514';
  ELSIF v_use_case = 'rednote_post' THEN
    RAISE EXCEPTION 'RedNote post campaigns cannot have placements.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

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

  SELECT *
  INTO v_campaign
  FROM public.campaigns
  WHERE id = p_campaign_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign not found' USING ERRCODE = 'P0002';
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

  IF v_campaign.use_case IN ('social_cover', 'rednote_post')
    AND (
      jsonb_array_length(v_reference_images) < 1
      OR NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_reference_images) AS item(value)
        WHERE jsonb_typeof(item.value) = 'object'
          AND NULLIF(BTRIM(item.value ->> 'url'), '') IS NOT NULL
      )
    ) THEN
    IF v_campaign.use_case = 'social_cover' THEN
      RAISE EXCEPTION 'Social cover generation requires at least one reference image.'
        USING ERRCODE = '22023';
    ELSE
      RAISE EXCEPTION 'RedNote post generation requires at least one reference image.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_campaign.use_case = 'rednote_post' AND v_instruction IS NULL THEN
    RAISE EXCEPTION 'RedNote post generation requires draft copy.'
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
  ELSIF NOT p_refresh_website
    AND v_campaign.use_case NOT IN ('social_cover', 'rednote_post') THEN
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
    platform_hint,
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
    CASE
      WHEN p_refresh_website
        OR v_campaign.use_case IN ('social_cover', 'rednote_post')
        THEN 'website_refresh'
      ELSE 'iteration'
    END,
    v_instruction,
    v_reference_images,
    v_campaign.poster_format,
    CASE WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.scenario ELSE v_parent.scenario END,
    CASE WHEN v_campaign.current_generation_id IS NULL THEN v_campaign.use_case ELSE v_parent.use_case END,
    v_campaign.platform_hint,
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

CREATE OR REPLACE FUNCTION public.guard_campaign_tracking_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.use_case IN ('social_cover', 'rednote_post')
    AND NEW.use_case IS DISTINCT FROM OLD.use_case
    AND EXISTS (
      SELECT 1
      FROM public.placements
      WHERE campaign_id = OLD.id
    ) THEN
    IF NEW.use_case = 'social_cover' THEN
      RAISE EXCEPTION 'Remove campaign placements before switching to social cover.'
        USING ERRCODE = '23514';
    ELSE
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
    OR v_campaign.use_case IN ('social_cover', 'rednote_post')
    OR v_campaign.destination_url IS NULL THEN
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

  IF v_previous_generation.use_case IN ('social_cover', 'rednote_post')
    AND (
      jsonb_array_length(v_previous_generation.reference_images) < 1
      OR NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_previous_generation.reference_images) AS item(value)
        WHERE jsonb_typeof(item.value) = 'object'
          AND NULLIF(BTRIM(item.value ->> 'url'), '') IS NOT NULL
      )
    ) THEN
    IF v_previous_generation.use_case = 'social_cover' THEN
      RAISE EXCEPTION 'Social cover generation requires at least one reference image.'
        USING ERRCODE = '22023';
    ELSE
      RAISE EXCEPTION 'RedNote post generation requires at least one reference image.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_previous_generation.use_case = 'rednote_post'
    AND NULLIF(BTRIM(v_previous_generation.instruction), '') IS NULL THEN
    RAISE EXCEPTION 'RedNote post generation requires draft copy.'
      USING ERRCODE = '22023';
  END IF;

  IF v_previous_generation.parent_generation_id IS NULL
    AND v_previous_generation.generation_mode <> 'website_refresh'
    AND v_previous_generation.use_case NOT IN ('social_cover', 'rednote_post') THEN
    RAISE EXCEPTION 'the first poster generation must re-read the website'
      USING ERRCODE = '23514';
  END IF;

  v_reuse_selection := v_previous_generation.asset_selection_status = 'completed';
  v_resume_stage := CASE
    WHEN v_reuse_selection AND v_previous_job.stage IN ('designer', 'hero')
      THEN v_previous_job.stage
    WHEN v_previous_generation.generation_mode = 'website_refresh'
      OR v_previous_generation.use_case IN ('social_cover', 'rednote_post')
      THEN 'analyze'
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
    platform_hint,
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
    CASE
      WHEN v_previous_generation.use_case IN ('social_cover', 'rednote_post')
        THEN 'website_refresh'
      ELSE v_previous_generation.generation_mode
    END,
    v_previous_generation.instruction,
    v_previous_generation.reference_images,
    v_previous_generation.poster_format,
    v_previous_generation.scenario,
    v_previous_generation.use_case,
    v_previous_generation.platform_hint,
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

REVOKE ALL ON FUNCTION public.log_visit_attributed(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_poster_generation(UUID, TEXT, JSONB, BOOLEAN, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retry_poster_generation(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.log_visit_attributed(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO anon;
GRANT EXECUTE ON FUNCTION public.enqueue_poster_generation(UUID, TEXT, JSONB, BOOLEAN, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.retry_poster_generation(UUID)
  TO authenticated;
