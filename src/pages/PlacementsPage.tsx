import { Copy, MapPin, Plus, Trash2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppShell } from '../components/AppShell'
import { PosterExportButton } from '../components/PosterExportButton'
import { QrCode } from '../components/QrCode'
import { EmptyState, InlineNotice } from '../components/ui/Feedback'
import { Spinner } from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { useCampaign } from '../hooks/useCampaign'
import { usePlacements } from '../hooks/usePlacements'
import { buildViewUrl } from '../lib/viewUrl'

export function PlacementsPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { notify } = useToast()
  const { campaign, loading } = useCampaign(id)
  const { placements, addPlacement, removePlacement } = usePlacements(id, user?.id)
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  async function handleAdd(event: FormEvent) {
    event.preventDefault()
    if (!label.trim()) return
    setBusy(true)
    setError(null)
    const placementError = await addPlacement(label.trim())
    if (placementError) {
      setError(placementError)
      notify('Placement could not be added.', 'error')
    } else {
      setLabel('')
      notify('Placement added.', 'success')
    }
    setBusy(false)
  }

  function copyLink(code: string) {
    void navigator.clipboard?.writeText(buildViewUrl(code))
    notify('Tracked link copied.', 'success')
  }

  async function deletePlacement(placementId: string) {
    setDeletingId(placementId)
    setError(null)
    const placementError = await removePlacement(placementId)
    if (placementError) {
      setError(placementError)
      notify('Placement could not be deleted.', 'error')
    } else {
      notify('Placement deleted.', 'success')
    }
    setDeletingId(null)
    setConfirmingId(null)
  }

  if (loading) {
    return (
      <AppShell breadcrumbs={[{ label: 'Campaigns', to: '/' }, { label: 'Placements' }]}>
        <Spinner full />
      </AppShell>
    )
  }
  if (!campaign) {
    return (
      <AppShell breadcrumbs={[{ label: 'Campaigns', to: '/' }, { label: 'Not found' }]}>
        <InlineNotice tone="error">Campaign not found.</InlineNotice>
      </AppShell>
    )
  }

  return (
    <AppShell
      breadcrumbs={[
        { label: 'Campaigns', to: '/' },
        { label: campaign.product_name, to: `/campaigns/${campaign.id}` },
        { label: 'Placements' },
      ]}
      campaign={campaign}
      activeSection="placements"
    >
      <header className="page-heading page-heading-compact">
        <div>
          <h1>Placements</h1>
          <p>Each placement has a distinct tracked link and export.</p>
        </div>
        <span className="page-count">{placements.length} total</span>
      </header>

      {campaign.status !== 'published' && (
        <InlineNotice>
          <strong>This campaign is still a draft.</strong>
          <span>Its links start recording visits after publication.</span>
        </InlineNotice>
      )}

      <form className="placement-create" onSubmit={handleAdd}>
        <label htmlFor="placement-label">Add placement</label>
        <div>
          <input
            id="placement-label"
            className="input"
            placeholder="Bulletin board, newsletter, conference booth"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <button className="button button-primary" disabled={busy || !label.trim()}>
            <Plus size={16} aria-hidden="true" />
            {busy ? 'Adding' : 'Add placement'}
          </button>
        </div>
      </form>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      {placements.length === 0 ? (
        <EmptyState
          icon={<MapPin size={23} />}
          title="No placements"
          description="Add a channel above to mint its tracked QR and link."
        />
      ) : (
        <section className="placement-list" aria-label="Campaign placements">
          <div className="placement-list-head" aria-hidden="true">
            <span>Placement</span>
            <span>Tracked link</span>
            <span>Actions</span>
          </div>
          {placements.map((placement) => (
            <article key={placement.id} className="placement-row">
              <div className="placement-identity">
                <div className="placement-qr">
                  <QrCode value={buildViewUrl(placement.code)} size={62} />
                </div>
                <div>
                  <strong>{placement.label}</strong>
                  <span>Created {formatDate(placement.created_at)}</span>
                </div>
              </div>
              <code>{buildViewUrl(placement.code)}</code>
              <div className="placement-actions">
                {confirmingId === placement.id ? (
                  <div className="row-confirmation" role="alertdialog" aria-label={`Delete ${placement.label}`}>
                    <span>Delete?</span>
                    <button
                      type="button"
                      className="icon-button icon-button-danger"
                      aria-label={`Confirm deletion of ${placement.label}`}
                      disabled={deletingId === placement.id}
                      onClick={() => void deletePlacement(placement.id)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Cancel deletion"
                      onClick={() => setConfirmingId(null)}
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Copy ${placement.label} tracked link`}
                      data-tooltip="Copy link"
                      onClick={() => copyLink(placement.code)}
                    >
                      <Copy size={15} aria-hidden="true" />
                    </button>
                    <PosterExportButton
                      campaign={campaign}
                      placement={placement}
                      label={`Download ${placement.label} poster`}
                      variant="icon"
                    />
                    <button
                      type="button"
                      className="icon-button icon-button-danger"
                      aria-label={`Delete ${placement.label}`}
                      data-tooltip="Delete"
                      onClick={() => setConfirmingId(placement.id)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
    </AppShell>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}
