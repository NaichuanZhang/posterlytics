import {
  ChevronRight,
  LayoutGrid,
  LogOut,
  Plus,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import type { Campaign } from '../lib/types'

export type CampaignSection = 'poster' | 'placements' | 'analytics'

interface BreadcrumbItem {
  label: string
  to?: string
}

export interface AppShellProps {
  children: ReactNode
  mode?: 'page' | 'workspace'
  breadcrumbs?: BreadcrumbItem[]
  actions?: ReactNode
  campaign?: Pick<Campaign, 'id' | 'product_name' | 'status'>
  activeSection?: CampaignSection
  contentClassName?: string
}

export function AppShell({
  children,
  mode = 'page',
  breadcrumbs = [],
  actions,
  campaign,
  activeSection,
  contentClassName = '',
}: AppShellProps) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/signin')
  }

  return (
    <div className={`app-shell app-shell-${mode}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="app-rail" aria-label="Primary navigation">
        <Link to="/" className="rail-brand" aria-label="Posterlytics" data-tooltip="Posterlytics">
          P
        </Link>
        <nav className="rail-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `rail-button${isActive ? ' is-active' : ''}`}
            aria-label="Campaigns"
            data-tooltip="Campaigns"
          >
            <LayoutGrid size={19} aria-hidden="true" />
          </NavLink>
          <NavLink
            to="/campaigns/new"
            className={({ isActive }) => `rail-button${isActive ? ' is-active' : ''}`}
            aria-label="New campaign"
            data-tooltip="New campaign"
          >
            <Plus size={20} aria-hidden="true" />
          </NavLink>
        </nav>
        <div className="rail-account">
          {user?.email && (
            <span className="rail-avatar" aria-label={user.email} data-tooltip={user.email}>
              {user.email.slice(0, 1).toLocaleUpperCase()}
            </span>
          )}
          <button
            type="button"
            className="rail-button"
            aria-label="Sign out"
            data-tooltip="Sign out"
            onClick={() => void handleSignOut()}
          >
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </aside>

      <div className="app-frame">
        <header className="app-toolbar">
          <nav className="toolbar-breadcrumbs" aria-label="Breadcrumb">
            {breadcrumbs.map((item, index) => (
              <span key={`${item.label}-${index}`} className="breadcrumb-part">
                {index > 0 && <ChevronRight size={14} aria-hidden="true" />}
                {item.to ? <Link to={item.to}>{item.label}</Link> : <span>{item.label}</span>}
              </span>
            ))}
          </nav>
          {actions && <div className="toolbar-actions">{actions}</div>}
        </header>

        {campaign && activeSection && (
          <CampaignTabs campaign={campaign} activeSection={activeSection} />
        )}

        <main
          id="main-content"
          tabIndex={-1}
          className={`shell-content shell-content-${mode} ${contentClassName}`.trim()}
        >
          {children}
        </main>
      </div>
    </div>
  )
}

export function CampaignTabs({
  campaign,
  activeSection,
}: {
  campaign: Pick<Campaign, 'id' | 'product_name' | 'status'>
  activeSection: CampaignSection
}) {
  const tabs: Array<{ section: CampaignSection; label: string; to: string }> = [
    { section: 'poster', label: 'Poster', to: `/campaigns/${campaign.id}` },
    { section: 'placements', label: 'Placements', to: `/campaigns/${campaign.id}/placements` },
    { section: 'analytics', label: 'Analytics', to: `/campaigns/${campaign.id}/analytics` },
  ]

  return (
    <div className="campaign-bar">
      <div className="campaign-identity">
        <strong>{campaign.product_name}</strong>
        <span className={`status-badge status-${campaign.status}`}>{campaign.status}</span>
      </div>
      <nav className="campaign-tabs" aria-label={`${campaign.product_name} sections`}>
        {tabs.map((tab) => (
          <Link
            key={tab.section}
            to={tab.to}
            className={tab.section === activeSection ? 'is-active' : ''}
            aria-current={tab.section === activeSection ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
