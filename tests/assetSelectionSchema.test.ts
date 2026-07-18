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
const rankSwapMigration = readFileSync(
  new URL(
    '../migrations/20260718053152_fix-generation-asset-rank-swaps.sql',
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

test('selection updates clear existing ranks before assigning the next order', () => {
  for (const sql of [rankSwapMigration, baseline]) {
    const functionStart = sql.indexOf(
      'CREATE OR REPLACE FUNCTION public.apply_generation_asset_selection(',
    )
    const functionEnd = sql.indexOf('\n$$;', functionStart)
    const body = sql.slice(functionStart, functionEnd)
    const validation = body.indexOf(
      'PERFORM public.validate_generation_asset_ids(p_generation_id, v_ids);',
    )
    const clear = body.indexOf('included = FALSE,\n    selection_rank = NULL')
    const assignment = body.indexOf('included = a.id = ANY(v_ids)')

    assert.ok(functionStart >= 0)
    assert.ok(functionEnd > functionStart)
    assert.ok(validation >= 0 && validation < clear)
    assert.ok(clear >= 0 && clear < assignment)
    assert.match(
      body,
      /WHERE a\.generation_id = p_generation_id\s+AND a\.selection_rank IS NOT NULL;/,
    )
  }
})

test('rank swap migration no-ops after the owner-applied replacement', () => {
  const inspection = rankSwapMigration.indexOf('SELECT pg_get_functiondef(')
  const clearPhaseCheck = rankSwapMigration.indexOf(
    "POSITION('AND a.selection_rank IS NOT NULL;' IN v_definition)",
  )
  const noOp = rankSwapMigration.indexOf('RETURN;', clearPhaseCheck)
  const replacement = rankSwapMigration.indexOf('EXECUTE $replacement$', noOp)

  assert.ok(inspection >= 0 && inspection < clearPhaseCheck)
  assert.ok(clearPhaseCheck < noOp)
  assert.ok(noOp < replacement)
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
