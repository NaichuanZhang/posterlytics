import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const migration = readFileSync(
  new URL('../migrations/20260717221837_durable-generation-queue.sql', import.meta.url),
  'utf8',
)
const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')

test('durable queue tables are owner-scoped, cascading, indexed, and server-controlled', () => {
  assert.match(migration, /CREATE TABLE public\.generation_jobs/)
  assert.match(migration, /CREATE TABLE public\.generation_notifications/)
  assert.match(migration, /REFERENCES public\.poster_generations\(id\) ON DELETE CASCADE/)
  assert.match(migration, /REFERENCES public\.campaigns\(id\) ON DELETE CASCADE/)
  assert.match(migration, /REFERENCES auth\.users\(id\) ON DELETE CASCADE/)
  assert.match(migration, /idx_generation_jobs_one_active_per_campaign[\s\S]*WHERE status IN \('queued', 'running', 'retrying'\)/)
  assert.match(migration, /ALTER TABLE public\.generation_jobs ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /generation_jobs_owner_read[\s\S]*user_id = \(SELECT auth\.uid\(\)\)/)
  assert.match(migration, /REVOKE ALL ON public\.generation_jobs FROM anon, authenticated/)
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE) ON public\.generation_jobs TO authenticated/)
})

test('enqueue and same-input retry create generation and job rows atomically', () => {
  assert.match(migration, /FUNCTION public\.enqueue_poster_generation[\s\S]*INSERT INTO public\.poster_generations[\s\S]*INSERT INTO public\.generation_jobs/)
  assert.match(migration, /FUNCTION public\.retry_poster_generation[\s\S]*v_previous_generation\.instruction[\s\S]*v_previous_generation\.reference_images/)
  assert.match(migration, /FUNCTION public\.retry_poster_generation[\s\S]*v_previous_generation\.parent_generation_id[\s\S]*v_previous_job\.color_scheme/)
  assert.match(migration, /a poster generation is already active for this campaign/)
})

test('worker claims use leases, skip locked rows, bounded attempts, and stale recovery', () => {
  assert.match(migration, /FUNCTION public\.claim_generation_jobs/)
  assert.match(migration, /FOR UPDATE SKIP LOCKED/)
  assert.match(migration, /lease_expires_at <= NOW\(\)/)
  assert.match(migration, /pg_advisory_xact_lock\(741231, 1\)/)
  assert.match(migration, /v_max_concurrency CONSTANT INTEGER := 2/)
  assert.match(migration, /LIMIT LEAST\(p_limit, v_available_slots\)/)
  assert.match(migration, /max_attempts = 3/)
  assert.match(migration, /attempt_count < max_attempts/)
  assert.match(migration, /LEAST\(30, 5 \* \(2 \^/)
})

test('terminal outcomes are immutable, deduplicated, readable, and owner-scoped', () => {
  assert.match(migration, /terminal generation jobs are immutable/)
  assert.match(migration, /job_id UUID NOT NULL UNIQUE/)
  assert.match(migration, /ON CONFLICT \(job_id\) DO NOTHING/)
  assert.match(migration, /read generation notifications cannot be changed/)
  assert.match(migration, /FUNCTION public\.mark_generation_notifications_read/)
  assert.match(migration, /WHERE user_id = v_user_id[\s\S]*read_at IS NULL/)
})

test('activity orders active, unread, and recent work and publishes owner invalidations', () => {
  assert.match(migration, /WHEN j\.status IN \('queued', 'running', 'retrying'\) THEN 0/)
  assert.match(migration, /WHEN n\.id IS NOT NULL AND n\.read_at IS NULL THEN 1/)
  assert.match(migration, /'scenario', scenario/)
  assert.match(migration, /'generation:' \|\| NEW\.user_id::TEXT/)
  assert.match(migration, /realtime\.channel_name\(\) = 'generation:' \|\| \(SELECT auth\.uid\(\)\)::TEXT/)
})

test('worker-only functions are not executable by browser roles', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.claim_generation_jobs\(TEXT, INTEGER, INTEGER\) FROM PUBLIC/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.claim_generation_jobs\(TEXT, INTEGER, INTEGER\)\s+TO project_admin/)
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.claim_generation_jobs[^;]+TO authenticated/)
})

test('fresh-project baseline contains the durable queue contract', () => {
  assert.match(baseline, /CREATE TABLE public\.generation_jobs/)
  assert.match(baseline, /CREATE TABLE public\.generation_notifications/)
  assert.match(baseline, /FUNCTION public\.enqueue_poster_generation/)
  assert.match(baseline, /FUNCTION public\.claim_generation_jobs/)
  assert.match(baseline, /posterlytics_generation_activity_subscribe/)
})
