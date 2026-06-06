import { NavLink, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'

// Authenticated app shell: fixed left sidebar (brand + line-icon nav + account)
// and a scrollable main column. Mirrors the reference's sidebar layout.
export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/signin')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand" style={{ textDecoration: 'none' }}>
          <span className="mark">P</span>
          Posterlytics
        </NavLink>

        <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <GridIcon />
          <span className="label">Campaigns</span>
        </NavLink>
        <NavLink to="/campaigns/new" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <BoltIcon />
          <span className="label">New campaign</span>
        </NavLink>

        <div className="foot">
          {user && <div className="who">{user.email}</div>}
          <button className="nav-link" onClick={handleSignOut} style={{ width: '100%', background: 'none' }}>
            <SignOutIcon />
            <span className="label">Sign out</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="container">{children}</div>
      </main>
    </div>
  )
}

/* Phosphor-style line icons (consistent 1.6 stroke, not Lucide defaults). */
const sw = 1.6
function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}
function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </svg>
  )
}
function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}
