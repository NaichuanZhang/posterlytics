import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { RequireAuth } from './auth/RequireAuth'
import { SignInPage } from './pages/SignInPage'
import { CampaignsListPage } from './pages/CampaignsListPage'
import { CampaignWizardPage } from './pages/CampaignWizardPage'
import { PosterEditorPage } from './pages/PosterEditorPage'
import { PlacementsPage } from './pages/PlacementsPage'
import { AnalyticsPage } from './pages/AnalyticsPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/" element={<RequireAuth><CampaignsListPage /></RequireAuth>} />
          <Route path="/campaigns/new" element={<RequireAuth><CampaignWizardPage /></RequireAuth>} />
          <Route path="/campaigns/:id" element={<RequireAuth><PosterEditorPage /></RequireAuth>} />
          <Route path="/campaigns/:id/placements" element={<RequireAuth><PlacementsPage /></RequireAuth>} />
          <Route path="/campaigns/:id/analytics" element={<RequireAuth><AnalyticsPage /></RequireAuth>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
