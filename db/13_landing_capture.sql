-- Posterlytics schema 13 — programmatic design tokens + screenshot + generated landing
--
-- `design_tokens`  : programmatic style extraction from a real headless browser
--                    (computed fonts/colors/radii/shadows/spacing/buttons). Shape
--                    mirrors `DesignTokens` in src/lib/types.ts. Populated by the
--                    `analyze` function via the capture-service; NULL when capture
--                    is unavailable (analyze then falls back to regex mining).
-- `screenshot_url` /
-- `screenshot_key` : an above-the-fold screenshot of the site, re-hosted in the
--                    public `assets` bucket. Passed by URL to the landing agent's
--                    vision-critique step.
-- `landing_html`   : the AI-authored, on-brand landing page (full HTML). Served
--                    verbatim by `view.ts` after per-request runtime injection
--                    ({{CTA_HREF}}, {{SCAN_BEACON}}). NULL → view.ts falls back to
--                    the legacy `landingHtml()` template.
-- `landing_status` : null | 'generating' | 'ready' | 'failed' — UI hint only.
--
-- All additive; no CHECK constraints (new values must not require a migration).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS design_tokens  JSONB;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS screenshot_url TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS screenshot_key TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS landing_html   TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS landing_status TEXT;
