import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  calculateFitScale,
  calculateFitZoom,
  parseWorkspacePreferences,
  stepCanvasZoom,
} from '../src/lib/workspace.ts'

test('stepCanvasZoom follows fixed levels and clamps both ends', () => {
  assert.equal(stepCanvasZoom('fit', -1), 'fit')
  assert.equal(stepCanvasZoom('fit', 1), 25)
  assert.equal(stepCanvasZoom(25, -1), 'fit')
  assert.equal(stepCanvasZoom(67, 1), 75)
  assert.equal(stepCanvasZoom(100, 1), 100)
})

test('calculateFitScale fits both dimensions, includes padding, and never upscales', () => {
  assert.equal(calculateFitScale(1000, 1000, 500, 1000, 50), 0.9)
  assert.equal(calculateFitScale(2000, 2000, 500, 1000, 0), 1)
  assert.equal(calculateFitScale(0, 1000, 500, 1000), 0)
})

test('calculateFitZoom returns a clamped integer percentage', () => {
  assert.equal(calculateFitZoom(720, 960, 600, 900, 30), 100)
  assert.equal(calculateFitZoom(360, 600, 600, 900, 30), 50)
})

test('parseWorkspacePreferences accepts valid persisted preferences', () => {
  assert.deepEqual(
    parseWorkspacePreferences(JSON.stringify({
      versionsPanelOpen: false,
      inspectorPanelOpen: true,
      zoom: 67,
      assetSelectionMode: 'yolo',
    })),
    {
      versionsPanelOpen: false,
      inspectorPanelOpen: true,
      zoom: 67,
      assetSelectionMode: 'yolo',
    },
  )
})

test('parseWorkspacePreferences repairs partial, invalid, and malformed data', () => {
  assert.deepEqual(parseWorkspacePreferences(null), DEFAULT_WORKSPACE_PREFERENCES)
  assert.deepEqual(parseWorkspacePreferences('{bad json'), DEFAULT_WORKSPACE_PREFERENCES)
  assert.deepEqual(
    parseWorkspacePreferences(JSON.stringify({
      versionsPanelOpen: false,
      inspectorPanelOpen: 'yes',
      zoom: 42,
    })),
    {
      versionsPanelOpen: false,
      inspectorPanelOpen: true,
      zoom: 'fit',
      assetSelectionMode: 'editor',
    },
  )
})

test('workspace preference migration defaults first asset selection to Editor', () => {
  assert.equal(DEFAULT_WORKSPACE_PREFERENCES.assetSelectionMode, 'editor')
  assert.equal(
    parseWorkspacePreferences(JSON.stringify({
      versionsPanelOpen: true,
      inspectorPanelOpen: true,
      zoom: 'fit',
    })).assetSelectionMode,
    'editor',
  )
})
