-- Banded-format QR/destination/placement policy (unified-creation item 3).
--
-- The QR toggle is a property of the poster_format slug, not of use_case. This
-- replaces the social_cover-only destination rule with a format-keyed one, so any
-- banded format requires a usable destination and the old constraint stops being
-- dead and misleading.
--
-- A banded poster with no destination renders a dead QR band, so the rule is:
--   banded slug  =>  NULLIF(BTRIM(destination_url), '') IS NOT NULL
-- One-directional on purpose. A BANDLESS format says nothing about the
-- destination: per docs/decisions/2026-07-24-social-cover-qr-stitch.md, website,
-- Amazon and event campaigns may use a bandless format while their tracked links
-- stay valid, and destination presence — not band geometry — is the link-validity
-- invariant. Nothing here clears a destination or retires a placement.

-- Pre-normalize before adding the CHECK, or the ALTER fails on existing rows.
-- campaigns_source_urls_required tests only `destination_url IS NOT NULL`, not the
-- NULLIF(BTRIM(...)) form, so a banded row with a BLANK-but-not-null destination is
-- legal today and would violate the new constraint. Rows exempt from that
-- constraint (social_cover, rednote_post) can likewise carry a banded slug with a
-- NULL destination.
--
-- The fix flips the FORMAT to its bandless twin rather than touching any
-- destination: NULLing blanks would violate campaigns_source_urls_required for
-- every website/Amazon/event row. This is semantically a correction, since a blank
-- destination already means tracking is inactive. It is total (all four banded
-- slugs have twins), fires no trigger (the column-scoped campaign triggers watch
-- product_url/use_case/source_urls, never poster_format), and cannot alter a
-- historical render because campaigns.poster_format is only the next-generation
-- target while each version's actual format is the immutable
-- poster_generations.poster_format snapshot.
UPDATE public.campaigns
SET poster_format = CASE poster_format
  WHEN 'a4_2x3' THEN 'a4_2x3_cover'
  WHEN 'rednote_3x4' THEN 'rednote_cover_3x4'
  WHEN 'yt_thumb_16x9' THEN 'yt_thumb_16x9_cover'
  WHEN 'luma_1x1' THEN 'luma_1x1_cover'
END
WHERE poster_format IN ('a4_2x3', 'rednote_3x4', 'yt_thumb_16x9', 'luma_1x1')
  AND NULLIF(BTRIM(destination_url), '') IS NULL;

ALTER TABLE public.campaigns
  DROP CONSTRAINT campaigns_social_cover_qr_destination_required;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_banded_format_destination_required
    CHECK (
      poster_format NOT IN (
        'a4_2x3',
        'rednote_3x4',
        'yt_thumb_16x9',
        'luma_1x1'
      )
      OR NULLIF(BTRIM(destination_url), '') IS NOT NULL
    );

-- Generalize the placement guard to the banded format while keeping it NO WEAKER
-- than before. Keying on the band ALONE would loosen policy: social_cover with QR
-- off is bandless, so a destination-less social cover placement would start being
-- permitted. The rednote_post rejection is preserved verbatim so multi-page
-- campaigns still cannot carry placements.
CREATE OR REPLACE FUNCTION public.guard_placement_tracking_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_use_case TEXT;
  v_destination_url TEXT;
  v_poster_format TEXT;
BEGIN
  -- Serialize placement writes with campaign use-case changes.
  SELECT use_case, destination_url, poster_format
  INTO v_use_case, v_destination_url, v_poster_format
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
  ELSIF NULLIF(BTRIM(v_destination_url), '') IS NULL
    AND (
      v_poster_format IN ('a4_2x3', 'rednote_3x4', 'yt_thumb_16x9', 'luma_1x1')
      OR v_use_case = 'social_cover'
    ) THEN
    RAISE EXCEPTION 'Tracked poster campaigns require a destination before placements can be added.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
