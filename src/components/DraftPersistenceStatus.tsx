import {
  AlertCircle,
  Check,
  LoaderCircle,
} from 'lucide-react'
import { useI18n } from '../i18n/I18nProvider'
import type { DraftPersistenceState } from '../hooks/useDebouncedLocalDraft'

export function DraftPersistenceStatus({
  status,
}: {
  status: DraftPersistenceState
}) {
  const { t } = useI18n()
  if (status === 'pristine') return null

  return (
    <span
      className={`draft-persistence-status is-${status}`}
      aria-live="polite"
    >
      {status === 'pending' ? (
        <LoaderCircle size={13} className="is-spinning" aria-hidden="true" />
      ) : status === 'saved' ? (
        <Check size={13} aria-hidden="true" />
      ) : (
        <AlertCircle size={13} aria-hidden="true" />
      )}
      {status === 'pending'
        ? t('Saving…')
        : status === 'saved'
          ? t('Saved on this browser')
          : t('Not saved')}
    </span>
  )
}
