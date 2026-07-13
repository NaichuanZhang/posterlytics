-- 18: rename campaigns.landing_content -> poster_content.
--
-- The AI landing page was retired in db/17 (a QR scan is a pure tracked
-- redirect), but the landing_content column survived because designer.ts and
-- analyze.ts use it as structured POSTER COPY (headline / what-it-does /
-- features / cta) — it never was page HTML. The old name kept "landing"
-- leaking into code, prompts, and the generation progress UI (which reveals
-- the analyze prompt, schema keys included). Rename the column to say what it
-- is. Deploy the matching analyze/designer builds immediately after applying:
-- the old builds reference landing_content and will error once this runs.

ALTER TABLE campaigns RENAME COLUMN landing_content TO poster_content;
