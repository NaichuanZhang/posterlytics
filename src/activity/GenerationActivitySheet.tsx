import {
  AlertCircle,
  CheckCheck,
  CheckCircle2,
  Clock3,
  BadgeCheck,
  LoaderCircle,
  RotateCcw,
  SlidersHorizontal,
  X,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  canRetryGeneration,
  elapsedSeconds,
  formatElapsed,
  generationActivityLabel,
  isInputValidationFailure,
  isActiveGenerationJob,
} from '../lib/generationActivity'
import type { GenerationActivityItem } from '../lib/types'
import { EmptyState, InlineNotice } from '../components/ui/Feedback'
import { useI18n } from '../i18n/I18nProvider'

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
  const { t } = useI18n()
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
        aria-label={t('Close generation activity')}
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
            <span>{t('Poster jobs')}</span>
            <h2 id="activity-title">{t('Generation activity')}</h2>
          </div>
          <div>
            {unreadCount > 0 && (
              <button type="button" className="button button-secondary button-small" onClick={onMarkAllRead}>
                <CheckCheck size={14} aria-hidden="true" />
                {t('Mark all read')}
              </button>
            )}
            <button
              ref={closeRef}
              type="button"
              className="icon-button"
              aria-label={t('Close generation activity')}
              onClick={onClose}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="activity-sheet-body">
          {error && (
            <InlineNotice tone="error">
              <strong>{t('Activity could not refresh.')}</strong>
              <span>{error}</span>
            </InlineNotice>
          )}
          {loading && items.length === 0 ? (
            <div className="activity-loading" aria-busy="true">
              <LoaderCircle size={18} className="generation-stage-spinner" aria-hidden="true" />
              {t('Loading generation activity')}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Clock3 size={22} />}
              title={t('No generation activity')}
              description={t('Queued and completed poster jobs will appear here.')}
            />
          ) : (
            <>
              <ActivityGroup
                id="active"
                title={t('Active')}
                items={groups.active}
                now={now}
                onOpen={onOpen}
                onRetry={onRetry}
              />
              <ActivityGroup
                id="unread"
                title={t('Unread')}
                items={groups.unread}
                now={now}
                onOpen={onOpen}
                onRetry={onRetry}
              />
              <ActivityGroup
                id="recent"
                title={t('Recent')}
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
  id,
  title,
  items,
  now,
  onOpen,
  onRetry,
}: {
  id: string
  title: string
  items: GenerationActivityItem[]
  now: number
  onOpen: (item: GenerationActivityItem) => void
  onRetry: (item: GenerationActivityItem) => void
}) {
  const { locale, t } = useI18n()
  if (items.length === 0) return null
  return (
    <section className="activity-group" aria-labelledby={`activity-${id}`}>
      <div className="activity-group-heading">
        <h3 id={`activity-${id}`}>{title}</h3>
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
                <span>{generationActivityLabel(item, locale)}</span>
                <small>
                  {formatElapsed(elapsedSeconds(item, now), locale)}
                  {item.status === 'retrying' || item.retry_count > 0
                    ? ` · ${t(item.retry_count === 1 ? '{count} retry' : '{count} retries', {
                        count: item.retry_count,
                      })}`
                    : ''}
                </small>
              </span>
              {item.notification_id && !item.read_at && (
                <span className="activity-unread-dot" aria-label={t('Unread')} />
              )}
            </button>
            {item.status === 'awaiting_review' && (
              <button
                type="button"
                className="activity-retry"
                onClick={() => onOpen(item)}
              >
                <BadgeCheck size={14} aria-hidden="true" />
                {t('Review assets')}
              </button>
            )}
            {canRetryGeneration(item) && (
              <button
                type="button"
                className="activity-retry"
                onClick={() => onRetry(item)}
              >
                <RotateCcw size={14} aria-hidden="true" />
                {t('Retry with same inputs')}
              </button>
            )}
            {item.status === 'failed' && isInputValidationFailure(item) && (
              // Retrying the same inputs would fail identically and cost another
              // paid generation, so send the user to the editor to correct them.
              <button
                type="button"
                className="activity-retry"
                onClick={() => onOpen(item)}
              >
                <SlidersHorizontal size={14} aria-hidden="true" />
                {t('Fix inputs')}
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
