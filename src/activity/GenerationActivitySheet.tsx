import {
  AlertCircle,
  CheckCheck,
  CheckCircle2,
  Clock3,
  BadgeCheck,
  LoaderCircle,
  RotateCcw,
  X,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  canRetryGeneration,
  elapsedSeconds,
  formatElapsed,
  generationActivityLabel,
  isActiveGenerationJob,
} from '../lib/generationActivity'
import type { GenerationActivityItem } from '../lib/types'
import { EmptyState, InlineNotice } from '../components/ui/Feedback'

interface Props {
  items: GenerationActivityItem[]
  unreadCount: number
  loading: boolean
  error: string | null
  onClose: () => void
  onOpen: (item: GenerationActivityItem) => void
  onMarkAllRead: () => void
  onRetry: (item: GenerationActivityItem) => void
}

export function GenerationActivitySheet({
  items,
  unreadCount,
  loading,
  error,
  onClose,
  onOpen,
  onMarkAllRead,
  onRetry,
}: Props) {
  const sheetRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [now, setNow] = useState(Date.now())
  const groups = useMemo(() => ({
    active: items.filter(isActiveGenerationJob),
    unread: items.filter((item) => !isActiveGenerationJob(item) && item.notification_id && !item.read_at),
    history: items.filter((item) => !isActiveGenerationJob(item) && (!item.notification_id || !!item.read_at)),
  }), [items])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !sheetRef.current) return
      const focusable = [...sheetRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previous?.focus()
    }
  }, [onClose])

  useEffect(() => {
    if (groups.active.length === 0) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [groups.active.length])

  return (
    <div className="activity-layer">
      <button
        type="button"
        className="activity-backdrop"
        aria-label="Close generation activity"
        onClick={onClose}
      />
      <aside
        ref={sheetRef}
        className="activity-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-title"
      >
        <header className="activity-sheet-header">
          <div>
            <span>Poster jobs</span>
            <h2 id="activity-title">Generation activity</h2>
          </div>
          <div>
            {unreadCount > 0 && (
              <button type="button" className="button button-secondary button-small" onClick={onMarkAllRead}>
                <CheckCheck size={14} aria-hidden="true" />
                Mark all read
              </button>
            )}
            <button
              ref={closeRef}
              type="button"
              className="icon-button"
              aria-label="Close generation activity"
              onClick={onClose}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="activity-sheet-body">
          {error && (
            <InlineNotice tone="error">
              <strong>Activity could not refresh.</strong>
              <span>{error}</span>
            </InlineNotice>
          )}
          {loading && items.length === 0 ? (
            <div className="activity-loading" aria-busy="true">
              <LoaderCircle size={18} className="generation-stage-spinner" aria-hidden="true" />
              Loading generation activity
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Clock3 size={22} />}
              title="No generation activity"
              description="Queued and completed poster jobs will appear here."
            />
          ) : (
            <>
              <ActivityGroup
                title="Active"
                items={groups.active}
                now={now}
                onOpen={onOpen}
                onRetry={onRetry}
              />
              <ActivityGroup
                title="Unread"
                items={groups.unread}
                now={now}
                onOpen={onOpen}
                onRetry={onRetry}
              />
              <ActivityGroup
                title="Recent"
                items={groups.history}
                now={now}
                onOpen={onOpen}
                onRetry={onRetry}
              />
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

function ActivityGroup({
  title,
  items,
  now,
  onOpen,
  onRetry,
}: {
  title: string
  items: GenerationActivityItem[]
  now: number
  onOpen: (item: GenerationActivityItem) => void
  onRetry: (item: GenerationActivityItem) => void
}) {
  if (items.length === 0) return null
  return (
    <section className="activity-group" aria-labelledby={`activity-${title.toLowerCase()}`}>
      <div className="activity-group-heading">
        <h3 id={`activity-${title.toLowerCase()}`}>{title}</h3>
        <span>{items.length}</span>
      </div>
      <div className="activity-list">
        {items.map((item) => (
          <article
            key={item.job_id}
            className={`activity-row${item.notification_id && !item.read_at ? ' is-unread' : ''}`}
          >
            <button type="button" className="activity-row-main" onClick={() => onOpen(item)}>
              <ActivityIcon item={item} />
              <span className="activity-row-copy">
                <strong>{item.campaign_name}</strong>
                <span>{generationActivityLabel(item)}</span>
                <small>
                  {formatElapsed(elapsedSeconds(item, now))}
                  {item.status === 'retrying' || item.retry_count > 0
                    ? ` · ${item.retry_count} ${item.retry_count === 1 ? 'retry' : 'retries'}`
                    : ''}
                </small>
              </span>
              {item.notification_id && !item.read_at && (
                <span className="activity-unread-dot" aria-label="Unread" />
              )}
            </button>
            {item.status === 'awaiting_review' && (
              <button
                type="button"
                className="activity-retry"
                onClick={() => onOpen(item)}
              >
                <BadgeCheck size={14} aria-hidden="true" />
                Review assets
              </button>
            )}
            {canRetryGeneration(item) && (
              <button
                type="button"
                className="activity-retry"
                onClick={() => onRetry(item)}
              >
                <RotateCcw size={14} aria-hidden="true" />
                Retry with same inputs
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

function ActivityIcon({ item }: { item: GenerationActivityItem }) {
  if (item.status === 'succeeded') {
    return <CheckCircle2 className="activity-icon is-ready" size={18} aria-hidden="true" />
  }
  if (item.status === 'failed') {
    return <AlertCircle className="activity-icon is-failed" size={18} aria-hidden="true" />
  }
  if (item.status === 'canceled') {
    return <XCircle className="activity-icon is-failed" size={18} aria-hidden="true" />
  }
  if (item.status === 'awaiting_review') {
    return <BadgeCheck className="activity-icon is-ready" size={18} aria-hidden="true" />
  }
  return <LoaderCircle className="activity-icon generation-stage-spinner" size={18} aria-hidden="true" />
}
