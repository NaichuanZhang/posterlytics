-- Bandless campaigns may omit a destination (unified-creation item 6a).
--
-- The unified creation screen has no always-visible destination field: the
-- destination is revealed by the QR toggle. So "paste a source URL, leave QR off"
-- resolves to website_product with a bandless format and NO destination — which
-- campaigns_source_urls_required forbids today, because it demands a non-null
-- destination_url for every use case except social_cover and rednote_post,
-- regardless of format. That made the commonest path through the new screen a hard
-- 23514 on INSERT.
--
-- The destination requirement is now carried entirely by
-- campaigns_banded_format_destination_required (a BANDED format requires a usable
-- destination, because it renders a scannable QR band). This constraint keeps only
-- its source-URL half.
--
-- Dropping the destination_url term is a pure RELAXATION: the old predicate
-- implies the new one, so no existing row can violate it and no pre-normalizing
-- UPDATE is needed.

ALTER TABLE public.campaigns
  DROP CONSTRAINT campaigns_source_urls_required;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_source_urls_required
    CHECK (
      use_case IN ('social_cover', 'rednote_post')
      OR product_url IS NOT NULL
    );

-- Closing the hole the relaxation opens. A placement IS a tracked link, so it
-- always needs somewhere to point; log_visit_attributed returns NULL for a blank
-- destination, which would serve the unpublished page for a code that is printed
-- on a poster. Previously a destination-less campaign could not reach this state:
-- banded formats and social_cover were rejected below, and every other use case
-- was forced to carry a destination by the constraint relaxed above.
--
-- This only tightens. Verified over every (use_case, poster_format, destination)
-- combination: no combination that was rejected becomes allowed, and the newly
-- rejected ones are exactly the bandless destination-less rows that the relaxation
-- above makes legal for the first time. The trigger is BEFORE INSERT OR UPDATE OF
-- campaign_id, so existing placements are never revalidated.
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

  IF v_use_case = 'rednote_post' THEN
    RAISE EXCEPTION 'RedNote post campaigns cannot have placements.'
      USING ERRCODE = '23514';
  ELSIF NULLIF(BTRIM(v_destination_url), '') IS NULL THEN
    RAISE EXCEPTION 'Tracked poster campaigns require a destination before placements can be added.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
