import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react'
import { useWorkspacePreferences } from '../hooks/useWorkspacePreferences'
import {
  formatLocalizedDate,
  translate,
  type SupportedLocale,
  type Translate,
} from '../lib/i18n'

interface I18nContextValue {
  locale: SupportedLocale
  setLocale: (locale: SupportedLocale) => void
  t: Translate
  formatDate: (value: string | number | Date, options: Intl.DateTimeFormatOptions) => string
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const { preferences, updatePreferences } = useWorkspacePreferences()
  const locale = preferences.locale

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((nextLocale: SupportedLocale) => {
    updatePreferences({ locale: nextLocale })
  }, [updatePreferences])

  const t = useCallback<Translate>(
    (key, values) => translate(locale, key, values),
    [locale],
  )
  const formatDate = useCallback((
    value: string | number | Date,
    options: Intl.DateTimeFormatOptions,
  ) => formatLocalizedDate(locale, value, options), [locale])
  const formatNumber = useCallback((
    value: number,
    options?: Intl.NumberFormatOptions,
  ) => new Intl.NumberFormat(locale, options).format(value), [locale])

  const context = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t,
    formatDate,
    formatNumber,
  }), [formatDate, formatNumber, locale, setLocale, t])

  return (
    <I18nContext.Provider value={context}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}
