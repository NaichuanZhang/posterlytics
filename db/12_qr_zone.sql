-- Posterlytics schema 12 — qr_zone
-- Vision-detected calm zone for the AI-poster QR: 0..1 fractions, top-left origin.
-- Populated by the `hero` function after image generation (a gpt-4o vision call
-- locates the empty region the diffusion model actually left); NULL when detection
-- is unavailable or failed, in which case the SPA falls back to the per-style
-- ANCHORS table in AiPoster.tsx. Shape:
--   { "x": 0.62, "y": 0.74, "w": 0.26, "h": 0.18 }
-- No CHECK constraint; the frontend clamps/validates defensively.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS qr_zone JSONB;
