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
  current_generation_id UUID,
  CONSTRAINT campaigns_reference_context_length
    CHECK (reference_context IS NULL OR char_length(reference_context) <= 4000),
  CONSTRAINT campaigns_reference_images_shape
    CHECK (
      jsonb_typeof(reference_images) = 'array'
      AND jsonb_array_length(reference_images) <= 5
    )
);

CREATE INDEX idx_campaigns_user_id ON public.campaigns(user_id);

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
  trace_schema_version SMALLINT NOT NULL DEFAULT 1,
  trace_incomplete BOOLEAN NOT NULL DEFAULT FALSE,
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
    ),
  CONSTRAINT poster_generations_trace_schema_version_valid
    CHECK (trace_schema_version = 1)
);

ALTER TABLE public.poster_generations
  ADD CONSTRAINT poster_generations_parent_same_campaign
  FOREIGN KEY (campaign_id, parent_generation_id)
  REFERENCES public.poster_generations(campaign_id, id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_current_generation_same_campaign
  FOREIGN KEY (id, current_generation_id)
  REFERENCES public.poster_generations(campaign_id, id)
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
    NEW.trace_schema_version,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.id,
    OLD.campaign_id,
    OLD.user_id,
    OLD.parent_generation_id,
    OLD.generation_mode,
    OLD.instruction,
    OLD.reference_images,
    OLD.trace_schema_version,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'poster generation identity and inputs are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.trace_incomplete AND NOT NEW.trace_incomplete THEN
    RAISE EXCEPTION 'trace_incomplete cannot be cleared'
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

CREATE TABLE public.generation_stage_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL
    REFERENCES public.poster_generations(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL
    REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  model_calls JSONB NOT NULL DEFAULT '[]'::jsonb,
  candidate_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  attached_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  skipped_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  artifacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  failure_code TEXT,
  failure_message TEXT,
  failure_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT generation_stage_traces_generation_stage_unique
    UNIQUE (generation_id, stage),
  CONSTRAINT generation_stage_traces_stage_valid
    CHECK (stage IN ('analyze', 'designer', 'hero')),
  CONSTRAINT generation_stage_traces_status_valid
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  CONSTRAINT generation_stage_traces_timestamps_valid
    CHECK (
      (status = 'pending' AND completed_at IS NULL)
      OR (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL)
      OR (status IN ('succeeded', 'failed', 'skipped') AND completed_at IS NOT NULL)
    ),
  CONSTRAINT generation_stage_traces_failure_valid
    CHECK (
      (status = 'failed' AND failure_message IS NOT NULL)
      OR
      (status <> 'failed' AND failure_code IS NULL AND failure_message IS NULL)
    ),
  CONSTRAINT generation_stage_traces_json_shapes
    CHECK (
      jsonb_typeof(model_calls) = 'array'
      AND jsonb_typeof(candidate_images) = 'array'
      AND jsonb_typeof(attached_images) = 'array'
      AND jsonb_typeof(skipped_images) = 'array'
      AND jsonb_typeof(artifacts) = 'array'
      AND jsonb_typeof(failure_metadata) = 'object'
    )
);

CREATE INDEX idx_generation_stage_traces_generation
  ON public.generation_stage_traces(generation_id, stage);
CREATE INDEX idx_generation_stage_traces_campaign
  ON public.generation_stage_traces(campaign_id, created_at DESC);
CREATE INDEX idx_generation_stage_traces_user
  ON public.generation_stage_traces(user_id);

CREATE OR REPLACE FUNCTION public.guard_generation_stage_trace_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.status IN ('succeeded', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'terminal generation stage traces are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF (
    NEW.id,
    NEW.generation_id,
    NEW.campaign_id,
    NEW.user_id,
    NEW.stage,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.id,
    OLD.generation_id,
    OLD.campaign_id,
    OLD.user_id,
    OLD.stage,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'generation stage trace identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'pending' AND NEW.status IN ('running', 'failed', 'skipped'))
    OR (OLD.status = 'running' AND NEW.status IN ('succeeded', 'failed', 'skipped'))
  ) THEN
    RAISE EXCEPTION 'invalid generation stage trace transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER generation_stage_traces_guard_update
  BEFORE UPDATE ON public.generation_stage_traces
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_generation_stage_trace_update();

CREATE TRIGGER generation_stage_traces_updated_at
  BEFORE UPDATE ON public.generation_stage_traces
  FOR EACH ROW
  EXECUTE FUNCTION system.update_updated_at();

CREATE OR REPLACE FUNCTION public.initialize_generation_stage_traces()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.trace_schema_version IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.generation_stage_traces (
    generation_id,
    campaign_id,
    user_id,
    stage,
    status,
    completed_at,
    failure_metadata
  )
  VALUES
    (
      NEW.id,
      NEW.campaign_id,
      NEW.user_id,
      'analyze',
      CASE WHEN NEW.generation_mode = 'website_refresh' THEN 'pending' ELSE 'skipped' END,
      CASE WHEN NEW.generation_mode = 'website_refresh' THEN NULL ELSE NOW() END,
      CASE
        WHEN NEW.generation_mode = 'website_refresh' THEN '{}'::jsonb
        ELSE '{"reason":"website_refresh_not_requested"}'::jsonb
      END
    ),
    (
      NEW.id,
      NEW.campaign_id,
      NEW.user_id,
      'designer',
      CASE WHEN NEW.scenario = 'event' THEN 'skipped' ELSE 'pending' END,
      CASE WHEN NEW.scenario = 'event' THEN NOW() ELSE NULL END,
      CASE
        WHEN NEW.scenario = 'event' THEN '{"reason":"event_layout_is_deterministic"}'::jsonb
        ELSE '{}'::jsonb
      END
    ),
    (NEW.id, NEW.campaign_id, NEW.user_id, 'hero', 'pending', NULL, '{}'::jsonb);

  RETURN NEW;
END;
$$;

CREATE TRIGGER poster_generations_initialize_stage_traces
  AFTER INSERT ON public.poster_generations
  FOR EACH ROW
  EXECUTE FUNCTION public.initialize_generation_stage_traces();

CREATE OR REPLACE FUNCTION public.finalize_unreached_generation_stage_traces()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.status <> 'failed' OR OLD.status = 'failed' THEN
    RETURN NEW;
  END IF;

  UPDATE public.generation_stage_traces
  SET
    status = 'failed',
    started_at = COALESCE(started_at, NOW()),
    completed_at = NOW(),
    failure_code = COALESCE(NEW.failure_code, 'generation_failed'),
    failure_message = COALESCE(NEW.failure_message, 'Generation failed during this stage.'),
    failure_metadata = jsonb_build_object('source', 'poster_generation')
  WHERE generation_id = NEW.id
    AND stage = NEW.failure_stage
    AND status IN ('pending', 'running');

  UPDATE public.generation_stage_traces
  SET
    status = 'skipped',
    completed_at = NOW(),
    failure_metadata = jsonb_build_object(
      'reason',
      'generation_failed_before_stage',
      'failure_stage',
      NEW.failure_stage
    )
  WHERE generation_id = NEW.id
    AND status IN ('pending', 'running');

  RETURN NEW;
END;
$$;

CREATE TRIGGER poster_generations_finalize_unreached_stage_traces
  AFTER UPDATE OF status ON public.poster_generations
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.finalize_unreached_generation_stage_traces();

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
ALTER TABLE public.poster_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_stage_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY posterlytics_campaigns_owner ON public.campaigns
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY poster_generations_owner_read
  ON public.poster_generations
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY poster_generations_owner_update
  ON public.poster_generations
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY generation_stage_traces_owner_read
  ON public.generation_stage_traces
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY generation_stage_traces_owner_update
  ON public.generation_stage_traces
  FOR UPDATE TO authenticated
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
REVOKE ALL ON public.poster_generations FROM anon, authenticated;
REVOKE ALL ON public.generation_stage_traces FROM anon, authenticated;
REVOKE ALL ON public.placements FROM anon, authenticated;
REVOKE ALL ON public.scans FROM anon, authenticated;

GRANT SELECT, DELETE ON public.campaigns TO authenticated;
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
  failure_message,
  trace_incomplete
) ON public.poster_generations TO authenticated;
GRANT SELECT ON public.generation_stage_traces TO authenticated;
GRANT UPDATE (
  status,
  started_at,
  completed_at,
  model_calls,
  candidate_images,
  attached_images,
  skipped_images,
  artifacts,
  failure_code,
  failure_message,
  failure_metadata
) ON public.generation_stage_traces TO authenticated;
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

