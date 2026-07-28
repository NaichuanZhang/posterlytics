import {
  Activity,
  ChevronRight,
  LayoutGrid,
  LogOut,
  Plus,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useGenerationActivity } from '../activity/GenerationActivityProvider'
import { useI18n } from '../i18n/I18nProvider'
import { campaignDisplayName } from '../lib/campaignDisplayName'
import { isCampaignTrackingActive } from '../lib/trackingPolicy'
import type { Campaign } from '../lib/types'
import { LanguageSelect } from './LanguageSelect'

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
  campaign?: Pick<
    Campaign,
    'id' | 'product_name' | 'status' | 'use_case' | 'destination_url'
  >
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
  const { unreadCount, openSheet } = useGenerationActivity()
  const navigate = useNavigate()
  const { t } = useI18n()

  async function handleSignOut() {
    await signOut()
    navigate('/signin')
  }

  return (
    <div className={`app-shell app-shell-${mode}`}>
      <a className="skip-link" href="#main-content">{t('Skip to content')}</a>
      <aside className="app-rail">
        <Link to="/" className="rail-brand" aria-label="Posterlytics" data-tooltip="Posterlytics">
          P
        </Link>
        <nav className="rail-nav" aria-label={t('Primary navigation')}>
          <NavLink
            to="/"
            end
            className={({ isActive }) => `rail-button${isActive ? ' is-active' : ''}`}
            aria-label={t('Campaigns')}
            data-tooltip={t('Campaigns')}
          >
            <LayoutGrid size={19} aria-hidden="true" />
          </NavLink>
          <NavLink
            to="/campaigns/new"
            className={({ isActive }) => `rail-button${isActive ? ' is-active' : ''}`}
            aria-label={t('New campaign')}
            data-tooltip={t('New campaign')}
          >
            <Plus size={20} aria-hidden="true" />
          </NavLink>
          <button
            type="button"
            className="rail-button rail-activity-button"
            aria-label={unreadCount > 0
              ? t('Generation activity, {count} unread', { count: unreadCount })
              : t('Generation activity')}
            data-tooltip={t('Generation activity')}
            onClick={openSheet}
          >
            <Activity size={19} aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="rail-activity-badge" aria-hidden="true">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </nav>
        <div className="rail-account">
          <LanguageSelect variant="rail" />
          {user?.email && (
            <span className="rail-avatar" aria-label={user.email} data-tooltip={user.email}>
              {user.email.slice(0, 1).toLocaleUpperCase()}
            </span>
          )}
          <button
            type="button"
            className="rail-button"
            aria-label={t('Sign out')}
            data-tooltip={t('Sign out')}
            onClick={() => void handleSignOut()}
          >
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </aside>

      <div className="app-frame">
        <header className="app-toolbar">
          <nav className="toolbar-breadcrumbs" aria-label={t('Breadcrumb')}>
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
  campaign: Pick<
    Campaign,
    'id' | 'product_name' | 'status' | 'use_case' | 'destination_url'
  >
  activeSection: CampaignSection
}) {
  const { t } = useI18n()
  const campaignName = campaignDisplayName(campaign, t('Untitled campaign'))
  const trackingActive = isCampaignTrackingActive(campaign)
  const allTabs: Array<{ section: CampaignSection; label: string; to: string }> = [
    { section: 'poster', label: t('Poster'), to: `/campaigns/${campaign.id}` },
    { section: 'placements', label: t('Placements'), to: `/campaigns/${campaign.id}/placements` },
    { section: 'analytics', label: t('Analytics'), to: `/campaigns/${campaign.id}/analytics` },
  ]
  const tabs = allTabs.filter(
    (tab) => tab.section === 'poster' || trackingActive,
  )

  return (
    <div className="campaign-bar">
      <div className="campaign-identity">
        <strong>{campaignName}</strong>
        {trackingActive && (
          <span className={`status-badge status-${campaign.status}`}>
            {campaign.status === 'published'
              ? t('Published')
              : campaign.status === 'analyzing'
                ? t('Generating')
                : t('Draft')}
          </span>
        )}
      </div>
      <nav
        className="campaign-tabs"
        aria-label={t('{name} sections', { name: campaignName })}
      >
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
