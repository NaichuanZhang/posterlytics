import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  parseWorkspacePreferences,
  WORKSPACE_PREFERENCES_KEY,
  type WorkspacePreferences,
} from '../lib/workspace'

function initialPreferences(): WorkspacePreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_WORKSPACE_PREFERENCES }
  return parseWorkspacePreferences(window.localStorage.getItem(WORKSPACE_PREFERENCES_KEY))
}

export function useWorkspacePreferences() {
  const [preferences, setPreferences] = useState<WorkspacePreferences>(initialPreferences)

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_PREFERENCES_KEY, JSON.stringify(preferences))
  }, [preferences])

  const updatePreferences = useCallback((patch: Partial<WorkspacePreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }))
  }, [])

  return { preferences, updatePreferences }
}
