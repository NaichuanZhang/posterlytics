ALTER TABLE public.poster_generations
  ADD COLUMN trace_schema_version SMALLINT,
  ADD COLUMN trace_incomplete BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.poster_generations
  ALTER COLUMN trace_schema_version SET DEFAULT 1;

ALTER TABLE public.poster_generations
  ADD CONSTRAINT poster_generations_trace_schema_version_valid
  CHECK (trace_schema_version IS NULL OR trace_schema_version = 1);

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
    (
      NEW.id,
      NEW.campaign_id,
      NEW.user_id,
      'hero',
      'pending',
      NULL,
      '{}'::jsonb
    );

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

ALTER TABLE public.generation_stage_traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY generation_stage_traces_owner_read
  ON public.generation_stage_traces
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY generation_stage_traces_owner_update
  ON public.generation_stage_traces
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.generation_stage_traces FROM anon, authenticated;
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

GRANT UPDATE (trace_incomplete)
  ON public.poster_generations TO authenticated;
