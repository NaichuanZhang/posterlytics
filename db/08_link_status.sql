-- Posterlytics schema 08 — link_status peek RPC
-- The anon `view`/`convert` functions need to tell apart "code exists but the
-- campaign isn't published yet" from "code doesn't exist at all", so they can
-- show a friendly "not live yet" page instead of a bare 404. They must NOT be
-- able to read draft campaign content (the RLS anti-leak contract), so this
-- SECURITY DEFINER function returns ONLY a status enum — never any campaign data.

CREATE OR REPLACE FUNCTION public.link_status(p_code TEXT)
RETURNS TEXT AS $$
DECLARE
  v_placement placements%ROWTYPE;
  v_status TEXT;
BEGIN
  SELECT * INTO v_placement FROM placements WHERE code = p_code;
  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;

  SELECT status INTO v_status FROM campaigns WHERE id = v_placement.campaign_id;
  IF v_status = 'published' THEN
    RETURN 'published';
  END IF;

  RETURN 'unpublished';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.link_status(TEXT) TO anon;
