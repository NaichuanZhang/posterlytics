CREATE TABLE public.capture_preview_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_capture_preview_attempts_user_attempted_at
  ON public.capture_preview_attempts(user_id, attempted_at);

ALTER TABLE public.capture_preview_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.capture_preview_attempts
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.consume_capture_preview_quota()
RETURNS TABLE (
  allowed BOOLEAN,
  retry_after_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_now TIMESTAMPTZ := clock_timestamp();
  v_short_count BIGINT;
  v_daily_count BIGINT;
  v_short_oldest TIMESTAMPTZ;
  v_daily_oldest TIMESTAMPTZ;
  v_retry_at TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- The transaction-scoped lock serializes this user's prune, count, and insert.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::TEXT, 0)
  );

  DELETE FROM public.capture_preview_attempts
  WHERE user_id = v_user_id
    AND attempted_at <= v_now - INTERVAL '24 hours';

  SELECT
    COUNT(*) FILTER (
      WHERE attempted_at > v_now - INTERVAL '10 minutes'
    ),
    COUNT(*),
    MIN(attempted_at) FILTER (
      WHERE attempted_at > v_now - INTERVAL '10 minutes'
    ),
    MIN(attempted_at)
  INTO
    v_short_count,
    v_daily_count,
    v_short_oldest,
    v_daily_oldest
  FROM public.capture_preview_attempts
  WHERE user_id = v_user_id
    AND attempted_at > v_now - INTERVAL '24 hours';

  IF v_short_count < 6 AND v_daily_count < 30 THEN
    INSERT INTO public.capture_preview_attempts (user_id, attempted_at)
    VALUES (v_user_id, v_now);

    RETURN QUERY SELECT TRUE, 0;
    RETURN;
  END IF;

  v_retry_at := v_now;
  IF v_short_count >= 6 THEN
    v_retry_at := GREATEST(
      v_retry_at,
      v_short_oldest + INTERVAL '10 minutes'
    );
  END IF;
  IF v_daily_count >= 30 THEN
    v_retry_at := GREATEST(
      v_retry_at,
      v_daily_oldest + INTERVAL '24 hours'
    );
  END IF;

  RETURN QUERY
  SELECT
    FALSE,
    GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (v_retry_at - v_now)))::INTEGER
    );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_capture_preview_quota() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_capture_preview_quota()
  TO authenticated;
