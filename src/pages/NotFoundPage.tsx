import { ArrowLeft, FileQuestion } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { EmptyState } from '../components/ui/Feedback'
import { useI18n } from '../i18n/I18nProvider'

export function NotFoundPage() {
  const { t } = useI18n()
  return (
    <AppShell
      breadcrumbs={[
        { label: t('Campaigns'), to: '/' },
        { label: t('Page not found') },
      ]}
    >
      <EmptyState
        icon={<FileQuestion size={24} />}
        title={t('Page not found')}
        description={t('The page may have moved, or the address may be incorrect.')}
        action={(
          <Link to="/" className="button button-primary">
            <ArrowLeft size={16} aria-hidden="true" />
            {t('Back to campaigns')}
          </Link>
        )}
      />
    </AppShell>
  )
}
