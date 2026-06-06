-- Posterlytics schema 07 — gamified poster spec
-- The poster is now a fully AI-illustrated cozy-scrapbook image (9:16). analyze
-- produces a structured poster_spec (template zones) + a brand_essence word-
-- portrait; hero renders the image from them. hero_image_url/key now hold the
-- full poster image. landing_content is unchanged (the hosted landing still uses it).

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS poster_spec   JSONB;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS brand_essence TEXT;
