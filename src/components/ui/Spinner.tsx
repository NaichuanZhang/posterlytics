import { useI18n } from '../../i18n/I18nProvider'

export function Spinner({ full = false }: { full?: boolean }) {
  const { t } = useI18n()
  return (
    <div className={`spinner-wrap${full ? ' full' : ''}`} role="status" aria-label={t('Loading')}>
      <div className="spinner" />
    </div>
  )
}
