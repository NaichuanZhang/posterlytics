-- Posterlytics schema 09 — poster_style
-- Which visual template the poster uses. The analyzer auto-selects it from the
-- scraped brand: 'cozy_scrapbook' (warm gamified watercolor, default) or
-- 'saas_glassmorphism' (premium split-zone product-launch poster). No CHECK
-- constraint so future styles can be added without a migration.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS poster_style TEXT NOT NULL DEFAULT 'cozy_scrapbook';
