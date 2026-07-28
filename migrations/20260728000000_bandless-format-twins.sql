-- Bandless poster-format twins (unified-creation item 1).
--
-- The QR band is encoded in the poster_format slug, not a separate column, so a
-- "QR off" poster needs a distinct bandless slug per aspect. Adds three twins
-- (a4_2x3_cover, yt_thumb_16x9_cover, luma_1x1_cover) alongside the existing
-- rednote_cover_3x4 by widening both poster_format CHECK constraints to the full
-- 8-slug registry. Append-only forward migration; db/schema.sql carries the
-- identical constraint text as the fresh-project baseline.
--
-- Deploy the edge functions (designer, hero, generation-worker) built from the
-- extended registry BEFORE any writer can persist a twin slug — getPosterSize
-- throws a RangeError on an unknown slug.

ALTER TABLE public.campaigns
  DROP CONSTRAINT campaigns_poster_format_valid;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_poster_format_valid
    CHECK (
      poster_format IN (
        'a4_2x3',
        'a4_2x3_cover',
        'rednote_3x4',
        'rednote_cover_3x4',
        'yt_thumb_16x9',
        'yt_thumb_16x9_cover',
        'luma_1x1',
        'luma_1x1_cover'
      )
    );

ALTER TABLE public.poster_generations
  DROP CONSTRAINT poster_generations_poster_format_valid;

ALTER TABLE public.poster_generations
  ADD CONSTRAINT poster_generations_poster_format_valid
    CHECK (
      poster_format IN (
        'a4_2x3',
        'a4_2x3_cover',
        'rednote_3x4',
        'rednote_cover_3x4',
        'yt_thumb_16x9',
        'yt_thumb_16x9_cover',
        'luma_1x1',
        'luma_1x1_cover'
      )
    );
