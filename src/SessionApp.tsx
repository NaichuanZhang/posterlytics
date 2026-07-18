import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { RequireAuth } from './auth/RequireAuth'
import { Spinner } from './components/ui/Spinner'
import { ToastProvider } from './components/ui/Toast'
import { PublicLandingShell } from './marketing/PublicLandingShell'

const SignInPage = lazy(() =>
  import('./pages/SignInPage').then((module) => ({ default: module.SignInPage }))
)
const CampaignsListPage = lazy(() =>
  import('./pages/CampaignsListPage').then((module) => ({ default: module.CampaignsListPage }))
)
const CampaignWizardPage = lazy(() =>
  import('./pages/CampaignWizardPage').then((module) => ({ default: module.CampaignWizardPage }))
)
const PosterEditorPage = lazy(() =>
  import('./pages/PosterEditorPage').then((module) => ({ default: module.PosterEditorPage }))
)
const GenerationAssetReviewPage = lazy(() =>
  import('./pages/GenerationAssetReviewPage').then((module) => ({
    default: module.GenerationAssetReviewPage,
  }))
)
const PlacementsPage = lazy(() =>
  import('./pages/PlacementsPage').then((module) => ({ default: module.PlacementsPage }))
)
const AnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPage').then((module) => ({ default: module.AnalyticsPage }))
)
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage }))
)
const AuthenticatedActivityScope = lazy(
  () => import('./activity/AuthenticatedActivityScope'),
)

function HomeRoute() {
  const { user, loading } = useAuth()
  if (loading) return <Spinner full />
  if (user) {
    return (
      <AuthenticatedPage>
        <CampaignsListPage />
      </AuthenticatedPage>
    )
  }
  return <PublicLandingShell />
}

function AuthenticatedPage({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<Spinner full />}>
      <AuthenticatedActivityScope>{children}</AuthenticatedActivityScope>
    </Suspense>
  )
}

function ProtectedPage({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AuthenticatedPage>{children}</AuthenticatedPage>
    </RequireAuth>
  )
}

export default function SessionApp() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomeRoute />} />
            <Route
              path="/signin"
              element={<Suspense fallback={<Spinner full />}><SignInPage /></Suspense>}
            />
            <Route path="/campaigns/new" element={<ProtectedPage><CampaignWizardPage /></ProtectedPage>} />
            <Route path="/campaigns/:id" element={<ProtectedPage><PosterEditorPage /></ProtectedPage>} />
            <Route
              path="/campaigns/:campaignId/generations/:generationId/assets"
              element={<ProtectedPage><GenerationAssetReviewPage /></ProtectedPage>}
            />
            <Route path="/campaigns/:id/placements" element={<ProtectedPage><PlacementsPage /></ProtectedPage>} />
            <Route path="/campaigns/:id/analytics" element={<ProtectedPage><AnalyticsPage /></ProtectedPage>} />
            <Route path="*" element={<ProtectedPage><NotFoundPage /></ProtectedPage>} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  )
}
