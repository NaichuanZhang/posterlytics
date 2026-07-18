import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const migration = readFileSync(
  new URL('../migrations/20260718021403_pre-generation-asset-review.sql', import.meta.url),
  'utf8',
)
const skipReasonMigration = readFileSync(
  new URL(
    '../migrations/20260718024144_normalize-generation-asset-skip-reasons.sql',
    import.meta.url,
  ),
  'utf8',
)
const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')

test('asset review schema is owner-readable and RPC-mutated only', () => {
  assert.match(migration, /CREATE TABLE public\.generation_assets/)
  assert.match(migration, /generation_assets_owner_read[\s\S]*user_id = \(SELECT auth\.uid\(\)\)/)
  assert.match(migration, /REVOKE ALL ON public\.generation_assets FROM anon, authenticated/)
  assert.match(migration, /GRANT SELECT ON public\.generation_assets TO authenticated/)
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE) ON public\.generation_assets TO authenticated/)
})

test('selection constraints enforce availability, unique rank, and six-image RPC bounds', () => {
  assert.match(migration, /selection_rank BETWEEN 1 AND 6/)
  assert.match(migration, /idx_generation_assets_selected_rank/)
  assert.match(migration, /cardinality\(v_ids\) > 6/)
  assert.match(migration, /selection contains duplicate ids/)
  assert.match(migration, /selection contains unavailable or unknown ids/)
})

test('review lifecycle includes active uniqueness, atomic resume, cancellation, and immutable completion', () => {
  assert.match(migration, /WHERE status IN \('created', 'analyzing', 'reviewing', 'designing', 'painting'\)/)
  assert.match(migration, /WHERE status IN \('queued', 'running', 'retrying', 'awaiting_review'\)/)
  assert.match(migration, /completed generation asset selections are immutable/)
  assert.match(migration, /FUNCTION public\.confirm_generation_asset_selection[\s\S]*status = 'queued'[\s\S]*stage = v_next_stage/)
  assert.match(migration, /FUNCTION public\.cancel_generation_asset_review[\s\S]*status = 'canceled'/)
})

test('browser and worker RPC grants are separated by ownership boundary', () => {
  assert.match(migration, /save_generation_asset_selection\(UUID, UUID\[\]\)[\s\S]*TO authenticated/)
  assert.match(migration, /confirm_generation_asset_selection\(UUID, UUID\[\]\)[\s\S]*TO authenticated/)
  assert.match(migration, /replace_generation_assets_for_worker\(UUID, UUID, JSONB\)[\s\S]*TO project_admin/)
  assert.doesNotMatch(migration, /replace_generation_assets_for_worker\(UUID, UUID, JSONB\)[\s\S]{0,80}TO authenticated/)
})

test('unavailable trace assets keep a typed skip reason and separate detail', () => {
  for (const sql of [skipReasonMigration, baseline]) {
    assert.match(sql, /'reason',[\s\S]*'unsupported_format'/)
    assert.match(sql, /'empty_image'/)
    assert.match(sql, /'image_too_large'/)
    assert.match(sql, /ELSE 'fetch_failed'/)
    assert.match(
      sql,
      /'detail',[\s\S]*COALESCE\(a\.availability_reason, 'Candidate was unavailable during preparation\.'\)/,
    )
  }
})
