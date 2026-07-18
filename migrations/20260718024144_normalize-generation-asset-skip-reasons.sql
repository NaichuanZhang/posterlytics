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
