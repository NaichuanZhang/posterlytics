import {
  AlertCircle,
  Check,
  Clipboard,
  FileJson,
  ImageOff,
  LoaderCircle,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchGenerationAssets } from '../lib/generationApi'
import { fetchGenerationStageTraces } from '../lib/generationTraceApi'
import {
  generationTraceAvailability,
  reconstructLegacyImageAssets,
  TRACE_SOURCE_LABELS,
  TRACE_STAGE_LABELS,
  TRACE_STAGE_ORDER,
} from '../lib/generationTraces'
import type {
  GenerationAsset,
  GenerationStageTrace,
  GenerationTraceStage,
  ModelCallTrace,
  PosterGeneration,
  TraceImageAsset,
} from '../lib/types'

interface Props {
  generation: PosterGeneration
  generations: PosterGeneration[]
  onClose: () => void
}

export function GenerationDetailsSheet({
  generation,
  generations,
  onClose,
}: Props) {
  const [traces, setTraces] = useState<GenerationStageTrace[]>([])
  const [generationAssets, setGenerationAssets] = useState<GenerationAsset[]>([])
  const [loading, setLoading] = useState(generation.trace_schema_version !== null)
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<GenerationTraceStage>('hero')
  const [selectedAsset, setSelectedAsset] = useState<TraceImageAsset | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const generationRunning = isRunningGeneration(generation)

  const parent = generations.find(
    (candidate) => candidate.id === generation.parent_generation_id,
  ) ?? null
  const legacyAssets = useMemo(
    () => reconstructLegacyImageAssets(generation, parent),
    [generation, parent],
  )
  const activeTrace = traces.find((trace) => trace.stage === stage) ?? null
  const stageOrder = generation.trace_schema_version !== null
    && generation.trace_schema_version >= 2
    ? TRACE_STAGE_ORDER
    : TRACE_STAGE_ORDER.filter((key) => key !== 'assets')
  const availability = error
    ? 'incomplete'
    : generationTraceAvailability(generation, traces)
  const assets = (stage === 'assets'
    ? activeTrace?.candidate_images
    : activeTrace?.attached_images)
    ?? (availability === 'legacy' && stage === 'hero' ? legacyAssets : [])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    if (generation.trace_schema_version === null) {
      setLoading(false)
      return
    }

    async function refreshTraces() {
      try {
        const [rows, assetRows] = await Promise.all([
          fetchGenerationStageTraces(generation.id),
          generation.trace_schema_version !== null && generation.trace_schema_version >= 2
            ? fetchGenerationAssets(generation.id)
            : Promise.resolve([]),
        ])
        if (!cancelled) {
          setTraces(rows)
          setGenerationAssets(assetRows)
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          if (generationRunning) {
            timer = window.setTimeout(() => void refreshTraces(), 3000)
          }
        }
      }
    }

    void refreshTraces()

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [generation.id, generation.trace_schema_version, generationRunning])

  useEffect(() => {
    setSelectedAsset(assets[0] ?? null)
  }, [activeTrace, availability, stage])

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !sheetRef.current) return
      const focusable = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [onClose])

  async function copyManifest(call: ModelCallTrace) {
    const key = `${stage}-${call.attempt}`
    await navigator.clipboard?.writeText(JSON.stringify({
      operation: call.operation,
      provider: call.provider,
      model_id: call.model_id,
      provider_settings: call.provider_settings,
      content_manifest: call.content_manifest,
    }, null, 2))
    setCopied(key)
    window.setTimeout(() => setCopied((value) => value === key ? null : value), 1800)
  }

  return (
    <div className="generation-details-layer">
      <button
        type="button"
        className="generation-details-backdrop"
        aria-label="Close generation details"
        onClick={onClose}
      />
      <aside
        ref={sheetRef}
        className="generation-details-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="generation-details-title"
      >
        <header className="generation-details-header">
          <div>
            <span>
              {generation.status === 'failed'
                ? 'Failed attempt'
                : generation.status === 'canceled'
                  ? 'Canceled attempt'
                : generationRunning
                  ? 'Generation in progress'
                  : `Version ${generation.version_number ?? '-'}`}
            </span>
            <h2 id="generation-details-title">Generation details</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            aria-label="Close generation details"
            onClick={onClose}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="generation-details-scroll">
          <section className="generation-details-context" aria-label="Generation context">
            <dl>
              <div>
                <dt>Instruction</dt>
                <dd>{generation.instruction || 'Initial website-based poster'}</dd>
              </div>
              <div>
                <dt>Parent</dt>
                <dd>{parent ? `Version ${parent.version_number ?? '-'}` : 'No parent'}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{generation.generation_mode === 'website_refresh' ? 'Website refresh' : 'Iteration'}</dd>
              </div>
              {generation.asset_selection_mode && (
                <div>
                  <dt>Assets</dt>
                  <dd>
                    {generation.asset_selection_mode === 'editor' ? 'Editor' : 'Yolo'}
                    {generation.asset_selection_method
                      ? ` · ${formatSelectionMethod(generation.asset_selection_method)}`
                      : ''}
                  </dd>
                </div>
              )}
            </dl>
            {generation.status === 'failed' && (
              <div className="generation-failure-summary">
                <AlertCircle size={15} aria-hidden="true" />
                <div>
                  <strong>{generation.failure_code || 'Generation failed'}</strong>
                  <span>{generation.failure_message || 'The generation did not complete.'}</span>
                </div>
              </div>
            )}
          </section>

          {availability === 'legacy' && (
            <div className="trace-state trace-state-legacy">
              <AlertCircle size={16} aria-hidden="true" />
              <div>
                <strong>Exact trace unavailable</strong>
                <span>This version predates request tracing. Available snapshots are a partial reconstruction.</span>
              </div>
            </div>
          )}
          {!loading && availability === 'incomplete' && (
            <div className="trace-state trace-state-incomplete">
              <AlertCircle size={16} aria-hidden="true" />
              <div>
                <strong>Trace incomplete</strong>
                <span>Some request details could not be recorded. Captured fields are shown without claiming exactness.</span>
                {error && <small>{error}</small>}
              </div>
            </div>
          )}

          <div className="generation-detail-tabs" role="tablist" aria-label="Generation stages">
            {stageOrder.map((key) => {
              const trace = traces.find((item) => item.stage === key)
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={stage === key}
                  className={stage === key ? 'is-active' : ''}
                  onClick={() => setStage(key)}
                >
                  {TRACE_STAGE_LABELS[key]}
                  {trace && <span className={`trace-tab-status is-${trace.status}`} />}
                </button>
              )
            })}
          </div>

          {loading ? (
            <div className="generation-details-loading" aria-busy="true">
              <LoaderCircle size={20} className="is-spinning" aria-hidden="true" />
              <span>Loading captured inputs</span>
            </div>
          ) : (
            <StageTraceView
              trace={activeTrace}
              assets={assets}
              selectedAsset={selectedAsset}
              onSelectAsset={setSelectedAsset}
              legacy={availability === 'legacy'}
              copied={copied}
              generation={generation}
              generationAssets={generationAssets}
              onCopyManifest={(call) => void copyManifest(call)}
            />
          )}
        </div>
        <span className="sr-only" aria-live="polite">
          {copied ? 'Request manifest copied.' : ''}
        </span>
      </aside>
    </div>
  )
}

