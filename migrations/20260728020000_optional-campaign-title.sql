-- Optional campaign title (unified-creation item 2).
--
-- The unified creation screen does not require a title. NULL is the untitled
-- representation rather than '': every downstream fallback in the app uses `??`
-- or `||`, and persisting '' would yield blank prompt identity lines, filenames
-- that collide between untitled campaigns, a RedNote cover plan its own validator
-- rejects, and a squatted empty utm_campaign in the redirect.
--
-- Deliberately NO blank/whitespace CHECK: the writer converts '' to NULL at the
-- DB boundary, and a CHECK would turn a legacy blank row into an update failure.
-- Grants are untouched; product_name is already in both column grants and
-- nullability does not affect a grant.

ALTER TABLE public.campaigns
  ALTER COLUMN product_name DROP NOT NULL;
