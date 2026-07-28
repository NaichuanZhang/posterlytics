import {
  DEFAULT_LOCALE,
  resolveSupportedLocale,
  type SupportedLocale,
} from './i18n'

export const WORKSPACE_PREFERENCES_KEY = 'posterlytics.workspace.v1'
export const CANVAS_ZOOM_LEVELS = [25, 33, 50, 67, 75, 100] as const

export type CanvasZoomLevel = (typeof CANVAS_ZOOM_LEVELS)[number]
export type CanvasZoom = 'fit' | CanvasZoomLevel

export interface WorkspacePreferences {
  versionsPanelOpen: boolean
  inspectorPanelOpen: boolean
  zoom: CanvasZoom
  assetSelectionMode: 'editor' | 'yolo'
  locale: SupportedLocale
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  versionsPanelOpen: true,
  inspectorPanelOpen: true,
  zoom: 'fit',
  assetSelectionMode: 'editor',
  locale: DEFAULT_LOCALE,
}

export function isCanvasZoom(value: unknown): value is CanvasZoom {
  return value === 'fit' || CANVAS_ZOOM_LEVELS.includes(value as CanvasZoomLevel)
}

export function parseWorkspacePreferences(
  raw: string | null,
  fallbackLocale: SupportedLocale = DEFAULT_LOCALE,
): WorkspacePreferences {
  const defaults = {
    ...DEFAULT_WORKSPACE_PREFERENCES,
    locale: fallbackLocale,
  }
  if (!raw) return defaults

  try {
    const value = JSON.parse(raw) as Partial<WorkspacePreferences> | null
    if (!value || typeof value !== 'object') return defaults

    return {
      versionsPanelOpen: typeof value.versionsPanelOpen === 'boolean'
        ? value.versionsPanelOpen
        : DEFAULT_WORKSPACE_PREFERENCES.versionsPanelOpen,
      inspectorPanelOpen: typeof value.inspectorPanelOpen === 'boolean'
        ? value.inspectorPanelOpen
        : DEFAULT_WORKSPACE_PREFERENCES.inspectorPanelOpen,
      zoom: isCanvasZoom(value.zoom) ? value.zoom : DEFAULT_WORKSPACE_PREFERENCES.zoom,
      assetSelectionMode: value.assetSelectionMode === 'yolo'
        ? 'yolo'
        : DEFAULT_WORKSPACE_PREFERENCES.assetSelectionMode,
      locale: resolveSupportedLocale(value.locale) ?? fallbackLocale,
    }
  } catch {
    return defaults
  }
}

/**
 * Steps the canvas zoom by effective scale, not by list position.
 *
 * `fit` is a computed percentage (see `calculateFitZoom`), so it cannot be
 * treated as the smallest step: on a desktop viewport Fit is commonly ~54%,
 * which sits between the 50 and 67 levels. Pass `fitZoom` so stepping out of
 * `fit` moves to the neighbouring level by magnitude — otherwise "zoom in"
 * from Fit lands on 25% and shrinks the poster.
 *
 * When `fitZoom` is unknown (0), `fit` is treated as the smallest step so the
 * control still walks the fixed levels rather than getting stuck.
 */
export function stepCanvasZoom(
  zoom: CanvasZoom,
  direction: -1 | 1,
  fitZoom = 0,
): CanvasZoom {
  const levels = [...CANVAS_ZOOM_LEVELS]

  if (zoom === 'fit') {
    if (fitZoom <= 0) return direction === 1 ? levels[0] : 'fit'
    const next = direction === 1
      ? levels.find((level) => level > fitZoom)
      : [...levels].reverse().find((level) => level < fitZoom)
    return next ?? 'fit'
  }

  const currentIndex = levels.indexOf(zoom)
  if (direction === 1) {
    return levels[Math.min(levels.length - 1, currentIndex + 1)]
  }

  // Stepping down: land on `fit` when it sits below the current level, so the
  // default view stays reachable from the discrete ladder.
  const previous = levels[currentIndex - 1]
  if (fitZoom > 0 && fitZoom < zoom && (previous === undefined || fitZoom > previous)) {
    return 'fit'
  }
  return previous ?? 'fit'
}

export function calculateFitScale(
  containerWidth: number,
  containerHeight: number,
  contentWidth: number,
  contentHeight: number,
  padding = 64,
): number {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    contentWidth <= 0 ||
    contentHeight <= 0
  ) {
    return 0
  }

  const availableWidth = Math.max(1, containerWidth - padding * 2)
  const availableHeight = Math.max(1, containerHeight - padding * 2)
  return Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight)
}

export function calculateFitZoom(
  containerWidth: number,
  containerHeight: number,
  contentWidth: number,
  contentHeight: number,
  padding = 64,
): number {
  const scale = calculateFitScale(
    containerWidth,
    containerHeight,
    contentWidth,
    contentHeight,
    padding,
  )
  return scale === 0 ? 0 : Math.max(1, Math.min(100, Math.round(scale * 100)))
}
