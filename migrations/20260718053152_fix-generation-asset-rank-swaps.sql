DO $migration$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.apply_generation_asset_selection(UUID, UUID[], JSONB)'::regprocedure
  )
  INTO v_definition;

  IF POSITION('included = FALSE,' IN v_definition) > 0
    AND POSITION('AND a.selection_rank IS NOT NULL;' IN v_definition) > 0 THEN
    RETURN;
  END IF;

  EXECUTE $replacement$
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
    included = FALSE,
    selection_rank = NULL
  WHERE a.generation_id = p_generation_id
    AND a.selection_rank IS NOT NULL;

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
$replacement$;
END;
$migration$;
