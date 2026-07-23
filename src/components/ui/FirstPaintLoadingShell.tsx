import { useI18n } from '../../i18n/I18nProvider'

export function FirstPaintLoadingShell() {
  const { t } = useI18n()

  return (
    <div
      className="first-paint-shell"
      data-first-paint-shell="react"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={t('Loading')}
    >
      <div className="first-paint-brand" aria-hidden="true">
        <span className="first-paint-brand-mark">P</span>
        <span>Posterlytics</span>
      </div>
      <div className="first-paint-progress">
        <span className="first-paint-spinner" aria-hidden="true" />
        <span className="first-paint-label">{t('Loading')}</span>
      </div>
    </div>
  )
}
