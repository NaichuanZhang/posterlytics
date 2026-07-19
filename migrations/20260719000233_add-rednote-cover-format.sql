ALTER TABLE public.campaigns
  DROP CONSTRAINT campaigns_poster_format_valid,
  ADD CONSTRAINT campaigns_poster_format_valid
    CHECK (
      poster_format IN (
        'a4_2x3',
        'rednote_3x4',
        'rednote_cover_3x4',
        'yt_thumb_16x9',
        'luma_1x1'
      )
    );

ALTER TABLE public.poster_generations
  DROP CONSTRAINT poster_generations_poster_format_valid,
  ADD CONSTRAINT poster_generations_poster_format_valid
    CHECK (
      poster_format IN (
        'a4_2x3',
        'rednote_3x4',
        'rednote_cover_3x4',
        'yt_thumb_16x9',
        'luma_1x1'
      )
    );
