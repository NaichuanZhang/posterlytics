-- Campaign source URL list (unified-creation item 5).
--
-- The unified creation screen accepts more than one analyzer URL, but capture
-- stays single-source: /capture takes one scalar url with no container
-- concurrency limiter, edge functions have no image compositor to merge N style
-- boards, and screenshot_url/screenshot_key plus the eager-capture triple are all
-- scalar. So this migration persists the LIST while only source_urls[0] is ever
-- fetched or captured; URLs 2-3 contribute declared textual context.
--
-- product_url remains source_urls[0] and stays the per-generation source of
-- record. No column is added to poster_generations: analyze already SELECTs the
-- campaign row, and extending the frozen tuple would invalidate the pinned
-- guard_poster_generation_update and enqueue_poster_generation digests.

ALTER TABLE public.campaigns
  ADD COLUMN source_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_source_urls_shape
    CHECK (
      jsonb_typeof(source_urls) = 'array'
      AND jsonb_array_length(source_urls) <= 3
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(source_urls) AS entry
        WHERE jsonb_typeof(entry.value) <> 'string'
          OR NULLIF(BTRIM(entry.value #>> '{}'), '') IS NULL
      )
    );

-- Freeze the URL set after the first generation exactly like product_url: the
-- captured source is baked into the style board and every downstream prompt, so
-- a post-hoc edit would silently describe evidence the poster was not built from.
CREATE OR REPLACE FUNCTION public.guard_campaign_source_intent_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF (
    NEW.product_url,
    NEW.use_case,
    NEW.source_urls
  ) IS NOT DISTINCT FROM (
    OLD.product_url,
    OLD.use_case,
    OLD.source_urls
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

DROP TRIGGER campaigns_guard_source_intent_update ON public.campaigns;

CREATE TRIGGER campaigns_guard_source_intent_update
  BEFORE UPDATE OF product_url, use_case, source_urls ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_campaign_source_intent_update();

GRANT INSERT (source_urls) ON public.campaigns TO authenticated;
GRANT UPDATE (source_urls) ON public.campaigns TO authenticated;
