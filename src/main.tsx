import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './components/AppErrorBoundary.css'
import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { WorkspacePreferencesProvider } from './hooks/useWorkspacePreferences'
import { I18nProvider } from './i18n/I18nProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkspacePreferencesProvider>
      <I18nProvider>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </I18nProvider>
    </WorkspacePreferencesProvider>
  </StrictMode>,
)
