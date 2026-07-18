import { AlertCircle, BadgeCheck, CheckCircle2, Clock3, LoaderCircle, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  deriveGenerationStages,
  elapsedSeconds,
  formatElapsed,
  generationActivityLabel,
} from '../lib/generationActivity'
import { useI18n } from '../i18n/I18nProvider'
import type { GenerationActivityItem } from '../lib/types'
import { GenerationStageProgress } from './GenerationStageProgress'

export function DurableGenerationStatus({
  item,
  safeToLeave = false,
}: {
  item: GenerationActivityItem
  safeToLeave?: boolean
}) {
  const { locale, t } = useI18n()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (item.completed_at) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [item.completed_at])

  const stages = useMemo(() => deriveGenerationStages(item, locale), [item, locale])
  return (
    <div className="durable-generation-status" aria-live="polite">
      <div className="durable-generation-heading">
        {item.status === 'succeeded' ? (
          <CheckCircle2 className="is-ready" size={18} aria-hidden="true" />
        ) : item.status === 'failed' ? (
          <AlertCircle className="is-failed" size={18} aria-hidden="true" />
        ) : item.status === 'canceled' ? (
          <XCircle className="is-failed" size={18} aria-hidden="true" />
        ) : item.status === 'awaiting_review' ? (
          <BadgeCheck className="is-ready" size={18} aria-hidden="true" />
        ) : (
          <LoaderCircle
            size={18}
            className="generation-stage-spinner"
            aria-hidden="true"
          />
        )}
        <div>
          <strong>{generationActivityLabel(item, locale)}</strong>
          {safeToLeave && item.status !== 'failed' && item.status !== 'succeeded' && item.status !== 'awaiting_review' && (
            <span>{t('Generation started. Safe to leave Posterlytics.')}</span>
          )}
        </div>
        <span className="generation-elapsed">
          <Clock3 size={13} aria-hidden="true" />
          {formatElapsed(elapsedSeconds(item, now), locale)}
        </span>
      </div>
      <GenerationStageProgress stages={stages} />
      {item.status === 'retrying' && item.last_error_message && (
        <p className="generation-retry-note">
          {t('Attempt {current} of {total}', {
            current: Math.min(item.attempt_count + 1, item.max_attempts),
            total: item.max_attempts,
          })}
        </p>
      )}
    </div>
  )
}
