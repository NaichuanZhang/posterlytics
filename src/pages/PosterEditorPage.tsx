import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { insforge } from '../lib/insforge'
import { useCampaign } from '../hooks/useCampaign'
import { usePlacements } from '../hooks/usePlacements'
import { useAuth } from '../auth/AuthProvider'
import type { ReferenceImage } from '../lib/types'
import { Layout } from '../components/Layout'
import { Spinner } from '../components/ui/Spinner'
import { Poster } from '../components/Poster'
import { LayoutPreview } from '../components/LayoutPreview'
import { PosterExportButton } from '../components/PosterExportButton'
import { GenerationReferences } from '../components/GenerationReferences'
import { buildViewUrl } from '../lib/viewUrl'
import { useElementWidth } from '../hooks/useElementWidth'
import { deleteReferenceImages, uploadReferenceImages } from '../lib/referenceStorage'
import { normalizeReferenceContext, normalizeReferenceImages } from '../lib/references'

export function PosterEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { campaign, loading, reload, remove } = useCampaign(id)
  const { placements, ensureDefault } = usePlacements(id, user?.id)
  const [busy, setBusy] = useState<string | null>(null)
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [referenceContext, setReferenceContext] = useState('')
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([])
  const [pendingReferenceFiles, setPendingReferenceFiles] = useState<File[]>([])
  const [referenceMessage, setReferenceMessage] = useState<string | null>(null)

  // A campaign should always have at least one placement so the poster's QR
  // encodes a real, trackable code (not a dead preview). Create one if missing.
  useEffect(() => {
    if (user?.id) void ensureDefault()
  }, [user?.id, ensureDefault])

  // Keep the selection valid as placements load/change: default to the first, and
  // recover if the selected placement was removed.
  useEffect(() => {
    if (placements.length === 0) {
      if (selectedPlacementId !== null) setSelectedPlacementId(null)
      return
    }
    if (!placements.some((p) => p.id === selectedPlacementId)) {
      setSelectedPlacementId(placements[0].id)
    }
  }, [placements, selectedPlacementId])

  useEffect(() => {
    if (!campaign) return
    setReferenceContext(campaign.reference_context ?? '')
    setReferenceImages(normalizeReferenceImages(campaign.reference_images))
    setPendingReferenceFiles([])
    setReferenceMessage(null)
  }, [campaign?.id])

  if (loading) return <Layout><Spinner full /></Layout>
  if (!campaign) return <Layout><p className="muted">Campaign not found.</p></Layout>

  // The preview, download, and copy-link all act on the selected placement (the
  // first by default). ensureDefault guarantees one exists soon.
  const selectedPlacement = placements.find((p) => p.id === selectedPlacementId) ?? placements[0] ?? null
  const previewCode = selectedPlacement?.code ?? null
  const published = campaign.status === 'published'

  function copyLink() {
    if (!selectedPlacement) return
    navigator.clipboard?.writeText(buildViewUrl(selectedPlacement.code))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // Spec card rows: events show their logistics; products show the AI-designed
  // layout's composition/mood (every product poster is designer-mode now).
  const isEventCampaign = campaign.scenario === 'event'
  const layout = campaign.poster_layout
  const specRows: Array<{ label: string; value?: string }> = [
    { label: 'Composition', value: layout?.composition },
    { label: 'Mood', value: layout?.mood },
    { label: 'Art style', value: layout?.art_style },
  ]
  const styleLabel = isEventCampaign ? 'Event promo' : 'Designer'

  async function persistReferences() {
    if (!campaign || !user) throw new Error('Campaign is not ready.')

    const uploaded = await uploadReferenceImages(user.id, campaign.id, pendingReferenceFiles)
    const nextImages = [...referenceImages, ...uploaded]
    const { error: updateError } = await insforge.database
      .from('campaigns')
      .update({
        reference_context: normalizeReferenceContext(referenceContext),
        reference_images: nextImages,
      })
      .eq('id', campaign.id)

    if (updateError) {
      await deleteReferenceImages(uploaded)
      throw new Error(updateError.message)
    }

    const retainedKeys = new Set(nextImages.map((image) => image.key))
    const removed = normalizeReferenceImages(campaign.reference_images)
      .filter((image) => !retainedKeys.has(image.key))
    await deleteReferenceImages(removed)

    setReferenceImages(nextImages)
    setPendingReferenceFiles([])
    await reload()
  }

  async function saveReferences() {
    setBusy('references')
    setReferenceMessage(null)
    try {
      await persistReferences()
      setReferenceMessage('References saved.')
    } catch (cause) {
      setReferenceMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  async function regenerate() {
    if (!campaign) return
    setBusy('regen')
    setReferenceMessage(null)
    try {
      await persistReferences()
      await invokeGenerationFunction('analyze', campaign.id)
      if (!isEventCampaign) {
        await invokeGenerationFunction('designer', campaign.id)
      }
      await invokeGenerationFunction('hero', campaign.id)
      await reload()
    } catch (cause) {
      setReferenceMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  // Reroll just the bespoke layout (designer style): re-design then re-paint,
  // without re-running analyze. Independent of the poster spec.
  async function regenerateLayout() {
    if (!campaign) return
    setBusy('layout')
    setReferenceMessage(null)
    try {
      await invokeGenerationFunction('designer', campaign.id)
      await invokeGenerationFunction('hero', campaign.id)
      await reload()
    } catch (cause) {
      setReferenceMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  async function setStatus(status: 'published' | 'draft') {
    if (!campaign) return
    setBusy(status)
    await insforge.database.from('campaigns').update({ status }).eq('id', campaign.id)
    await reload()
    setBusy(null)
  }

  // Permanently delete the campaign and its visit data, then clean up storage.
  async function deleteCampaign() {
    if (!campaign) return
    setBusy('delete')
    try {
      await remove()
      navigate('/')
    } catch (e) {
      window.alert(`Couldn't delete the campaign: ${e instanceof Error ? e.message : String(e)}`)
      setConfirmingDelete(false)
      setBusy(null)
    }
  }

  return (
    <Layout>
      {/* Editor = inspector + canvas. Single canvas-first DOM order; CSS grid
          areas place the control rail LEFT on desktop, and the single-column
          mobile flow drops it to the BOTTOM (no `order` needed). See .poster-editor
          in index.css. */}
      <div className="poster-editor">
        <header className="ed-head">
          <div className="row between" style={{ marginBottom: 4 }}>
            <h1 className="page-title">{campaign.product_name}</h1>
            <span className={`badge ${campaign.status}`}>{campaign.status}</span>
          </div>
          <p className="page-sub" style={{ margin: 0 }}>
            <Link to="/">← All campaigns</Link>
          </p>
        </header>

        {!published && (
          <div className="ed-banner card" style={{ borderColor: 'var(--accent)' }}>
            <div className="row between" style={{ gap: 12, alignItems: 'center' }}>
              <span>
                <strong style={{ color: 'var(--accent)' }}>Draft — not live.</strong>{' '}
                <span className="muted">
                  The QR works once you publish; scanning it now shows a "not live yet" page.
                </span>
              </span>
              <button className="btn sm" onClick={() => setStatus('published')} disabled={!!busy}>
                {busy === 'published' ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>
        )}

        {/* Canvas: the poster preview. DOM-before the rail so mobile stacks it on
            top. The PreviewCell measures its own cell and scales. */}
        <section className="ed-canvas">
          <PreviewCell label="Poster">
            {(w) =>
              // A layout designed but no painted image yet (fresh design,
              // mid-regenerate, or a failed paint): show the bespoke layout wireframe
              // instead of AiPoster's "still generating…" placeholder.
              !isEventCampaign && campaign.poster_layout && !campaign.hero_image_url ? (
                <LayoutPreview layout={campaign.poster_layout} width={w} />
              ) : previewCode ? (
                <Poster campaign={campaign} code={previewCode} width={w} />
              ) : (
                <p className="muted" style={{ padding: 24, textAlign: 'center' }}>Preparing your placement…</p>
              )
            }
          </PreviewCell>
        </section>

        {/* Control rail: the 4 cards, placed LEFT on desktop / BOTTOM on mobile. */}
        <aside className="ed-rail">
          <div className="card">
            <h3 style={{ margin: '0 0 8px' }}>Generation references</h3>
            <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 14px' }}>
              These are included the next time you regenerate the poster.
            </p>
            <GenerationReferences
              context={referenceContext}
              onContextChange={setReferenceContext}
              existingImages={referenceImages}
              onRemoveExisting={(image) => setReferenceImages((images) => images.filter((item) => item.key !== image.key))}
              pendingFiles={pendingReferenceFiles}
              onPendingFilesChange={setPendingReferenceFiles}
              disabled={!!busy}
            />
            <button className="btn secondary sm" onClick={saveReferences} disabled={!!busy} style={{ marginTop: 14 }}>
              {busy === 'references' ? 'Saving...' : 'Save references'}
            </button>
            {referenceMessage && <p className="hint" role="status">{referenceMessage}</p>}
          </div>

          <div className="card">
            <h3 style={{ margin: '0 0 10px' }}>Poster spec</h3>
            <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 12px' }}>
              An AI art director designs the layout from your brand. Regenerate for a fresh take.
            </p>
            <dl style={{ margin: 0, display: 'grid', gap: 8, fontSize: '0.9rem' }}>
              <Row label="Style" value={styleLabel} />
              {specRows.map((r) => (
                <Row key={r.label} label={r.label} value={r.value} />
              ))}
              <Row label="Tone" value={campaign.style_profile?.tone} />
            </dl>

            {!campaign.hero_image_url && (
              <p className="hint" style={{ marginTop: 6 }}>AI poster not generated yet — Regenerate to paint it.</p>
            )}
            <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
              <button className="btn secondary sm" onClick={regenerate} disabled={!!busy}>
                {busy === 'regen' ? 'Regenerating…' : '↻ Regenerate'}
              </button>
              {!isEventCampaign && (
                <button className="btn secondary sm" onClick={regenerateLayout} disabled={!!busy}>
                  {busy === 'layout' ? 'Designing…' : '↻ Regenerate layout'}
                </button>
              )}
            </div>
            {!isEventCampaign && campaign.design_status === 'failed' && (
              <p className="hint" style={{ marginTop: 6 }}>Layout design failed — try Regenerate layout.</p>
            )}
          </div>

          <div className="card">
            <h3 style={{ margin: '0 0 8px' }}>Placements & tracking</h3>
            <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 12px' }}>
              {placements.length} placement{placements.length === 1 ? '' : 's'}. The preview and
              download below use the selected placement's unique QR + link.
            </p>

            {placements.length === 0 ? (
              <p className="muted" style={{ marginBottom: 12 }}>Preparing your placement…</p>
            ) : (
              <>
                <div className="field" style={{ marginBottom: 12 }}>
                  <label>Placement</label>
                  <select
                    className="input"
                    value={selectedPlacement?.id ?? ''}
                    onChange={(e) => setSelectedPlacementId(e.target.value)}
                  >
                    {placements.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
                  {selectedPlacement && (
                    <PosterExportButton
                      key={selectedPlacement.id}
                      campaign={campaign}
                      placement={selectedPlacement}
                      label="Download poster"
                    />
                  )}
                  <button className="btn secondary sm" onClick={copyLink} disabled={!selectedPlacement}>
                    {copied ? 'Copied!' : 'Copy link'}
                  </button>
                </div>
              </>
            )}

            <div className="row wrap">
              <Link to={`/campaigns/${campaign.id}/placements`} className="btn secondary sm">
                Manage placements
              </Link>
              <Link to={`/campaigns/${campaign.id}/analytics`} className="btn secondary sm">
                View analytics
              </Link>
            </div>
          </div>

          <div className="card">
            <h3 style={{ margin: '0 0 8px' }}>{published ? 'Live' : 'Publish'}</h3>
            <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 12px' }}>
              {published
                ? 'Live. Every QR scan is tracked and redirected to your product.'
                : 'Publish to make the QR live — scans redirect to your product and are tracked.'}
            </p>
            {published ? (
              <button className="btn danger sm" onClick={() => setStatus('draft')} disabled={!!busy}>
                {busy === 'draft' ? 'Unpublishing…' : 'Unpublish'}
              </button>
            ) : (
              <button className="btn" onClick={() => setStatus('published')} disabled={!!busy}>
                {busy === 'published' ? 'Publishing…' : 'Publish campaign'}
              </button>
            )}

            {/* Danger zone: permanently delete the campaign (two-step confirm). */}
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: 'var(--line) solid var(--hairline)' }}>
              {confirmingDelete ? (
                <>
                  <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 10px' }}>
                    Delete permanently? Its placements and visit history are removed too - this cannot be undone.
                  </p>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <button className="btn danger sm" onClick={deleteCampaign} disabled={!!busy}>
                      {busy === 'delete' ? 'Deleting…' : 'Confirm delete'}
                    </button>
                    <button className="btn ghost sm" onClick={() => setConfirmingDelete(false)} disabled={!!busy}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <button className="btn danger sm" onClick={() => setConfirmingDelete(true)} disabled={!!busy}>
                  Delete campaign
                </button>
              )}
            </div>
          </div>

        </aside>
      </div>
    </Layout>
  )
}

// One titled preview as its own card. Measures its own (content-box) width and
// hands a fitted pixel width to its child so the poster scales to the
// card at any window size (never overflows, never collapses to a stacked column).
function PreviewCell({ label, children }: { label: string; children: (width: number) => React.ReactNode }) {
  const [ref, width] = useElementWidth()
  // Leave a hair of slack so the rounded preview never touches the card edge.
  const fitted = width > 0 ? Math.max(160, Math.floor(width) - 2) : 0
  return (
    <div ref={ref} className="card ed-preview">
      <span className="muted" style={{ fontSize: '0.8rem', fontWeight: 600 }}>{label}</span>
      {fitted > 0 ? children(fitted) : null}
    </div>
  )
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
      <dt className="muted" style={{ flex: '0 0 84px' }}>{label}</dt>
      <dd style={{ margin: 0, textAlign: 'right', flex: 1 }}>{value || '—'}</dd>
    </div>
  )
}

async function invokeGenerationFunction(slug: 'analyze' | 'designer' | 'hero', campaignId: string) {
  const { error } = await insforge.functions.invoke(slug, { body: { campaignId } })
  if (error) throw new Error(error.message ?? `${slug} failed`)
}