CREATE FUNCTION public.create_poster_generation(
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

CREATE FUNCTION public.complete_poster_generation(
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

CREATE FUNCTION public.activate_poster_generation(
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

REVOKE ALL ON FUNCTION public.log_visit(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_status(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.placement_stats(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.campaign_breakdowns(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_poster_generation(UUID, TEXT, JSONB, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_poster_generation(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_poster_generation(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.log_visit(TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.link_status(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.placement_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_breakdowns(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_poster_generation(UUID, TEXT, JSONB, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_poster_generation(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_poster_generation(UUID) TO authenticated;

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

-- Durable generation queue. Keep synchronized with migrations/20260717221837_durable-generation-queue.sql.
CREATE TABLE public.generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL UNIQUE
    REFERENCES public.poster_generations(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL
    REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  retry_of_job_id UUID,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL,
  color_scheme TEXT NOT NULL DEFAULT 'light',
  attempt_count SMALLINT NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_attempts SMALLINT NOT NULL DEFAULT 3,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT generation_jobs_status_valid
    CHECK (status IN ('queued', 'running', 'retrying', 'succeeded', 'failed')),
  CONSTRAINT generation_jobs_stage_valid
    CHECK (stage IN ('analyze', 'designer', 'hero')),
  CONSTRAINT generation_jobs_color_scheme_valid
    CHECK (color_scheme IN ('light', 'dark')),
  CONSTRAINT generation_jobs_attempts_valid
    CHECK (
      max_attempts = 3
      AND attempt_count BETWEEN 0 AND max_attempts
      AND retry_count >= 0
    ),
  CONSTRAINT generation_jobs_lease_valid
    CHECK (
      (
        status = 'running'
        AND lease_owner IS NOT NULL
        AND lease_expires_at IS NOT NULL
      )
      OR
      (
        status <> 'running'
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
      )
    ),
  CONSTRAINT generation_jobs_terminal_valid
    CHECK (
      (
        status IN ('succeeded', 'failed')
        AND completed_at IS NOT NULL
      )
      OR
      (
        status NOT IN ('succeeded', 'failed')
        AND completed_at IS NULL
      )
    ),
  CONSTRAINT generation_jobs_failure_valid
    CHECK (
      status <> 'failed'
      OR (
        last_error_code IS NOT NULL
        AND last_error_message IS NOT NULL
      )
    ),
  CONSTRAINT generation_jobs_campaign_generation_unique
    UNIQUE (campaign_id, generation_id),
  CONSTRAINT generation_jobs_user_generation_unique
    UNIQUE (user_id, generation_id)
);

ALTER TABLE public.generation_jobs
  ADD CONSTRAINT generation_jobs_retry_of_job_id_fkey
  FOREIGN KEY (retry_of_job_id)
  REFERENCES public.generation_jobs(id)
  ON DELETE SET NULL;

CREATE INDEX idx_generation_jobs_claimable
  ON public.generation_jobs(status, available_at, created_at)
  WHERE status IN ('queued', 'retrying');
CREATE INDEX idx_generation_jobs_expired_leases
  ON public.generation_jobs(lease_expires_at)
  WHERE status = 'running';
CREATE INDEX idx_generation_jobs_user_updated
  ON public.generation_jobs(user_id, updated_at DESC);
CREATE INDEX idx_generation_jobs_campaign_updated
  ON public.generation_jobs(campaign_id, updated_at DESC);
CREATE UNIQUE INDEX idx_generation_jobs_one_active_per_campaign
  ON public.generation_jobs(campaign_id)
  WHERE status IN ('queued', 'running', 'retrying');

CREATE TABLE public.generation_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL UNIQUE
    REFERENCES public.generation_jobs(id) ON DELETE CASCADE,
  generation_id UUID NOT NULL
    REFERENCES public.poster_generations(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL
    REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT generation_notifications_outcome_valid
    CHECK (outcome IN ('ready', 'failed')),
  CONSTRAINT generation_notifications_campaign_generation_unique
    UNIQUE (campaign_id, generation_id),
  CONSTRAINT generation_notifications_user_generation_unique
    UNIQUE (user_id, generation_id)
);

CREATE INDEX idx_generation_notifications_user_unread
  ON public.generation_notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX idx_generation_notifications_campaign_created
  ON public.generation_notifications(campaign_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.guard_generation_job_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.status IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'terminal generation jobs are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF (
    NEW.id,
    NEW.generation_id,
    NEW.campaign_id,
    NEW.user_id,
    NEW.retry_of_job_id,
    NEW.max_attempts,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.id,
    OLD.generation_id,
    OLD.campaign_id,
    OLD.user_id,
    OLD.retry_of_job_id,
    OLD.max_attempts,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'generation job identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status IN ('queued', 'retrying') AND NEW.status = 'running')
    OR (OLD.status = 'running' AND NEW.status IN ('queued', 'retrying', 'succeeded', 'failed'))
  ) THEN
    RAISE EXCEPTION 'invalid generation job status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.stage IS DISTINCT FROM OLD.stage AND NOT (
    OLD.status = 'running'
    AND NEW.status = 'queued'
    AND (
      (OLD.stage = 'analyze' AND NEW.stage IN ('designer', 'hero'))
      OR (OLD.stage = 'designer' AND NEW.stage = 'hero')
    )
  ) THEN
    RAISE EXCEPTION 'invalid generation job stage transition: % -> %', OLD.stage, NEW.stage
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER generation_jobs_guard_update
  BEFORE UPDATE ON public.generation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_generation_job_update();

CREATE TRIGGER generation_jobs_updated_at
  BEFORE UPDATE ON public.generation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION system.update_updated_at();

CREATE OR REPLACE FUNCTION public.guard_generation_notification_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF (
    NEW.id,
    NEW.job_id,
    NEW.generation_id,
    NEW.campaign_id,
    NEW.user_id,
    NEW.outcome,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.id,
    OLD.job_id,
    OLD.generation_id,
    OLD.campaign_id,
    OLD.user_id,
    OLD.outcome,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'generation notification identity and outcome are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN
    RAISE EXCEPTION 'read generation notifications cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER generation_notifications_guard_update
  BEFORE UPDATE ON public.generation_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_generation_notification_update();

CREATE OR REPLACE FUNCTION public.create_generation_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.status NOT IN ('succeeded', 'failed')
    OR OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.generation_notifications (
    job_id,
    generation_id,
    campaign_id,
    user_id,
    outcome
  )
  VALUES (
    NEW.id,
    NEW.generation_id,
    NEW.campaign_id,
    NEW.user_id,
    CASE WHEN NEW.status = 'succeeded' THEN 'ready' ELSE 'failed' END
  )
  ON CONFLICT (job_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER generation_jobs_create_notification
  AFTER UPDATE OF status ON public.generation_jobs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.create_generation_notification();

ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY generation_jobs_owner_read
  ON public.generation_jobs
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY generation_notifications_owner_read
  ON public.generation_notifications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.generation_jobs FROM anon, authenticated;
REVOKE ALL ON public.generation_notifications FROM anon, authenticated;
GRANT SELECT ON public.generation_jobs TO authenticated;
GRANT SELECT ON public.generation_notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_poster_generation(
  p_campaign_id UUID,
  p_instruction TEXT DEFAULT NULL,
  p_reference_images JSONB DEFAULT '[]'::jsonb,
  p_refresh_website BOOLEAN DEFAULT FALSE,
  p_color_scheme TEXT DEFAULT 'light'
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
      WHEN v_generation.scenario = 'event' THEN 'hero'
      ELSE 'designer'
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
      AND status IN ('created', 'analyzing', 'designing', 'painting')
  ) THEN
    RAISE EXCEPTION 'a poster generation is already active for this campaign'
      USING ERRCODE = '23505';
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
    v_previous_generation.campaign_id,
    v_previous_generation.user_id,
    v_previous_generation.parent_generation_id,
    v_previous_generation.generation_mode,
    v_previous_generation.instruction,
    v_previous_generation.reference_images,
    v_previous_generation.scenario,
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
    v_previous_generation.design_status
  )
  RETURNING * INTO v_generation;

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
    CASE
      WHEN v_generation.generation_mode = 'website_refresh' THEN 'analyze'
      WHEN v_generation.scenario = 'event' THEN 'hero'
      ELSE 'designer'
    END,
    v_previous_job.color_scheme
  )
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'generation', to_jsonb(v_generation),
    'job', to_jsonb(v_job)
  );
END;
$$;

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
  v_result JSONB;
  v_generation public.poster_generations%ROWTYPE;
BEGIN
  v_result := public.enqueue_poster_generation(
    p_campaign_id,
    p_instruction,
    p_reference_images,
    p_refresh_website,
    'light'
  );

  SELECT *
  INTO v_generation
  FROM public.poster_generations
  WHERE id = (v_result #>> '{generation,id}')::UUID;

  RETURN v_generation;
END;
$$;

CREATE OR REPLACE FUNCTION public.generation_activity(
  p_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_items JSONB;
  v_unread_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  WITH ranked AS (
    SELECT
      j.id AS job_id,
      j.generation_id,
      j.campaign_id,
      c.product_name AS campaign_name,
      j.status,
      j.stage,
      j.color_scheme,
      j.attempt_count,
      j.retry_count,
      j.max_attempts,
      j.available_at,
      j.started_at,
      j.completed_at,
      j.created_at,
      j.updated_at,
      j.last_error_code,
      j.last_error_message,
      g.status AS generation_status,
      g.version_number,
      g.generation_mode,
      g.scenario,
      g.instruction,
      g.hero_image_url,
      g.created_at AS generation_created_at,
      n.id AS notification_id,
      n.outcome AS notification_outcome,
      n.read_at,
      n.created_at AS notification_created_at,
      CASE
        WHEN j.status IN ('queued', 'running', 'retrying') THEN 0
        WHEN n.id IS NOT NULL AND n.read_at IS NULL THEN 1
        ELSE 2
      END AS activity_rank
    FROM public.generation_jobs j
    JOIN public.poster_generations g
      ON g.id = j.generation_id
      AND g.user_id = v_user_id
    JOIN public.campaigns c
      ON c.id = j.campaign_id
      AND c.user_id = v_user_id
    LEFT JOIN public.generation_notifications n
      ON n.job_id = j.id
      AND n.user_id = v_user_id
    WHERE j.user_id = v_user_id
    ORDER BY activity_rank, j.updated_at DESC
    LIMIT v_limit
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'job_id', job_id,
        'generation_id', generation_id,
        'campaign_id', campaign_id,
        'campaign_name', campaign_name,
        'status', status,
        'stage', stage,
        'color_scheme', color_scheme,
        'attempt_count', attempt_count,
        'retry_count', retry_count,
        'max_attempts', max_attempts,
        'available_at', available_at,
        'started_at', started_at,
        'completed_at', completed_at,
        'created_at', created_at,
        'updated_at', updated_at,
        'last_error_code', last_error_code,
        'last_error_message', last_error_message,
        'generation_status', generation_status,
        'version_number', version_number,
        'generation_mode', generation_mode,
        'scenario', scenario,
        'instruction', instruction,
        'hero_image_url', hero_image_url,
        'generation_created_at', generation_created_at,
        'notification_id', notification_id,
        'notification_outcome', notification_outcome,
        'read_at', read_at,
        'notification_created_at', notification_created_at
      )
      ORDER BY activity_rank, updated_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM ranked;

  SELECT COUNT(*)::INTEGER
  INTO v_unread_count
  FROM public.generation_notifications
  WHERE user_id = v_user_id
    AND read_at IS NULL;

  RETURN jsonb_build_object(
    'items', v_items,
    'unread_count', v_unread_count,
    'refreshed_at', NOW()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_generation_notifications_read(
  p_notification_ids UUID[] DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.generation_notifications
  SET read_at = NOW()
  WHERE user_id = v_user_id
    AND read_at IS NULL
    AND (
      p_notification_ids IS NULL
      OR id = ANY(p_notification_ids)
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_generation_jobs(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 2,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS SETOF public.generation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_max_concurrency CONSTANT INTEGER := 2;
  v_available_slots INTEGER;
BEGIN
  IF NULLIF(BTRIM(p_worker_id), '') IS NULL THEN
    RAISE EXCEPTION 'worker_id is required' USING ERRCODE = '22023';
  END IF;

  IF p_limit NOT BETWEEN 1 AND 8 OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'invalid claim limits' USING ERRCODE = '22023';
  END IF;

  -- Schedules may overlap while a model request is running. Serialize claims
  -- so every invocation observes the same global worker capacity.
  PERFORM pg_advisory_xact_lock(741231, 1);

  UPDATE public.generation_jobs
  SET
    status = 'retrying',
    attempt_count = GREATEST(attempt_count - 1, 0),
    retry_count = retry_count + 1,
    available_at = NOW(),
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error_code = 'worker_lease_expired',
    last_error_message = 'The worker lease expired; the stage will be resumed.'
  WHERE status = 'running'
    AND lease_expires_at <= NOW();

  SELECT GREATEST(
    v_max_concurrency - COUNT(*)::INTEGER,
    0
  )
  INTO v_available_slots
  FROM public.generation_jobs
  WHERE status = 'running';

  IF v_available_slots = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.generation_jobs
    WHERE status IN ('queued', 'retrying')
      AND available_at <= NOW()
      AND attempt_count < max_attempts
    ORDER BY available_at, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(p_limit, v_available_slots)
  )
  UPDATE public.generation_jobs j
  SET
    status = 'running',
    attempt_count = j.attempt_count + 1,
    lease_owner = p_worker_id,
    lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
    started_at = COALESCE(j.started_at, NOW())
  FROM candidates
  WHERE j.id = candidates.id
  RETURNING j.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_generation_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_next_stage TEXT DEFAULT NULL
)
RETURNS public.generation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_job public.generation_jobs%ROWTYPE;
  v_generation_status TEXT;
BEGIN
  SELECT *
  INTO v_job
  FROM public.generation_jobs
  WHERE id = p_job_id
    AND status = 'running'
    AND lease_owner = p_worker_id
    AND lease_expires_at > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active generation job lease not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_next_stage IS NULL THEN
    SELECT status
    INTO v_generation_status
    FROM public.poster_generations
    WHERE id = v_job.generation_id
      AND user_id = v_job.user_id;

    IF v_generation_status <> 'ready' THEN
      RAISE EXCEPTION 'poster generation is not ready'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.generation_jobs
    SET
      status = 'succeeded',
      lease_owner = NULL,
      lease_expires_at = NULL,
      completed_at = NOW(),
      last_error_code = NULL,
      last_error_message = NULL
    WHERE id = v_job.id
    RETURNING * INTO v_job;
  ELSE
    IF p_next_stage NOT IN ('designer', 'hero') THEN
      RAISE EXCEPTION 'invalid next stage' USING ERRCODE = '22023';
    END IF;

    UPDATE public.generation_jobs
    SET
      status = 'queued',
      stage = p_next_stage,
      attempt_count = 0,
      available_at = NOW(),
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = NULL,
      last_error_message = NULL
    WHERE id = v_job.id
    RETURNING * INTO v_job;
  END IF;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_generation_job_failure(
  p_job_id UUID,
  p_worker_id TEXT,
  p_error_code TEXT,
  p_error_message TEXT,
  p_retryable BOOLEAN
)
RETURNS public.generation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_job public.generation_jobs%ROWTYPE;
  v_error_code TEXT := COALESCE(NULLIF(BTRIM(p_error_code), ''), 'generation_stage_failed');
  v_error_message TEXT := LEFT(
    COALESCE(NULLIF(BTRIM(p_error_message), ''), 'Generation stage failed.'),
    2000
  );
  v_backoff_seconds INTEGER;
BEGIN
  SELECT *
  INTO v_job
  FROM public.generation_jobs
  WHERE id = p_job_id
    AND status = 'running'
    AND lease_owner = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active generation job lease not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_retryable AND v_job.attempt_count < v_job.max_attempts THEN
    v_backoff_seconds := LEAST(30, 5 * (2 ^ GREATEST(v_job.attempt_count - 1, 0))::INTEGER);

    UPDATE public.generation_jobs
    SET
      status = 'retrying',
      retry_count = retry_count + 1,
      available_at = NOW() + make_interval(secs => v_backoff_seconds),
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = v_error_code,
      last_error_message = v_error_message
    WHERE id = v_job.id
    RETURNING * INTO v_job;
  ELSE
    UPDATE public.poster_generations
    SET
      status = 'failed',
      failed_at = NOW(),
      failure_stage = v_job.stage,
      failure_code = v_error_code,
      failure_message = v_error_message
    WHERE id = v_job.generation_id
      AND user_id = v_job.user_id
      AND status IN ('created', 'analyzing', 'designing', 'painting');

    UPDATE public.generation_jobs
    SET
      status = 'failed',
      lease_owner = NULL,
      lease_expires_at = NULL,
      completed_at = NOW(),
      last_error_code = v_error_code,
      last_error_message = v_error_message
    WHERE id = v_job.id
    RETURNING * INTO v_job;
  END IF;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_poster_generation_for_worker(
  p_generation_id UUID,
  p_user_id UUID,
  p_hero_image_url TEXT,
  p_hero_image_key TEXT
)
RETURNS public.poster_generations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_campaign public.campaigns%ROWTYPE;
  v_generation public.poster_generations%ROWTYPE;
  v_next_version INTEGER;
  v_hero_url TEXT := NULLIF(BTRIM(p_hero_image_url), '');
  v_hero_key TEXT := NULLIF(BTRIM(p_hero_image_key), '');
BEGIN
  IF p_user_id IS NULL OR v_hero_url IS NULL OR v_hero_key IS NULL THEN
    RAISE EXCEPTION 'owner, hero image URL, and key are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_generation
  FROM public.poster_generations
  WHERE id = p_generation_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'poster generation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_generation.status = 'ready' THEN
    RETURN v_generation;
  END IF;

  IF v_generation.status <> 'painting' THEN
    RAISE EXCEPTION 'poster generation is not ready to complete'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_campaign
  FROM public.campaigns
  WHERE id = v_generation.campaign_id
    AND user_id = p_user_id
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

CREATE OR REPLACE FUNCTION public.publish_generation_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM realtime.publish(
      'generation:' || NEW.user_id::TEXT,
      'generation_activity_changed',
      jsonb_build_object(
        'job_id', NEW.id,
        'status', NEW.status,
        'stage', NEW.stage,
        'updated_at', NEW.updated_at
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'generation activity realtime publish failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

CREATE TRIGGER generation_jobs_publish_activity
  AFTER INSERT OR UPDATE OF status, stage, attempt_count, retry_count
  ON public.generation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.publish_generation_activity();

INSERT INTO realtime.channels (pattern, description, enabled)
VALUES (
  'generation:%',
  'Owner-scoped Posterlytics generation activity invalidations',
  TRUE
)
ON CONFLICT (pattern) DO UPDATE
SET
  description = EXCLUDED.description,
  enabled = EXCLUDED.enabled;

ALTER TABLE realtime.channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS posterlytics_generation_activity_subscribe
  ON realtime.channels;
CREATE POLICY posterlytics_generation_activity_subscribe
  ON realtime.channels
  FOR SELECT TO authenticated
  USING (
    pattern = 'generation:%'
    AND realtime.channel_name() = 'generation:' || (SELECT auth.uid())::TEXT
  );

REVOKE ALL ON FUNCTION public.enqueue_poster_generation(UUID, TEXT, JSONB, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retry_poster_generation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generation_activity(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_generation_notifications_read(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_generation_jobs(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_generation_job(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_generation_job_failure(UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_poster_generation_for_worker(UUID, UUID, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.enqueue_poster_generation(UUID, TEXT, JSONB, BOOLEAN, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.retry_poster_generation(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.generation_activity(INTEGER)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_generation_notifications_read(UUID[])
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.claim_generation_jobs(TEXT, INTEGER, INTEGER)
  TO project_admin;
GRANT EXECUTE ON FUNCTION public.advance_generation_job(UUID, TEXT, TEXT)
  TO project_admin;
GRANT EXECUTE ON FUNCTION public.record_generation_job_failure(UUID, TEXT, TEXT, TEXT, BOOLEAN)
  TO project_admin;
GRANT EXECUTE ON FUNCTION public.complete_poster_generation_for_worker(UUID, UUID, TEXT, TEXT)
  TO project_admin;

-- Pre-generation asset review (trace schema v2).
ALTER TABLE public.poster_generations
  ADD COLUMN asset_selection_mode TEXT,
  ADD COLUMN asset_selection_status TEXT,
  ADD COLUMN asset_selection_method TEXT,
  ADD COLUMN asset_selection_completed_at TIMESTAMPTZ;

ALTER TABLE public.poster_generations
  ALTER COLUMN trace_schema_version SET DEFAULT 2,
  DROP CONSTRAINT poster_generations_status_valid,
  DROP CONSTRAINT poster_generations_failure_stage_valid,
  DROP CONSTRAINT poster_generations_trace_schema_version_valid;

ALTER TABLE public.poster_generations
  ADD CONSTRAINT poster_generations_status_valid
    CHECK (
      status IN (
        'created',
        'analyzing',
        'reviewing',
        'designing',
        'painting',
        'ready',
        'failed',
        'canceled'
      )
    ),
  ADD CONSTRAINT poster_generations_failure_stage_valid
    CHECK (
      failure_stage IS NULL
      OR failure_stage IN ('analyze', 'assets', 'designer', 'hero', 'complete')
    ),
  ADD CONSTRAINT poster_generations_trace_schema_version_valid
    CHECK (trace_schema_version IS NULL OR trace_schema_version IN (1, 2)),
  ADD CONSTRAINT poster_generations_asset_selection_valid
    CHECK (
      (
        trace_schema_version IS DISTINCT FROM 2
        AND asset_selection_mode IS NULL
        AND asset_selection_status IS NULL
        AND asset_selection_method IS NULL
        AND asset_selection_completed_at IS NULL
      )
      OR
      (
        trace_schema_version = 2
        AND asset_selection_mode IN ('editor', 'yolo')
        AND (
          (
            asset_selection_status = 'pending'
            AND asset_selection_method IS NULL
            AND asset_selection_completed_at IS NULL
          )
          OR
          (
            asset_selection_status = 'completed'
            AND asset_selection_method IN ('user', 'ai', 'rules_fallback', 'retry_reuse')
            AND asset_selection_completed_at IS NOT NULL
          )
        )
      )
    );

DROP INDEX public.idx_poster_generations_one_active;
CREATE UNIQUE INDEX idx_poster_generations_one_active
  ON public.poster_generations(campaign_id)
  WHERE status IN ('created', 'analyzing', 'reviewing', 'designing', 'painting');

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

ALTER TABLE public.generation_stage_traces
  DROP CONSTRAINT generation_stage_traces_stage_valid,
  DROP CONSTRAINT generation_stage_traces_status_valid,
  DROP CONSTRAINT generation_stage_traces_timestamps_valid;

ALTER TABLE public.generation_stage_traces
  ADD CONSTRAINT generation_stage_traces_stage_valid
    CHECK (stage IN ('analyze', 'assets', 'designer', 'hero')),
  ADD CONSTRAINT generation_stage_traces_status_valid
    CHECK (
      status IN (
        'pending',
        'running',
        'awaiting_review',
        'succeeded',
        'failed',
        'skipped',
        'canceled'
      )
    ),
  ADD CONSTRAINT generation_stage_traces_timestamps_valid
    CHECK (
      (status = 'pending' AND completed_at IS NULL)
      OR (
        status IN ('running', 'awaiting_review')
        AND started_at IS NOT NULL
        AND completed_at IS NULL
      )
      OR (
        status IN ('succeeded', 'failed', 'skipped', 'canceled')
        AND completed_at IS NOT NULL
      )
    );

CREATE OR REPLACE FUNCTION public.guard_generation_stage_trace_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.status IN ('succeeded', 'failed', 'skipped', 'canceled') THEN
    RAISE EXCEPTION 'terminal generation stage traces are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF (
    NEW.id,
    NEW.generation_id,
    NEW.campaign_id,
    NEW.user_id,
    NEW.stage,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.id,
    OLD.generation_id,
    OLD.campaign_id,
    OLD.user_id,
    OLD.stage,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'generation stage trace identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (
      OLD.status = 'pending'
      AND NEW.status IN ('running', 'succeeded', 'failed', 'skipped', 'canceled')
    )
    OR (
      OLD.status = 'running'
      AND NEW.status IN ('awaiting_review', 'succeeded', 'failed', 'skipped', 'canceled')
    )
    OR (
      OLD.status = 'awaiting_review'
      AND NEW.status IN ('succeeded', 'canceled')
    )
  ) THEN
    RAISE EXCEPTION 'invalid generation stage trace transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.initialize_generation_stage_traces()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.trace_schema_version IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.generation_stage_traces (
    generation_id,
    campaign_id,
    user_id,
    stage,
    status,
    completed_at,
    failure_metadata
  )
  VALUES
    (
      NEW.id,
      NEW.campaign_id,
      NEW.user_id,
      'analyze',
      CASE WHEN NEW.generation_mode = 'website_refresh' THEN 'pending' ELSE 'skipped' END,
      CASE WHEN NEW.generation_mode = 'website_refresh' THEN NULL ELSE NOW() END,
      CASE
        WHEN NEW.generation_mode = 'website_refresh' THEN '{}'::jsonb
        ELSE '{"reason":"website_refresh_not_requested"}'::jsonb
      END
    ),
    (
      NEW.id,
      NEW.campaign_id,
      NEW.user_id,
      'designer',
      CASE WHEN NEW.scenario = 'event' THEN 'skipped' ELSE 'pending' END,
      CASE WHEN NEW.scenario = 'event' THEN NOW() ELSE NULL END,
      CASE
        WHEN NEW.scenario = 'event' THEN '{"reason":"event_layout_is_deterministic"}'::jsonb
        ELSE '{}'::jsonb
      END
    ),
    (
      NEW.id,
      NEW.campaign_id,
      NEW.user_id,
      'hero',
      'pending',
      NULL,
      '{}'::jsonb
    );

  IF NEW.trace_schema_version = 2 THEN
    INSERT INTO public.generation_stage_traces (
      generation_id,
      campaign_id,
      user_id,
      stage,
      status,
      failure_metadata
    )
    VALUES (
      NEW.id,
      NEW.campaign_id,
      NEW.user_id,
      'assets',
      'pending',
      '{}'::jsonb
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_unreached_generation_stage_traces()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.status <> 'failed' OR OLD.status = 'failed' THEN
    RETURN NEW;
  END IF;

  UPDATE public.generation_stage_traces
  SET
    status = 'failed',
    started_at = COALESCE(started_at, NOW()),
    completed_at = NOW(),
    failure_code = COALESCE(NEW.failure_code, 'generation_failed'),
    failure_message = COALESCE(NEW.failure_message, 'Generation failed during this stage.'),
    failure_metadata = jsonb_build_object('source', 'poster_generation')
  WHERE generation_id = NEW.id
    AND stage = NEW.failure_stage
    AND status IN ('pending', 'running', 'awaiting_review');

  UPDATE public.generation_stage_traces
  SET
    status = 'skipped',
    started_at = CASE
      WHEN status = 'awaiting_review' THEN COALESCE(started_at, NOW())
      ELSE started_at
    END,
    completed_at = NOW(),
    failure_metadata = jsonb_build_object(
      'reason',
      'generation_failed_before_stage',
      'failure_stage',
      NEW.failure_stage
    )
  WHERE generation_id = NEW.id
    AND status IN ('pending', 'running', 'awaiting_review');

  RETURN NEW;
END;
$$;

CREATE TABLE public.generation_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL
    REFERENCES public.poster_generations(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL
    REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  candidate_key TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT,
  object_key TEXT,
  filename TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  storage_source TEXT NOT NULL,
  purpose TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  availability TEXT NOT NULL,
  availability_reason TEXT,
  included BOOLEAN NOT NULL DEFAULT FALSE,
  selection_rank SMALLINT,
  selection_reason TEXT,
  candidate_position SMALLINT NOT NULL,
  provider_skips JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT generation_assets_generation_candidate_unique
    UNIQUE (generation_id, candidate_key),
  CONSTRAINT generation_assets_source_valid
    CHECK (
      source IN ('previous-poster', 'user-reference', 'logo', 'product', 'style-board')
    ),
  CONSTRAINT generation_assets_availability_valid
    CHECK (
      availability IN ('available', 'unavailable')
      AND (
        (availability = 'available' AND url IS NOT NULL)
        OR (availability = 'unavailable' AND availability_reason IS NOT NULL)
      )
    ),
  CONSTRAINT generation_assets_selection_valid
    CHECK (
      (
        included
        AND availability = 'available'
        AND selection_rank BETWEEN 1 AND 6
      )
      OR (
        NOT included
        AND selection_rank IS NULL
      )
    ),
  CONSTRAINT generation_assets_metadata_valid
    CHECK (
      jsonb_typeof(metadata) = 'object'
      AND jsonb_typeof(provider_skips) = 'array'
    ),
  CONSTRAINT generation_assets_position_valid
    CHECK (candidate_position > 0),
  CONSTRAINT generation_assets_size_valid
    CHECK (size_bytes IS NULL OR size_bytes >= 0)
);

CREATE INDEX idx_generation_assets_generation
  ON public.generation_assets(generation_id, candidate_position);
CREATE INDEX idx_generation_assets_user
  ON public.generation_assets(user_id, created_at DESC);
CREATE UNIQUE INDEX idx_generation_assets_selected_rank
  ON public.generation_assets(generation_id, selection_rank)
  WHERE selection_rank IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_generation_asset_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_selection_status TEXT;
BEGIN
  SELECT asset_selection_status
  INTO v_selection_status
  FROM public.poster_generations
  WHERE id = COALESCE(NEW.generation_id, OLD.generation_id);

  IF TG_OP = 'INSERT' THEN
    IF v_selection_status <> 'pending' THEN
      RAISE EXCEPTION 'completed generation asset selections are immutable'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_selection_status = 'completed' THEN
      RAISE EXCEPTION 'completed generation asset selections are immutable'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF (
    NEW.id,
    NEW.generation_id,
    NEW.campaign_id,
    NEW.user_id,
    NEW.candidate_key,
    NEW.source,
    NEW.url,
    NEW.object_key,
    NEW.filename,
    NEW.mime_type,
    NEW.size_bytes,
    NEW.storage_source,
    NEW.purpose,
    NEW.metadata,
    NEW.availability,
    NEW.availability_reason,
    NEW.candidate_position,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.id,
    OLD.generation_id,
    OLD.campaign_id,
    OLD.user_id,
    OLD.candidate_key,
    OLD.source,
    OLD.url,
    OLD.object_key,
    OLD.filename,
    OLD.mime_type,
    OLD.size_bytes,
    OLD.storage_source,
    OLD.purpose,
    OLD.metadata,
    OLD.availability,
    OLD.availability_reason,
    OLD.candidate_position,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'generation asset candidate identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF v_selection_status = 'completed'
    AND (
      NEW.included,
      NEW.selection_rank,
      NEW.selection_reason
    ) IS DISTINCT FROM (
      OLD.included,
      OLD.selection_rank,
      OLD.selection_reason
    ) THEN
    RAISE EXCEPTION 'completed generation asset selections are immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER generation_assets_guard_insert
  BEFORE INSERT ON public.generation_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_generation_asset_mutation();

CREATE TRIGGER generation_assets_guard_update
  BEFORE UPDATE ON public.generation_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_generation_asset_mutation();

CREATE TRIGGER generation_assets_guard_delete
  BEFORE DELETE ON public.generation_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_generation_asset_mutation();

CREATE TRIGGER generation_assets_updated_at
  BEFORE UPDATE ON public.generation_assets
  FOR EACH ROW
  EXECUTE FUNCTION system.update_updated_at();

ALTER TABLE public.generation_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY generation_assets_owner_read
  ON public.generation_assets
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.generation_assets FROM anon, authenticated;
GRANT SELECT ON public.generation_assets TO authenticated;

ALTER TABLE public.generation_jobs
  DROP CONSTRAINT generation_jobs_status_valid,
  DROP CONSTRAINT generation_jobs_stage_valid,
  DROP CONSTRAINT generation_jobs_terminal_valid;

ALTER TABLE public.generation_jobs
  ADD CONSTRAINT generation_jobs_status_valid
    CHECK (
      status IN (
        'queued',
        'running',
        'retrying',
        'awaiting_review',
        'succeeded',
        'failed',
        'canceled'
      )
    ),
  ADD CONSTRAINT generation_jobs_stage_valid
    CHECK (stage IN ('analyze', 'assets', 'designer', 'hero')),
  ADD CONSTRAINT generation_jobs_terminal_valid
    CHECK (
      (
        status IN ('succeeded', 'failed', 'canceled')
        AND completed_at IS NOT NULL
      )
      OR
      (
        status NOT IN ('succeeded', 'failed', 'canceled')
        AND completed_at IS NULL
      )
    );

DROP INDEX public.idx_generation_jobs_one_active_per_campaign;
CREATE UNIQUE INDEX idx_generation_jobs_one_active_per_campaign
  ON public.generation_jobs(campaign_id)
  WHERE status IN ('queued', 'running', 'retrying', 'awaiting_review');

CREATE OR REPLACE FUNCTION public.guard_generation_job_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.status IN ('succeeded', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'terminal generation jobs are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF (
    NEW.id,
    NEW.generation_id,
    NEW.campaign_id,
    NEW.user_id,
    NEW.retry_of_job_id,
    NEW.max_attempts,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.id,
    OLD.generation_id,
    OLD.campaign_id,
    OLD.user_id,
    OLD.retry_of_job_id,
    OLD.max_attempts,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'generation job identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status IN ('queued', 'retrying') AND NEW.status = 'running')
    OR (
      OLD.status = 'running'
      AND NEW.status IN (
        'queued',
        'retrying',
        'awaiting_review',
        'succeeded',
        'failed',
        'canceled'
      )
    )
    OR (OLD.status = 'awaiting_review' AND NEW.status IN ('queued', 'canceled'))
  ) THEN
    RAISE EXCEPTION 'invalid generation job status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.stage IS DISTINCT FROM OLD.stage AND NOT (
    (
      OLD.status = 'running'
      AND NEW.status = 'queued'
      AND (
        (OLD.stage = 'analyze' AND NEW.stage = 'assets')
        OR (OLD.stage = 'assets' AND NEW.stage IN ('designer', 'hero'))
        OR (OLD.stage = 'designer' AND NEW.stage = 'hero')
      )
    )
    OR (
      OLD.status = 'awaiting_review'
      AND OLD.stage = 'assets'
      AND NEW.status = 'queued'
      AND NEW.stage IN ('designer', 'hero')
    )
  ) THEN
    RAISE EXCEPTION 'invalid generation job stage transition: % -> %', OLD.stage, NEW.stage
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generation_asset_trace_assets(
  p_generation_id UUID,
  p_included_only BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'asset_id', a.id,
        'source', a.source,
        'purpose', a.purpose,
        'url', a.url,
        'key', a.object_key,
        'filename', a.filename,
        'mime_type', a.mime_type,
        'size_bytes', a.size_bytes,
        'storage_source', a.storage_source,
        'candidate_position', a.candidate_position,
        'model_position', CASE WHEN a.included THEN a.selection_rank ELSE NULL END
      )
      ORDER BY
        CASE WHEN p_included_only THEN a.selection_rank ELSE a.candidate_position END
    ),
    '[]'::jsonb
  )
  FROM public.generation_assets a
  WHERE a.generation_id = p_generation_id
    AND (NOT p_included_only OR a.included);
$$;

CREATE OR REPLACE FUNCTION public.generation_asset_trace_skips(
  p_generation_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'asset',
        jsonb_build_object(
          'asset_id', a.id,
          'source', a.source,
          'purpose', a.purpose,
          'url', a.url,
          'key', a.object_key,
          'filename', a.filename,
          'mime_type', a.mime_type,
          'size_bytes', a.size_bytes,
          'storage_source', a.storage_source,
          'candidate_position', a.candidate_position,
          'model_position', NULL
        ),
        'reason', COALESCE(a.availability_reason, 'fetch_failed'),
        'detail', COALESCE(a.availability_reason, 'Candidate was unavailable during preparation.')
      )
      ORDER BY a.candidate_position
    ),
    '[]'::jsonb
  )
  FROM public.generation_assets a
  WHERE a.generation_id = p_generation_id
    AND a.availability = 'unavailable';
$$;

CREATE OR REPLACE FUNCTION public.replace_generation_assets_for_worker(
  p_generation_id UUID,
  p_user_id UUID,
  p_assets JSONB
)
RETURNS SETOF public.generation_assets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_generation public.poster_generations%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
    OR jsonb_typeof(COALESCE(p_assets, 'null'::jsonb)) <> 'array'
    OR jsonb_array_length(p_assets) > 50 THEN
    RAISE EXCEPTION 'owner and an asset array with at most 50 items are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_generation
  FROM public.poster_generations
  WHERE id = p_generation_id
    AND user_id = p_user_id
    AND trace_schema_version = 2
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'poster generation not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_generation.asset_selection_status <> 'pending' THEN
    RAISE EXCEPTION 'completed generation assets cannot be replaced'
      USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.generation_assets
  WHERE generation_id = v_generation.id;

  INSERT INTO public.generation_assets (
    id,
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
    COALESCE(NULLIF(item ->> 'id', '')::UUID, gen_random_uuid()),
    v_generation.id,
    v_generation.campaign_id,
    v_generation.user_id,
    LEFT(item ->> 'candidate_key', 500),
    item ->> 'source',
    NULLIF(item ->> 'url', ''),
    NULLIF(item ->> 'key', ''),
    NULLIF(LEFT(item ->> 'filename', 500), ''),
    NULLIF(LEFT(item ->> 'mime_type', 200), ''),
    NULLIF(item ->> 'size_bytes', '')::BIGINT,
    LEFT(COALESCE(NULLIF(item ->> 'storage_source', ''), 'external-url'), 200),
    LEFT(COALESCE(NULLIF(item ->> 'purpose', ''), 'Generation image input.'), 2000),
    CASE
      WHEN jsonb_typeof(item -> 'metadata') = 'object' THEN item -> 'metadata'
      ELSE '{}'::jsonb
    END,
    item ->> 'availability',
    NULLIF(LEFT(item ->> 'availability_reason', 1000), ''),
    COALESCE((item ->> 'included')::BOOLEAN, FALSE),
    NULLIF(item ->> 'selection_rank', '')::SMALLINT,
    NULLIF(LEFT(item ->> 'selection_reason', 1000), ''),
    (item ->> 'candidate_position')::SMALLINT
  FROM jsonb_array_elements(p_assets) AS candidate(item);

  RETURN QUERY
  SELECT *
  FROM public.generation_assets
  WHERE generation_id = v_generation.id
  ORDER BY candidate_position;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_generation_asset_ids(
  p_generation_id UUID,
  p_asset_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ids UUID[] := COALESCE(p_asset_ids, ARRAY[]::UUID[]);
  v_distinct_count INTEGER;
  v_available_count INTEGER;
BEGIN
  IF cardinality(v_ids) > 6 THEN
    RAISE EXCEPTION 'at most six generation assets may be selected'
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(DISTINCT id)::INTEGER
  INTO v_distinct_count
  FROM unnest(v_ids) AS selected(id);

  IF v_distinct_count <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'generation asset selection contains duplicate ids'
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_available_count
  FROM public.generation_assets
  WHERE generation_id = p_generation_id
    AND availability = 'available'
    AND id = ANY(v_ids);

  IF v_available_count <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'generation asset selection contains unavailable or unknown ids'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_generation_asset_selection(
  p_generation_id UUID,
  p_asset_ids UUID[],
  p_reasons JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ids UUID[] := COALESCE(p_asset_ids, ARRAY[]::UUID[]);
BEGIN
  PERFORM public.validate_generation_asset_ids(p_generation_id, v_ids);

  UPDATE public.generation_assets a
  SET
    included = a.id = ANY(v_ids),
    selection_rank = (
      SELECT selected.ordinality::SMALLINT
      FROM unnest(v_ids) WITH ORDINALITY AS selected(id, ordinality)
      WHERE selected.id = a.id
    ),
    selection_reason = COALESCE(
      NULLIF(LEFT(p_reasons ->> a.id::TEXT, 1000), ''),
      CASE
        WHEN a.availability = 'unavailable' THEN a.availability_reason
        WHEN a.id = ANY(v_ids) THEN 'Selected for generation.'
        ELSE 'Excluded from generation.'
      END
    )
  WHERE a.generation_id = p_generation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_generation_asset_selection(
  p_generation_id UUID,
  p_asset_ids UUID[]
)
RETURNS SETOF public.generation_assets
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
    AND asset_selection_mode = 'editor'
    AND asset_selection_status = 'pending'
    AND status = 'reviewing'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'pending generation asset review not found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.generation_jobs
  WHERE generation_id = v_generation.id
    AND user_id = v_user_id
    AND status = 'awaiting_review'
    AND stage = 'assets'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'generation is not awaiting asset review'
      USING ERRCODE = '23514';
  END IF;

  PERFORM public.apply_generation_asset_selection(
    v_generation.id,
    COALESCE(p_asset_ids, ARRAY[]::UUID[]),
    '{}'::jsonb
  );

  RETURN QUERY
  SELECT *
  FROM public.generation_assets
  WHERE generation_id = v_generation.id
  ORDER BY included DESC, selection_rank NULLS LAST, candidate_position;
END;
$$;

CREATE OR REPLACE FUNCTION public.pause_generation_for_asset_review(
  p_job_id UUID,
  p_worker_id TEXT
)
RETURNS public.generation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_job public.generation_jobs%ROWTYPE;
BEGIN
  SELECT *
  INTO v_job
  FROM public.generation_jobs
  WHERE id = p_job_id
    AND status = 'running'
    AND stage = 'assets'
    AND lease_owner = p_worker_id
    AND lease_expires_at > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active asset preparation lease not found'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.poster_generations
  SET status = 'reviewing'
  WHERE id = v_job.generation_id
    AND user_id = v_job.user_id
    AND asset_selection_mode = 'editor'
    AND asset_selection_status = 'pending'
    AND status IN ('created', 'analyzing');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'editor generation cannot enter review'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.generation_stage_traces
  SET
    status = 'awaiting_review',
    started_at = COALESCE(started_at, NOW()),
    failure_metadata = jsonb_build_object(
      'selection_mode',
      'editor',
      'candidate_count',
      (SELECT COUNT(*) FROM public.generation_assets WHERE generation_id = v_job.generation_id)
    )
  WHERE generation_id = v_job.generation_id
    AND stage = 'assets'
    AND status = 'running';

  UPDATE public.generation_jobs
  SET
    status = 'awaiting_review',
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error_code = NULL,
    last_error_message = NULL
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_generation_asset_selection_for_worker(
  p_generation_id UUID,
  p_user_id UUID,
  p_asset_ids UUID[],
  p_reasons JSONB,
  p_method TEXT
)
RETURNS public.poster_generations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_generation public.poster_generations%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_method NOT IN ('ai', 'rules_fallback') THEN
    RAISE EXCEPTION 'valid owner and Yolo selection method are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_generation
  FROM public.poster_generations
  WHERE id = p_generation_id
    AND user_id = p_user_id
    AND trace_schema_version = 2
    AND asset_selection_mode = 'yolo'
    AND asset_selection_status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'pending Yolo generation selection not found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.apply_generation_asset_selection(
    v_generation.id,
    COALESCE(p_asset_ids, ARRAY[]::UUID[]),
    CASE WHEN jsonb_typeof(p_reasons) = 'object' THEN p_reasons ELSE '{}'::jsonb END
  );

  UPDATE public.poster_generations
  SET
    asset_selection_status = 'completed',
    asset_selection_method = p_method,
    asset_selection_completed_at = NOW()
  WHERE id = v_generation.id
  RETURNING * INTO v_generation;

  UPDATE public.generation_stage_traces
  SET
    candidate_images = public.generation_asset_trace_assets(v_generation.id, FALSE),
    attached_images = public.generation_asset_trace_assets(v_generation.id, TRUE),
    skipped_images = public.generation_asset_trace_skips(v_generation.id),
    failure_metadata = jsonb_build_object(
      'selection_mode',
      'yolo',
      'selection_method',
      p_method,
      'selected_count',
      cardinality(COALESCE(p_asset_ids, ARRAY[]::UUID[]))
    )
  WHERE generation_id = v_generation.id
    AND stage = 'assets'
    AND status = 'running';

  RETURN v_generation;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_generation_asset_selection(
  p_generation_id UUID,
  p_asset_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_generation public.poster_generations%ROWTYPE;
  v_job public.generation_jobs%ROWTYPE;
  v_ids UUID[] := COALESCE(p_asset_ids, ARRAY[]::UUID[]);
  v_next_stage TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_generation
  FROM public.poster_generations
  WHERE id = p_generation_id
    AND user_id = v_user_id
    AND asset_selection_mode = 'editor'
    AND asset_selection_status = 'pending'
    AND status = 'reviewing'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'pending generation asset review not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_job
  FROM public.generation_jobs
  WHERE generation_id = v_generation.id
    AND user_id = v_user_id
    AND status = 'awaiting_review'
    AND stage = 'assets'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'generation is not awaiting asset review'
      USING ERRCODE = '23514';
  END IF;

  PERFORM public.apply_generation_asset_selection(
    v_generation.id,
    v_ids,
    '{}'::jsonb
  );

  UPDATE public.generation_assets
  SET selection_reason = CASE
    WHEN availability = 'unavailable' THEN availability_reason
    WHEN included THEN 'Included by the editor.'
    ELSE 'Excluded by the editor.'
  END
  WHERE generation_id = v_generation.id;

  UPDATE public.poster_generations
  SET
    asset_selection_status = 'completed',
    asset_selection_method = 'user',
    asset_selection_completed_at = NOW()
  WHERE id = v_generation.id
  RETURNING * INTO v_generation;

  UPDATE public.generation_stage_traces
  SET
    status = 'succeeded',
    completed_at = NOW(),
    candidate_images = public.generation_asset_trace_assets(v_generation.id, FALSE),
    attached_images = public.generation_asset_trace_assets(v_generation.id, TRUE),
    skipped_images = public.generation_asset_trace_skips(v_generation.id),
    failure_metadata = jsonb_build_object(
      'selection_mode',
      'editor',
      'selection_method',
      'user',
      'selected_count',
      cardinality(v_ids),
      'zero_selection',
      cardinality(v_ids) = 0
    )
  WHERE generation_id = v_generation.id
    AND stage = 'assets'
    AND status = 'awaiting_review';

  v_next_stage := CASE
    WHEN v_generation.scenario = 'event' THEN 'hero'
    ELSE 'designer'
  END;

  UPDATE public.generation_jobs
  SET
    status = 'queued',
    stage = v_next_stage,
    attempt_count = 0,
    available_at = NOW(),
    last_error_code = NULL,
    last_error_message = NULL
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'generation', to_jsonb(v_generation),
    'job', to_jsonb(v_job),
    'assets',
    (
      SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.candidate_position), '[]'::jsonb)
      FROM public.generation_assets a
      WHERE a.generation_id = v_generation.id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_generation_asset_review(
  p_generation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_generation public.poster_generations%ROWTYPE;
  v_job public.generation_jobs%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_generation
  FROM public.poster_generations
  WHERE id = p_generation_id
    AND user_id = v_user_id
    AND status = 'reviewing'
    AND asset_selection_mode = 'editor'
    AND asset_selection_status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'pending generation asset review not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_job
  FROM public.generation_jobs
  WHERE generation_id = v_generation.id
    AND user_id = v_user_id
    AND status = 'awaiting_review'
    AND stage = 'assets'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'generation is not awaiting asset review'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.poster_generations
  SET status = 'canceled'
  WHERE id = v_generation.id
  RETURNING * INTO v_generation;

  UPDATE public.generation_stage_traces
  SET
    status = 'canceled',
    started_at = CASE
      WHEN status = 'awaiting_review' THEN COALESCE(started_at, NOW())
      ELSE started_at
    END,
    completed_at = NOW(),
    failure_metadata = jsonb_build_object('reason', 'canceled_by_owner')
  WHERE generation_id = v_generation.id
    AND status IN ('pending', 'running', 'awaiting_review');

  UPDATE public.generation_jobs
  SET
    status = 'canceled',
    completed_at = NOW(),
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error_code = NULL,
    last_error_message = NULL
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'generation', to_jsonb(v_generation),
    'job', to_jsonb(v_job)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_generation_asset_provider_skips(
  p_generation_id UUID,
  p_stage TEXT,
  p_skips JSONB,
  p_user_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_authenticated_user UUID := auth.uid();
  v_owner UUID := COALESCE(v_authenticated_user, p_user_id);
  v_skip JSONB;
  v_count INTEGER := 0;
BEGIN
  IF v_owner IS NULL
    OR (
      v_authenticated_user IS NOT NULL
      AND p_user_id IS NOT NULL
      AND p_user_id <> v_authenticated_user
    )
    OR p_stage NOT IN ('designer', 'hero')
    OR jsonb_typeof(COALESCE(p_skips, 'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'valid owner, provider stage, and skips array are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.poster_generations
  WHERE id = p_generation_id
    AND user_id = v_owner
    AND asset_selection_status = 'completed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'completed generation asset selection not found'
      USING ERRCODE = 'P0002';
  END IF;

  FOR v_skip IN SELECT value FROM jsonb_array_elements(p_skips)
  LOOP
    UPDATE public.generation_assets
    SET provider_skips = provider_skips || jsonb_build_array(
      jsonb_build_object(
        'stage', p_stage,
        'reason', COALESCE(v_skip ->> 'reason', 'fetch_failed'),
        'detail', LEFT(COALESCE(v_skip ->> 'detail', 'Selected asset was skipped.'), 1000),
        'recorded_at', NOW()
      )
    )
    WHERE id = NULLIF(v_skip #>> '{asset,asset_id}', '')::UUID
      AND generation_id = p_generation_id
      AND user_id = v_owner
      AND included;

    v_count := v_count + CASE WHEN FOUND THEN 1 ELSE 0 END;
  END LOOP;

  RETURN v_count;
END;
$$;

DROP FUNCTION public.enqueue_poster_generation(UUID, TEXT, JSONB, BOOLEAN, TEXT);

CREATE FUNCTION public.enqueue_poster_generation(
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
    v_previous_generation.scenario,
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
  v_result JSONB;
  v_generation public.poster_generations%ROWTYPE;
BEGIN
  v_result := public.enqueue_poster_generation(
    p_campaign_id,
    p_instruction,
    p_reference_images,
    p_refresh_website,
    'light',
    'yolo'
  );

  SELECT *
  INTO v_generation
  FROM public.poster_generations
  WHERE id = (v_result #>> '{generation,id}')::UUID;

  RETURN v_generation;
END;
$$;

CREATE OR REPLACE FUNCTION public.generation_activity(
  p_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_items JSONB;
  v_unread_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  WITH ranked AS (
    SELECT
      j.id AS job_id,
      j.generation_id,
      j.campaign_id,
      c.product_name AS campaign_name,
      j.status,
      j.stage,
      j.color_scheme,
      j.attempt_count,
      j.retry_count,
      j.max_attempts,
      j.available_at,
      j.started_at,
      j.completed_at,
      j.created_at,
      j.updated_at,
      j.last_error_code,
      j.last_error_message,
      g.status AS generation_status,
      g.version_number,
      g.generation_mode,
      g.scenario,
      g.instruction,
      g.hero_image_url,
      g.asset_selection_mode,
      g.asset_selection_status,
      g.asset_selection_method,
      g.asset_selection_completed_at,
      g.created_at AS generation_created_at,
      n.id AS notification_id,
      n.outcome AS notification_outcome,
      n.read_at,
      n.created_at AS notification_created_at,
      CASE
        WHEN j.status IN ('queued', 'running', 'retrying', 'awaiting_review') THEN 0
        WHEN n.id IS NOT NULL AND n.read_at IS NULL THEN 1
        ELSE 2
      END AS activity_rank
    FROM public.generation_jobs j
    JOIN public.poster_generations g
      ON g.id = j.generation_id
      AND g.user_id = v_user_id
    JOIN public.campaigns c
      ON c.id = j.campaign_id
      AND c.user_id = v_user_id
    LEFT JOIN public.generation_notifications n
      ON n.job_id = j.id
      AND n.user_id = v_user_id
    WHERE j.user_id = v_user_id
    ORDER BY activity_rank, j.updated_at DESC
    LIMIT v_limit
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'job_id', job_id,
        'generation_id', generation_id,
        'campaign_id', campaign_id,
        'campaign_name', campaign_name,
        'status', status,
        'stage', stage,
        'color_scheme', color_scheme,
        'attempt_count', attempt_count,
        'retry_count', retry_count,
        'max_attempts', max_attempts,
        'available_at', available_at,
        'started_at', started_at,
        'completed_at', completed_at,
        'created_at', created_at,
        'updated_at', updated_at,
        'last_error_code', last_error_code,
        'last_error_message', last_error_message,
        'generation_status', generation_status,
        'version_number', version_number,
        'generation_mode', generation_mode,
        'scenario', scenario,
        'instruction', instruction,
        'hero_image_url', hero_image_url,
        'asset_selection_mode', asset_selection_mode,
        'asset_selection_status', asset_selection_status,
        'asset_selection_method', asset_selection_method,
        'asset_selection_completed_at', asset_selection_completed_at,
        'generation_created_at', generation_created_at,
        'notification_id', notification_id,
        'notification_outcome', notification_outcome,
        'read_at', read_at,
        'notification_created_at', notification_created_at
      )
      ORDER BY activity_rank, updated_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM ranked;

  SELECT COUNT(*)::INTEGER
  INTO v_unread_count
  FROM public.generation_notifications
  WHERE user_id = v_user_id
    AND read_at IS NULL;

  RETURN jsonb_build_object(
    'items', v_items,
    'unread_count', v_unread_count,
    'refreshed_at', NOW()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_generation_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_next_stage TEXT DEFAULT NULL
)
RETURNS public.generation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_job public.generation_jobs%ROWTYPE;
  v_generation_status TEXT;
BEGIN
  SELECT *
  INTO v_job
  FROM public.generation_jobs
  WHERE id = p_job_id
    AND status = 'running'
    AND lease_owner = p_worker_id
    AND lease_expires_at > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active generation job lease not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_next_stage IS NULL THEN
    SELECT status
    INTO v_generation_status
    FROM public.poster_generations
    WHERE id = v_job.generation_id
      AND user_id = v_job.user_id;

    IF v_generation_status <> 'ready' THEN
      RAISE EXCEPTION 'poster generation is not ready'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.generation_jobs
    SET
      status = 'succeeded',
      lease_owner = NULL,
      lease_expires_at = NULL,
      completed_at = NOW(),
      last_error_code = NULL,
      last_error_message = NULL
    WHERE id = v_job.id
    RETURNING * INTO v_job;
  ELSE
    IF p_next_stage NOT IN ('assets', 'designer', 'hero') THEN
      RAISE EXCEPTION 'invalid next stage' USING ERRCODE = '22023';
    END IF;

    UPDATE public.generation_jobs
    SET
      status = 'queued',
      stage = p_next_stage,
      attempt_count = 0,
      available_at = NOW(),
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = NULL,
      last_error_message = NULL
    WHERE id = v_job.id
    RETURNING * INTO v_job;
  END IF;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_generation_job_failure(
  p_job_id UUID,
  p_worker_id TEXT,
  p_error_code TEXT,
  p_error_message TEXT,
  p_retryable BOOLEAN
)
RETURNS public.generation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_job public.generation_jobs%ROWTYPE;
  v_error_code TEXT := COALESCE(NULLIF(BTRIM(p_error_code), ''), 'generation_stage_failed');
  v_error_message TEXT := LEFT(
    COALESCE(NULLIF(BTRIM(p_error_message), ''), 'Generation stage failed.'),
    2000
  );
  v_backoff_seconds INTEGER;
BEGIN
  SELECT *
  INTO v_job
  FROM public.generation_jobs
  WHERE id = p_job_id
    AND status = 'running'
    AND lease_owner = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active generation job lease not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_retryable AND v_job.attempt_count < v_job.max_attempts THEN
    v_backoff_seconds := LEAST(30, 5 * (2 ^ GREATEST(v_job.attempt_count - 1, 0))::INTEGER);

    UPDATE public.generation_jobs
    SET
      status = 'retrying',
      retry_count = retry_count + 1,
      available_at = NOW() + make_interval(secs => v_backoff_seconds),
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = v_error_code,
      last_error_message = v_error_message
    WHERE id = v_job.id
    RETURNING * INTO v_job;
  ELSE
    UPDATE public.poster_generations
    SET
      status = 'failed',
      failed_at = NOW(),
      failure_stage = v_job.stage,
      failure_code = v_error_code,
      failure_message = v_error_message
    WHERE id = v_job.generation_id
      AND user_id = v_job.user_id
      AND status IN ('created', 'analyzing', 'reviewing', 'designing', 'painting');

    UPDATE public.generation_jobs
    SET
      status = 'failed',
      lease_owner = NULL,
      lease_expires_at = NULL,
      completed_at = NOW(),
      last_error_code = v_error_code,
      last_error_message = v_error_message
    WHERE id = v_job.id
    RETURNING * INTO v_job;
  END IF;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.generation_asset_trace_assets(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generation_asset_trace_skips(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_generation_asset_ids(UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_generation_asset_selection(UUID, UUID[], JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_generation_assets_for_worker(UUID, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pause_generation_for_asset_review(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_generation_asset_selection_for_worker(UUID, UUID, UUID[], JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_generation_asset_selection(UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_generation_asset_selection(UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_generation_asset_review(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_generation_asset_provider_skips(UUID, TEXT, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_poster_generation(UUID, TEXT, JSONB, BOOLEAN, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.save_generation_asset_selection(UUID, UUID[])
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_generation_asset_selection(UUID, UUID[])
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_generation_asset_review(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_generation_asset_provider_skips(UUID, TEXT, JSONB, UUID)
  TO authenticated, project_admin;
GRANT EXECUTE ON FUNCTION public.enqueue_poster_generation(UUID, TEXT, JSONB, BOOLEAN, TEXT, TEXT)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.generation_asset_trace_assets(UUID, BOOLEAN)
  TO project_admin;
GRANT EXECUTE ON FUNCTION public.generation_asset_trace_skips(UUID)
  TO project_admin;
GRANT EXECUTE ON FUNCTION public.validate_generation_asset_ids(UUID, UUID[])
  TO project_admin;
GRANT EXECUTE ON FUNCTION public.apply_generation_asset_selection(UUID, UUID[], JSONB)
  TO project_admin;
GRANT EXECUTE ON FUNCTION public.replace_generation_assets_for_worker(UUID, UUID, JSONB)
  TO project_admin;
GRANT EXECUTE ON FUNCTION public.pause_generation_for_asset_review(UUID, TEXT)
  TO project_admin;
GRANT EXECUTE ON FUNCTION public.complete_generation_asset_selection_for_worker(UUID, UUID, UUID[], JSONB, TEXT)
  TO project_admin;

CREATE OR REPLACE FUNCTION public.generation_asset_trace_skips(
  p_generation_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'asset',
        jsonb_build_object(
          'asset_id', a.id,
          'source', a.source,
          'purpose', a.purpose,
          'url', a.url,
          'key', a.object_key,
          'filename', a.filename,
          'mime_type', a.mime_type,
          'size_bytes', a.size_bytes,
          'storage_source', a.storage_source,
          'candidate_position', a.candidate_position,
          'model_position', NULL
        ),
        'reason',
        CASE
          WHEN COALESCE(a.availability_reason, '') ~* 'unsupported'
            THEN 'unsupported_format'
          WHEN COALESCE(a.availability_reason, '') ~* 'empty'
            THEN 'empty_image'
          WHEN COALESCE(a.availability_reason, '') ~* 'exceeds|too large'
            THEN 'image_too_large'
          ELSE 'fetch_failed'
        END,
        'detail',
        COALESCE(a.availability_reason, 'Candidate was unavailable during preparation.')
      )
      ORDER BY a.candidate_position
    ),
    '[]'::jsonb
  )
  FROM public.generation_assets a
  WHERE a.generation_id = p_generation_id
    AND a.availability = 'unavailable';
$$;
