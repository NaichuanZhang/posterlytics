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

test('stepCanvasZoom steps out of fit by effective scale, never shrinking on zoom in', () => {
  // Fit at 54% (a typical desktop editor) sits between the 50 and 67 levels.
  assert.equal(stepCanvasZoom('fit', 1, 54), 67)
  assert.equal(stepCanvasZoom('fit', -1, 54), 50)

  // Fit below every level: zoom in reaches the smallest level, zoom out clamps.
  assert.equal(stepCanvasZoom('fit', 1, 19), 25)
  assert.equal(stepCanvasZoom('fit', -1, 19), 'fit')

  // Fit at or above the top level: zoom in clamps rather than jumping down.
  assert.equal(stepCanvasZoom('fit', 1, 100), 'fit')
  assert.equal(stepCanvasZoom('fit', -1, 100), 75)
})

test('stepCanvasZoom returns to fit when fit sits below the current level', () => {
  assert.equal(stepCanvasZoom(67, -1, 54), 'fit')
  // Fit below the next level down goes to that level first, then to fit.
  assert.equal(stepCanvasZoom(67, -1, 40), 50)
  assert.equal(stepCanvasZoom(50, -1, 40), 'fit')
  // Fit coinciding with a level steps to that level (same magnitude).
  assert.equal(stepCanvasZoom(50, -1, 33), 33)
  // Fit above the current level must not be offered as a "zoom out" target.
  assert.equal(stepCanvasZoom(25, -1, 54), 'fit')
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
      locale: 'zh-CN',
    })),
    {
      versionsPanelOpen: false,
      inspectorPanelOpen: true,
      zoom: 67,
      assetSelectionMode: 'yolo',
      locale: 'zh-CN',
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
      locale: 'en-US',
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

test('workspace preference migration uses browser locale only when no valid locale is stored', () => {
  assert.equal(
    parseWorkspacePreferences(null, 'zh-CN').locale,
    'zh-CN',
  )
  assert.equal(
    parseWorkspacePreferences(JSON.stringify({
      versionsPanelOpen: true,
      locale: 'en-GB',
    }), 'zh-CN').locale,
    'en-US',
  )
  assert.equal(
    parseWorkspacePreferences(JSON.stringify({
      versionsPanelOpen: true,
      locale: 'not-a-locale',
    }), 'zh-CN').locale,
    'zh-CN',
  )
})

test('invalid persisted locale types do not discard other workspace preferences', () => {
  for (const locale of [42, {}]) {
    assert.deepEqual(
      parseWorkspacePreferences(JSON.stringify({
        versionsPanelOpen: false,
        inspectorPanelOpen: false,
        zoom: 67,
        assetSelectionMode: 'yolo',
        locale,
      }), 'zh-CN'),
      {
        versionsPanelOpen: false,
        inspectorPanelOpen: false,
        zoom: 67,
        assetSelectionMode: 'yolo',
        locale: 'zh-CN',
      },
    )
  }
})
