-- Posterlytics schema 14 — designer mode: agentic layout spec
--
-- The `designer` poster style adds an agentic step BEFORE image generation: the
-- `designer` function asks an LLM to design a bespoke poster layout (structured
-- JSON) from the brand context, instead of dispatching to one of the two
-- hardcoded template prompts. `hero` then compiles that layout into the
-- text-to-image prompt.
--
-- `poster_layout`  : the LLM-designed layout spec. Shape mirrors `PosterLayout`
--                    in src/lib/types.ts (composition / mood / art_style /
--                    palette_roles / zones[]). NULL for cozy/saas campaigns and
--                    until the designer step has run. hero falls back to a
--                    template prompt when a designer campaign has no layout yet.
-- `design_status`  : null | 'generating' | 'ready' | 'failed' — UI hint only.
--
-- All additive; no CHECK constraints (new poster_style values must not require a
-- migration — same convention as `poster_style` in 09).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS poster_layout JSONB;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS design_status TEXT;
