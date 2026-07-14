-- 19: designer becomes the only poster mode.
--
-- The two fixed template modes (cozy_scrapbook, saas_glassmorphism) were
-- removed from the app: every product poster is now designed by the layout
-- agent (`designer` fn → poster_layout) and painted by `hero`; events keep
-- their bespoke event prompt. Backfill existing rows so old campaigns follow
-- the one remaining path — their painted hero_image_url keeps rendering as-is
-- (AiPoster only shows the image + QR band), and the next Regenerate runs
-- analyze → designer → hero. No CHECK constraint, matching the poster_style
-- column's existing convention (db/09).

UPDATE campaigns
SET poster_style = 'designer'
WHERE poster_style IN ('cozy_scrapbook', 'saas_glassmorphism');

-- poster_mode (db/10: 'template' | 'image') chose between the retired
-- deterministic HTML/CSS template poster and the AI image. The template
-- renderer was removed earlier (AiPoster is the only renderer) and no code
-- reads the column anymore — drop it.
ALTER TABLE campaigns DROP COLUMN IF EXISTS poster_mode;
