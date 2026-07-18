import { Languages } from 'lucide-react'
import { useI18n } from '../i18n/I18nProvider'
import type { SupportedLocale } from '../lib/i18n'

export function LanguageSelect({
  variant = 'default',
}: {
  variant?: 'default' | 'public' | 'rail'
}) {
  const { locale, setLocale, t } = useI18n()
  const compact = variant === 'rail'

  return (
    <label className={`language-select language-select-${variant}`}>
      <Languages size={compact ? 16 : 15} aria-hidden="true" />
      <span className="sr-only">{t('Language')}</span>
      <select
        value={locale}
        aria-label={t('Language')}
        onChange={(event) => setLocale(event.target.value as SupportedLocale)}
      >
        <option value="en-US">{compact ? t('EN') : t('English')}</option>
        <option value="zh-CN">{compact ? t('中') : t('简体中文')}</option>
      </select>
    </label>
  )
}
