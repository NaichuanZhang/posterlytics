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
