import { Link, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'

// Authenticated app shell: top bar + centered content container.
export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/signin')
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <Link to="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          Poster<span>lytics</span>
        </Link>
        <div className="right">
          {user && <span>{user.email}</span>}
          <button className="btn ghost sm" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>
      <div className="container">{children}</div>
    </div>
  )
}
