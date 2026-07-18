import type { ReactNode } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'

export function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`skeleton ${className}`.trim()} aria-hidden="true" />
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <section className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">{icon}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </section>
  )
}

export function InlineNotice({
  children,
  tone = 'info',
}: {
  children: ReactNode
  tone?: 'info' | 'error' | 'warning' | 'success'
}) {
  const Icon = tone === 'error'
    ? AlertCircle
    : tone === 'warning'
      ? AlertTriangle
      : tone === 'success'
        ? CheckCircle2
        : Info
  return (
    <div
      className={`inline-notice inline-notice-${tone}`}
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
    >
      <Icon size={16} aria-hidden="true" />
      <div>{children}</div>
    </div>
  )
}
