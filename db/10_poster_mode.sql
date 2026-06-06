-- Posterlytics schema 10 — poster_mode
-- Which rendering the campaign uses: 'template' (deterministic HTML/CSS poster)
-- or 'image' (AI-generated illustrated image in hero_image_url, with the real QR
-- overlaid client-side). The user picks at creation; default keeps the reliable
-- template. No CHECK constraint so future modes can be added without a migration.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS poster_mode TEXT NOT NULL DEFAULT 'template';
