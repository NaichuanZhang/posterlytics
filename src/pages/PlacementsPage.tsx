import { Copy, MapPin, Plus, Trash2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppShell } from '../components/AppShell'
import { PosterExportButton } from '../components/PosterExportButton'
import { QrCode } from '../components/QrCode'
import { EmptyState, InlineNotice } from '../components/ui/Feedback'
import { Spinner } from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { useCampaign } from '../hooks/useCampaign'
import { usePlacements } from '../hooks/usePlacements'
import { usePosterGenerations } from '../hooks/usePosterGenerations'
import { overlayGeneration } from '../lib/generations'
import { getPosterSize, hasPosterQrBand } from '../lib/posterSize'
import { buildViewUrl } from '../lib/viewUrl'
import { useI18n } from '../i18n/I18nProvider'
import { getUseCase } from '../lib/useCases'

export function PlacementsPage() {
  const { formatDate, t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { notify } = useToast()
  const { campaign, loading } = useCampaign(id)
  const trackingEnabled = campaign
    ? getUseCase(campaign.use_case).trackingEnabled
    : false
  const {
    generations,
    loading: generationsLoading,
    error: generationsError,
  } = usePosterGenerations(id)
  const { placements, addPlacement, removePlacement } = usePlacements(
    id,
    user?.id,
    trackingEnabled,
  )
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
      notify(t('Placement could not be added.'), 'error')
    } else {
      setLabel('')
      notify(t('Placement added.'), 'success')
    }
    setBusy(false)
  }

  function copyLink(code: string) {
    void navigator.clipboard?.writeText(buildViewUrl(code))
    notify(t('Tracked link copied.'), 'success')
  }

  async function deletePlacement(placementId: string) {
    setDeletingId(placementId)
    setError(null)
    const placementError = await removePlacement(placementId)
    if (placementError) {
      setError(placementError)
      notify(t('Placement could not be deleted.'), 'error')
    } else {
      notify(t('Placement deleted.'), 'success')
    }
    setDeletingId(null)
    setConfirmingId(null)
  }

  if (loading || generationsLoading) {
    return (
      <AppShell breadcrumbs={[
        { label: t('Campaigns'), to: '/' },
        { label: t('Placements') },
      ]}>
        <Spinner full />
      </AppShell>
    )
  }
  if (!campaign) {
    return (
      <AppShell breadcrumbs={[
        { label: t('Campaigns'), to: '/' },
        { label: t('Not found') },
      ]}>
        <InlineNotice tone="error">{t('Campaign not found.')}</InlineNotice>
      </AppShell>
    )
  }
  if (!trackingEnabled) {
    return <Navigate to={`/campaigns/${campaign.id}`} replace />
  }

  const currentGeneration =
    generations.find((generation) => generation.id === campaign.current_generation_id) ?? null
  const exportCampaign = campaign.current_generation_id
    ? currentGeneration
      ? overlayGeneration(campaign, currentGeneration)
      : null
    : campaign
  const posterSize = exportCampaign
    ? getPosterSize(exportCampaign.poster_format)
    : null
  const includesQrBand = hasPosterQrBand(
    posterSize ?? getPosterSize(campaign.poster_format),
  )

  return (
    <AppShell
      breadcrumbs={[
        { label: t('Campaigns'), to: '/' },
        { label: campaign.product_name, to: `/campaigns/${campaign.id}` },
        { label: t('Placements') },
      ]}
      campaign={campaign}
      activeSection="placements"
    >
      <header className="page-heading page-heading-compact">
        <div>
          <h1>{t('Placements')}</h1>
          <p>
            {t(includesQrBand
              ? 'Each placement has a distinct tracked link and export.'
              : 'Each placement has a distinct tracked link.')}
          </p>
        </div>
        <span className="page-count">{t('{count} total', { count: placements.length })}</span>
      </header>

      {campaign.status !== 'published' && (
        <InlineNotice>
          <strong>{t('This campaign is still a draft.')}</strong>
          <span>{t('Its links start recording visits after publication.')}</span>
        </InlineNotice>
      )}

      {exportCampaign && posterSize && !includesQrBand && (
        <div className="placement-format-export">
          <InlineNotice>
            <span>{t('Artwork-only export. No QR code or placement tracking is included.')}</span>
            <PosterExportButton
              campaign={exportCampaign}
              versionNumber={currentGeneration?.version_number ?? undefined}
              posterSize={posterSize}
            />
          </InlineNotice>
        </div>
      )}

      <form className="placement-create" onSubmit={handleAdd}>
        <label htmlFor="placement-label">{t('Add placement')}</label>
        <div>
          <input
            id="placement-label"
            className="input"
            placeholder={t('Bulletin board, newsletter, conference booth')}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <button className="button button-primary" disabled={busy || !label.trim()}>
            <Plus size={16} aria-hidden="true" />
            {busy ? t('Adding') : t('Add placement')}
          </button>
        </div>
      </form>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {generationsError && <InlineNotice tone="error">{generationsError}</InlineNotice>}

      {placements.length === 0 ? (
        <EmptyState
          icon={<MapPin size={23} />}
          title={t('No placements')}
          description={t('Add a channel above to create its tracked QR and link.')}
        />
      ) : (
        <section className="placement-list" aria-label={t('Campaign placements')}>
          <div className="placement-list-head" aria-hidden="true">
            <span>{t('Placement')}</span>
            <span>{t('Tracked link')}</span>
            <span>{t('Actions')}</span>
          </div>
          {placements.map((placement) => (
            <article key={placement.id} className="placement-row">
              <div className="placement-identity">
                <div className="placement-qr">
                  <QrCode value={buildViewUrl(placement.code)} size={62} />
                </div>
                <div>
                  <strong>{placement.label}</strong>
                  <span>
                    {t('Created {date}', {
                      date: formatDate(placement.created_at, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      }),
                    })}
                  </span>
                </div>
              </div>
              <code>{buildViewUrl(placement.code)}</code>
              <div className="placement-actions">
                {confirmingId === placement.id ? (
                  <div
                    className="row-confirmation"
                    role="alertdialog"
                    aria-label={t('Delete {name}', { name: placement.label })}
                  >
                    <span>{t('Delete?')}</span>
                    <button
                      type="button"
                      className="icon-button icon-button-danger"
                      aria-label={t('Confirm deletion of {name}', { name: placement.label })}
                      disabled={deletingId === placement.id}
                      onClick={() => void deletePlacement(placement.id)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t('Cancel deletion')}
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
                      aria-label={t('Copy {name} tracked link', { name: placement.label })}
                      data-tooltip={t('Copy link')}
                      onClick={() => copyLink(placement.code)}
                    >
                      <Copy size={15} aria-hidden="true" />
                    </button>
                    {exportCampaign && posterSize && includesQrBand && (
                      <PosterExportButton
                        campaign={exportCampaign}
                        placement={placement}
                        versionNumber={currentGeneration?.version_number ?? undefined}
                        variant="icon"
                        posterSize={posterSize}
                      />
                    )}
                    <button
                      type="button"
                      className="icon-button icon-button-danger"
                      aria-label={t('Delete {name}', { name: placement.label })}
                      data-tooltip={t('Delete')}
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
