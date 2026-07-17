export const WORKSPACE_PREFERENCES_KEY = 'posterlytics.workspace.v1'
export const CANVAS_ZOOM_LEVELS = [25, 33, 50, 67, 75, 100] as const

export type CanvasZoomLevel = (typeof CANVAS_ZOOM_LEVELS)[number]
export type CanvasZoom = 'fit' | CanvasZoomLevel

export interface WorkspacePreferences {
  versionsPanelOpen: boolean
  inspectorPanelOpen: boolean
  zoom: CanvasZoom
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  versionsPanelOpen: true,
  inspectorPanelOpen: true,
  zoom: 'fit',
}

export function isCanvasZoom(value: unknown): value is CanvasZoom {
  return value === 'fit' || CANVAS_ZOOM_LEVELS.includes(value as CanvasZoomLevel)
}

export function parseWorkspacePreferences(raw: string | null): WorkspacePreferences {
  if (!raw) return { ...DEFAULT_WORKSPACE_PREFERENCES }

  try {
    const value = JSON.parse(raw) as Partial<WorkspacePreferences> | null
    if (!value || typeof value !== 'object') return { ...DEFAULT_WORKSPACE_PREFERENCES }

    return {
      versionsPanelOpen: typeof value.versionsPanelOpen === 'boolean'
        ? value.versionsPanelOpen
        : DEFAULT_WORKSPACE_PREFERENCES.versionsPanelOpen,
      inspectorPanelOpen: typeof value.inspectorPanelOpen === 'boolean'
        ? value.inspectorPanelOpen
        : DEFAULT_WORKSPACE_PREFERENCES.inspectorPanelOpen,
      zoom: isCanvasZoom(value.zoom) ? value.zoom : DEFAULT_WORKSPACE_PREFERENCES.zoom,
    }
  } catch {
    return { ...DEFAULT_WORKSPACE_PREFERENCES }
  }
}

export function stepCanvasZoom(zoom: CanvasZoom, direction: -1 | 1): CanvasZoom {
  const ordered: CanvasZoom[] = ['fit', ...CANVAS_ZOOM_LEVELS]
  const currentIndex = ordered.indexOf(zoom)
  const nextIndex = Math.min(
    ordered.length - 1,
    Math.max(0, currentIndex + direction),
  )
  return ordered[nextIndex]
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