function isRunningGeneration(generation: PosterGeneration): boolean {
  return ['created', 'analyzing', 'reviewing', 'designing', 'painting'].includes(generation.status)
}

function StageTraceView({
  trace,
  assets,
  selectedAsset,
  onSelectAsset,
  legacy,
  copied,
  generation,
  generationAssets,
  onCopyManifest,
}: {
  trace: GenerationStageTrace | null
  assets: TraceImageAsset[]
  selectedAsset: TraceImageAsset | null
  onSelectAsset: (asset: TraceImageAsset) => void
  legacy: boolean
  copied: string | null
  generation: PosterGeneration
  generationAssets: GenerationAsset[]
  onCopyManifest: (call: ModelCallTrace) => void
}) {
  if (!trace && !legacy) {
    return <p className="generation-detail-empty">No captured data is available for this stage.</p>
  }

  return (
    <div className="generation-stage-detail">
      {trace && (
        <div className="generation-stage-status">
          <span className={`trace-status-badge is-${trace.status}`}>{trace.status}</span>
          {trace.started_at && <time dateTime={trace.started_at}>{formatDate(trace.started_at)}</time>}
        </div>
      )}

      {trace?.stage === 'assets' && (
        <AssetSelectionAudit
          generation={generation}
          assets={generationAssets}
          trace={trace}
        />
      )}

      <section className="trace-section" aria-labelledby="trace-images-heading">
        <div className="trace-section-heading">
          <h3 id="trace-images-heading">
            {legacy
              ? 'Available snapshots'
              : trace?.stage === 'assets'
                ? 'Candidate images'
                : 'Attached images'}
          </h3>
          <span>{assets.length}</span>
        </div>
        {assets.length === 0 ? (
          <p className="generation-detail-empty">No images were attached to this stage.</p>
        ) : (
          <>
            <div className="trace-image-strip">
              {assets.map((asset, index) => (
                <button
                  key={`${asset.source}-${asset.model_position ?? index}-${asset.key ?? asset.url ?? index}`}
                  type="button"
                  className={selectedAsset === asset ? 'is-selected' : ''}
                  aria-pressed={selectedAsset === asset}
                  onClick={() => onSelectAsset(asset)}
                >
                  <span className="trace-thumbnail">
                    <TraceImage asset={asset} />
                    <b>{asset.model_position ?? index + 1}</b>
                  </span>
                  <span className={`trace-source-badge is-${asset.source}`}>
                    {TRACE_SOURCE_LABELS[asset.source]}
                  </span>
                </button>
              ))}
            </div>
            {selectedAsset && <TraceAssetInspector asset={selectedAsset} />}
          </>
        )}
      </section>

      {trace && trace.skipped_images.length > 0 && (
        <details className="trace-disclosure">
          <summary>
            Skipped candidates
            <span>{trace.skipped_images.length}</span>
          </summary>
          <ul className="trace-skipped-list">
            {trace.skipped_images.map((skip, index) => (
              <li key={`${skip.reason}-${skip.asset.candidate_position}-${index}`}>
                <span className={`trace-source-badge is-${skip.asset.source}`}>
                  {TRACE_SOURCE_LABELS[skip.asset.source]}
                </span>
                <div>
                  <strong>{skip.asset.filename || `Candidate ${skip.asset.candidate_position}`}</strong>
                  <span>{skip.detail}</span>
                </div>
                <code>{skip.reason.replace(/_/g, ' ')}</code>
              </li>
            ))}
          </ul>
        </details>
      )}

      {trace && trace.model_calls.length > 0 && (
        <details className="trace-disclosure">
          <summary>
            Prompts, retries, and model configuration
            <span>{trace.model_calls.length}</span>
          </summary>
          <div className="trace-call-list">
            {trace.model_calls.map((call) => (
              <div key={call.attempt} className="trace-call">
                <div className="trace-call-heading">
                  <div>
                    <strong>Attempt {call.attempt}</strong>
                    <span>{call.model_id}</span>
                  </div>
                  <span className={`trace-status-badge is-${call.status}`}>{call.status}</span>
                </div>
                {call.prompt.system && <PromptBlock label="System prompt" text={call.prompt.system} />}
                {call.prompt.user && <PromptBlock label="User prompt" text={call.prompt.user} />}
                {call.prompt.image && <PromptBlock label="Image prompt" text={call.prompt.image} />}
                <div className="trace-config">
                  <span>Provider settings</span>
                  <pre>{JSON.stringify(call.provider_settings, null, 2)}</pre>
                </div>
                {call.failure && (
                  <div className="trace-call-failure">
                    <AlertCircle size={14} aria-hidden="true" />
                    <span>{call.failure.message}</span>
                  </div>
                )}
                <details className="trace-manifest">
                  <summary>
                    <FileJson size={14} aria-hidden="true" />
                    Request manifest
                  </summary>
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={() => onCopyManifest(call)}
                  >
                    {copied?.endsWith(`-${call.attempt}`)
                      ? <Check size={13} aria-hidden="true" />
                      : <Clipboard size={13} aria-hidden="true" />}
                    {copied?.endsWith(`-${call.attempt}`) ? 'Copied' : 'Copy manifest'}
                  </button>
                  <pre>{JSON.stringify(call.content_manifest, null, 2)}</pre>
                </details>
              </div>
            ))}
          </div>
        </details>
      )}

      {trace && trace.artifacts.length > 0 && (
        <details className="trace-disclosure">
          <summary>
            Stage artifacts
            <span>{trace.artifacts.length}</span>
          </summary>
          <div className="trace-artifact-list">
            {trace.artifacts.map((artifact, index) => (
              <div key={`${artifact.kind}-${index}`}>
                <strong>{artifact.kind.replace('-', ' ')}</strong>
                {artifact.url && <a href={artifact.url} target="_blank" rel="noreferrer">Open image</a>}
                {artifact.snapshot !== undefined && (
                  <pre>{JSON.stringify(artifact.snapshot, null, 2)}</pre>
                )}
                {artifact.metadata && (
                  <pre>{JSON.stringify(artifact.metadata, null, 2)}</pre>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {trace?.status === 'failed' && (
        <div className="trace-failure">
          <AlertCircle size={16} aria-hidden="true" />
          <div>
            <strong>{trace.failure_code || 'Stage failed'}</strong>
            <span>{trace.failure_message}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function AssetSelectionAudit({
  generation,
  assets,
  trace,
}: {
  generation: PosterGeneration
  assets: GenerationAsset[]
  trace: GenerationStageTrace
}) {
  const selected = assets.filter((asset) => asset.included)
  const aiAttempts = typeof trace.failure_metadata.ai_attempts === 'number'
    ? trace.failure_metadata.ai_attempts
    : trace.model_calls.length
  const fallback = trace.failure_metadata.fallback === true
    || generation.asset_selection_method === 'rules_fallback'

  return (
    <section className="asset-audit" aria-labelledby="asset-audit-heading">
      <div className="trace-section-heading">
        <h3 id="asset-audit-heading">Selection audit</h3>
        <span>{selected.length}/6</span>
      </div>
      <dl className="asset-audit-summary">
        <div>
          <dt>Mode</dt>
          <dd>{generation.asset_selection_mode === 'editor' ? 'Editor' : 'Yolo'}</dd>
        </div>
        <div>
          <dt>Method</dt>
          <dd>{formatSelectionMethod(generation.asset_selection_method)}</dd>
        </div>
        <div>
          <dt>AI attempts</dt>
          <dd>{aiAttempts}</dd>
        </div>
        <div>
          <dt>Fallback</dt>
          <dd>{fallback ? 'Rules fallback' : 'No'}</dd>
        </div>
      </dl>
      {assets.length > 0 && (
        <div className="asset-audit-list">
          {assets.map((asset) => (
            <article key={asset.id} className={asset.included ? 'is-included' : ''}>
              <div>
                <span className={`trace-source-badge is-${asset.source}`}>
                  {TRACE_SOURCE_LABELS[asset.source]}
                </span>
                <strong>{asset.filename || `Candidate ${asset.candidate_position}`}</strong>
              </div>
              <span className="asset-audit-decision">
                {asset.included ? `Included · ${asset.selection_rank}` : 'Excluded'}
              </span>
              <p>{asset.selection_reason || asset.availability_reason || 'No reason recorded.'}</p>
              {asset.provider_skips.length > 0 && (
                <ul>
                  {asset.provider_skips.map((skip, index) => (
                    <li key={`${skip.stage}-${skip.reason}-${index}`}>
                      <strong>{skip.stage}</strong>
                      <span>{skip.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function TraceAssetInspector({ asset }: { asset: TraceImageAsset }) {
  return (
    <div className="trace-asset-inspector">
      <div className="trace-asset-preview">
        <TraceImage asset={asset} />
      </div>
      <dl>
        <div><dt>Purpose</dt><dd>{asset.purpose}</dd></div>
        <div><dt>Filename</dt><dd>{asset.filename || 'Unavailable'}</dd></div>
        <div><dt>Type</dt><dd>{asset.mime_type || 'Unavailable'}</dd></div>
        <div><dt>Size</dt><dd>{formatBytes(asset.size_bytes)}</dd></div>
        <div><dt>Storage</dt><dd>{asset.storage_source}</dd></div>
        <div><dt>Model position</dt><dd>{asset.model_position ?? 'Not attached'}</dd></div>
      </dl>
    </div>
  )
}

function TraceImage({ asset }: { asset: TraceImageAsset }) {
  const [failed, setFailed] = useState(false)
  if (!asset.url || failed) {
    return (
      <span className="trace-image-missing">
        <ImageOff size={18} aria-hidden="true" />
        <span>Preview unavailable</span>
      </span>
    )
  }
  return (
    <img
      src={asset.url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

function PromptBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="trace-prompt">
      <span>{label}</span>
      <pre>{text}</pre>
    </div>
  )
}

function formatBytes(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'Unavailable'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatSelectionMethod(
  value: PosterGeneration['asset_selection_method'],
): string {
  if (!value) return 'Pending'
  if (value === 'rules_fallback') return 'Rules fallback'
  if (value === 'retry_reuse') return 'Retry reuse'
  if (value === 'ai') return 'AI'
  return 'User'
}
