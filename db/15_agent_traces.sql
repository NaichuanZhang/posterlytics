-- Posterlytics schema 15 — agentic failure traces
--
-- The generation pipeline (analyze → [designer] → hero → landing) is best-effort
-- and, until now, discarded everything on failure: the edge functions log nothing
-- (Deno Subhosting logs aren't reachable from the app) and the UI showed only a
-- generic red "!" or a terse "failed — try again" hint. This table records a trace
-- whenever an agentic step FAILS or silently DEGRADES, so failures are debuggable.
--
-- One row per failure/degrade event, written best-effort by the auth-scoped edge
-- functions via the user's own bearer token (createUserClient). Owner-read only —
-- same contract as `conversions` (db/04). No anon access, no SECURITY DEFINER RPC:
-- the caller's token is already in context, so a plain owner-RLS insert suffices.
--
-- `step`     : 'analyze' | 'designer' | 'hero' | 'landing' | 'capture'
-- `status`   : 'failed' (hard error) | 'degraded' (silent fallback used)
-- `detail`   : short human summary
-- `request`  : what we sent (model, prompt system/user or image, url, config) — truncated
-- `response` : what we got back (error text/body, stack, fallback used) — truncated
--
-- All additive; no CHECK constraints (new step/status values must not require a
-- migration — same convention as poster_style in 09).
CREATE TABLE IF NOT EXISTS agent_traces (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  step         TEXT NOT NULL,
  status       TEXT NOT NULL,
  detail       TEXT,
  request      JSONB,
  response     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agent_traces ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_agent_traces_campaign_id ON agent_traces(campaign_id);
CREATE INDEX IF NOT EXISTS idx_agent_traces_user_id     ON agent_traces(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_traces_created_at  ON agent_traces(created_at);

CREATE POLICY "owner read agent_traces" ON agent_traces
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "owner insert agent_traces" ON agent_traces
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT ON agent_traces TO authenticated;
