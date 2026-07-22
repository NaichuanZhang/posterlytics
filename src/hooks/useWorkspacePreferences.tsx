import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  parseWorkspacePreferences,
  WORKSPACE_PREFERENCES_KEY,
  type WorkspacePreferences,
} from '../lib/workspace'
import { preferredLocale } from '../lib/i18n'

function initialPreferences(): WorkspacePreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_WORKSPACE_PREFERENCES }
  return parseWorkspacePreferences(
    window.localStorage.getItem(WORKSPACE_PREFERENCES_KEY),
    preferredLocale(window.navigator.languages),
  )
}

interface WorkspacePreferencesContextValue {
  preferences: WorkspacePreferences
  updatePreferences: (patch: Partial<WorkspacePreferences>) => void
}

const WorkspacePreferencesContext = createContext<WorkspacePreferencesContextValue | null>(null)

export function WorkspacePreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<WorkspacePreferences>(initialPreferences)

  useEffect(() => {
    try {
      window.localStorage.setItem(WORKSPACE_PREFERENCES_KEY, JSON.stringify(preferences))
    } catch {
      // Preferences remain usable in memory when browser storage is unavailable.
    }
  }, [preferences])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== WORKSPACE_PREFERENCES_KEY) return
      setPreferences(parseWorkspacePreferences(
        event.newValue,
        preferredLocale(window.navigator.languages),
      ))
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const updatePreferences = useCallback((patch: Partial<WorkspacePreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }))
  }, [])

  return (
    <WorkspacePreferencesContext.Provider value={{ preferences, updatePreferences }}>
      {children}
    </WorkspacePreferencesContext.Provider>
  )
}

export function useWorkspacePreferences() {
  const context = useContext(WorkspacePreferencesContext)
  if (!context) {
    throw new Error('useWorkspacePreferences must be used inside WorkspacePreferencesProvider')
  }
  return context
}
