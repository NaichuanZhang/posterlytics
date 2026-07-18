import { ArrowLeft, FileQuestion } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { EmptyState } from '../components/ui/Feedback'

export function NotFoundPage() {
  return (
    <AppShell
      breadcrumbs={[
        { label: 'Campaigns', to: '/' },
        { label: 'Page not found' },
      ]}
    >
      <EmptyState
        icon={<FileQuestion size={24} />}
        title="Page not found"
        description="The page may have moved, or the address may be incorrect."
        action={(
          <Link to="/" className="button button-primary">
            <ArrowLeft size={16} aria-hidden="true" />
            Back to campaigns
          </Link>
        )}
      />
    </AppShell>
  )
}
