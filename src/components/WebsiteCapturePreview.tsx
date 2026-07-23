import {
  ArrowDown,
  ArrowUp,
  Camera,
  Check,
  ImageOff,
  LoaderCircle,
  RefreshCw,
  X,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
} from 'react'
import { useI18n } from '../i18n/I18nProvider'
import {
  captureWebsitePreview,
  toCapturePreviewError,
  type CapturePreview,
  type CapturePreviewError,
} from '../lib/capturePreview'
import { getDeviceColorScheme } from '../lib/colorScheme'
import {
  createDefaultEagerCaptureSelection,
  type EagerCaptureSelection,
  type SelectedEagerCapture,
} from '../lib/eagerCapture'
import { InlineNotice } from './ui/Feedback'

type CaptureStatus = 'idle' | 'capturing' | 'ready' | 'error'

const CAPTURE_COOLDOWN_MS = 5_000

export function WebsiteCapturePreview({
  url,
  disabled = false,
  onPreviewChange,
  onCaptureInFlightChange,
}: {
  url: string
  disabled?: boolean
  onPreviewChange?: (capture: SelectedEagerCapture | null) => void
  onCaptureInFlightChange?: (inFlight: boolean) => void
}) {
  const { t } = useI18n()
  const [status, setStatus] = useState<CaptureStatus>('idle')
  const [preview, setPreview] = useState<CapturePreview | null>(null)
  const [selection, setSelection] = useState<EagerCaptureSelection>({
    imageUrls: [],
    logoExcluded: false,
  })
  const [error, setError] = useState<CapturePreviewError | null>(null)
  const [coolingDown, setCoolingDown] = useState(false)
  const activeRequest = useRef<AbortController | null>(null)
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestToken = useRef(0)
  const latestUrl = useRef(url)
  latestUrl.current = url

  useEffect(() => {
    requestToken.current += 1
    activeRequest.current?.abort()
    activeRequest.current = null
    if (cooldownTimer.current !== null) {
      clearTimeout(cooldownTimer.current)
      cooldownTimer.current = null
    }
    setCoolingDown(false)
    setStatus('idle')
    setPreview(null)
    setSelection({ imageUrls: [], logoExcluded: false })
    setError(null)
    onPreviewChange?.(null)
    onCaptureInFlightChange?.(false)
  }, [url, onCaptureInFlightChange, onPreviewChange])

  useEffect(() => () => {
    requestToken.current += 1
    activeRequest.current?.abort()
    activeRequest.current = null
    if (cooldownTimer.current !== null) {
      clearTimeout(cooldownTimer.current)
      cooldownTimer.current = null
    }
    onCaptureInFlightChange?.(false)
  }, [onCaptureInFlightChange])

  function startCooldown() {
    if (cooldownTimer.current !== null) clearTimeout(cooldownTimer.current)
    setCoolingDown(true)
    cooldownTimer.current = setTimeout(() => {
      cooldownTimer.current = null
      setCoolingDown(false)
    }, CAPTURE_COOLDOWN_MS)
  }

  async function capture() {
    if (disabled || coolingDown || !url.trim() || activeRequest.current) return

    const requestedUrl = url
    const token = ++requestToken.current
    const controller = new AbortController()
    activeRequest.current = controller
    setStatus('capturing')
    setPreview(null)
    setSelection({ imageUrls: [], logoExcluded: false })
    setError(null)
    onPreviewChange?.(null)
    onCaptureInFlightChange?.(true)

    try {
      const response = await captureWebsitePreview({
        url: requestedUrl,
        colorScheme: getDeviceColorScheme(),
        signal: controller.signal,
      })
      if (
        token !== requestToken.current
        || latestUrl.current !== requestedUrl
      ) {
        return
      }
      const nextSelection = createDefaultEagerCaptureSelection(response.preview)
      setPreview(response.preview)
      setSelection(nextSelection)
      setError(response.error)
      setStatus(response.error ? 'error' : 'ready')
      onPreviewChange?.(response.error
        ? null
        : { preview: response.preview, selection: nextSelection })
      startCooldown()
    } catch (cause) {
      if (
        token !== requestToken.current
        || latestUrl.current !== requestedUrl
        || isAbortError(cause)
      ) {
        return
      }
      setError(toCapturePreviewError(cause))
      setStatus('error')
      onPreviewChange?.(null)
      startCooldown()
    } finally {
      if (token === requestToken.current) {
        activeRequest.current = null
        onCaptureInFlightChange?.(false)
      }
    }
  }

  const capturedImageUrls = preview
    ? createDefaultEagerCaptureSelection(preview).imageUrls
    : []
  const orderedImageUrls = [
    ...selection.imageUrls,
    ...capturedImageUrls.filter((url) => !selection.imageUrls.includes(url)),
  ]
  const hasSourceCandidates = !!preview
    && (!!preview.logoUrl || capturedImageUrls.length > 0)
  const hasEvidence = !!preview && (
    !!preview.styleBoardDataUrl
    || hasSourceCandidates
    || preview.colors.length > 0
    || preview.fonts.length > 0
  )

  function commitSelection(nextSelection: EagerCaptureSelection) {
    if (!preview || status !== 'ready') return
    setSelection(nextSelection)
    onPreviewChange?.({ preview, selection: nextSelection })
  }

  function toggleLogoCandidate() {
    commitSelection({
      ...selection,
      logoExcluded: !selection.logoExcluded,
    })
  }

  function toggleImageCandidate(imageUrl: string) {
    const included = selection.imageUrls.includes(imageUrl)
    commitSelection({
      ...selection,
      imageUrls: included
        ? selection.imageUrls.filter((url) => url !== imageUrl)
        : [...selection.imageUrls, imageUrl],
    })
  }

  function moveImageCandidate(imageUrl: string, direction: -1 | 1) {
    const currentIndex = selection.imageUrls.indexOf(imageUrl)
    const targetIndex = currentIndex + direction
    if (
      currentIndex < 0
      || targetIndex < 0
      || targetIndex >= selection.imageUrls.length
    ) {
      return
    }
    const nextImageUrls = [...selection.imageUrls]
    ;[nextImageUrls[currentIndex], nextImageUrls[targetIndex]] = [
      nextImageUrls[targetIndex],
      nextImageUrls[currentIndex],
    ]
    commitSelection({ ...selection, imageUrls: nextImageUrls })
  }

  return (
    <div className="website-capture-preview field-wide">
      <div className="website-capture-action">
        <span className="website-capture-icon" aria-hidden="true">
          <Camera size={18} />
        </span>
        <strong>{t('Website evidence preview')}</strong>
        <button
          type="button"
          className="button button-secondary button-small"
          disabled={
            disabled
            || coolingDown
            || !url.trim()
            || status === 'capturing'
          }
          onClick={() => void capture()}
        >
          {status === 'capturing' ? (
            <LoaderCircle size={14} className="is-spinning" aria-hidden="true" />
          ) : preview || error ? (
            <RefreshCw size={14} aria-hidden="true" />
          ) : (
            <Camera size={14} aria-hidden="true" />
          )}
          {status === 'capturing'
            ? t('Capturing your site…')
            : preview || error
              ? t('Capture again')
              : t('Capture website')}
        </button>
      </div>

      <div className="website-capture-status" aria-live="polite">
        {error && (
          <InlineNotice tone="warning">
            <strong>
              {error.code === 'invalid_source_url'
                ? t('Enter a complete HTTP or HTTPS website URL.')
                : error.code === 'rate_limited'
                  ? t('Website capture limit reached. Try again shortly.')
                : t('Website preview unavailable.')}
            </strong>
            <span>{t('You can still generate the poster.')}</span>
          </InlineNotice>
        )}
        {status === 'ready' && !hasEvidence && (
          <InlineNotice tone="warning">
            <strong>{t('No website evidence was found.')}</strong>
            <span>{t('You can still generate the poster.')}</span>
          </InlineNotice>
        )}
      </div>

      {hasEvidence && preview && (
        <div
          className="website-evidence-panel"
          aria-label={t('Website evidence preview')}
        >
          {hasSourceCandidates && (
            <div className="website-evidence-candidate-copy">
              <strong>{t('Captured image candidates')}</strong>
              <p>
                {t('Choose which captured images enter the candidate set and set their priority if this evidence is reused. These are preferences, not a guarantee: Editor still includes a final review, and Automatic may omit or reorder images within the included set.')}
              </p>
            </div>
          )}
          {(preview.styleBoardDataUrl || hasSourceCandidates) && (
            <div className="website-evidence-images">
              {preview.styleBoardDataUrl && (
                <EvidenceImage
                  label={t('Website style board')}
                  url={preview.styleBoardDataUrl}
                  featured
                />
              )}
              {preview.logoUrl && (
                <CandidateEvidenceImage
                  label={t('Website logo')}
                  url={preview.logoUrl}
                  included={!selection.logoExcluded}
                  priority={null}
                  canRaise={false}
                  canLower={false}
                  onToggle={toggleLogoCandidate}
                />
              )}
              {orderedImageUrls.map((imageUrl) => {
                const selectedIndex = selection.imageUrls.indexOf(imageUrl)
                const capturedIndex = capturedImageUrls.indexOf(imageUrl)
                return (
                  <CandidateEvidenceImage
                    key={imageUrl}
                    label={t('Product image {number}', {
                      number: capturedIndex + 1,
                    })}
                    url={imageUrl}
                    included={selectedIndex >= 0}
                    priority={selectedIndex >= 0 ? selectedIndex + 1 : null}
                    canRaise={selectedIndex > 0}
                    canLower={
                      selectedIndex >= 0
                      && selectedIndex < selection.imageUrls.length - 1
                    }
                    onToggle={() => toggleImageCandidate(imageUrl)}
                    onRaise={() => moveImageCandidate(imageUrl, -1)}
                    onLower={() => moveImageCandidate(imageUrl, 1)}
                  />
                )
              })}
            </div>
          )}
          {(preview.colors.length > 0 || preview.fonts.length > 0) && (
            <div className="website-evidence-details">
              {preview.colors.length > 0 && (
                <div>
                  <strong>{t('Website colors')}</strong>
                  <div className="website-color-list">
                    {preview.colors.map((color) => (
                      <span
                        key={color}
                        title={color}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              )}
              {preview.fonts.length > 0 && (
                <div>
                  <strong>{t('Website typefaces')}</strong>
                  <span className="website-font-list">
                    {preview.fonts.join(' / ')}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EvidenceImage({
  label,
  url,
  featured,
}: {
  label: string
  url: string
  featured: boolean
}) {
  const { t } = useI18n()
  const [failed, setFailed] = useState(false)

  return (
    <figure className={featured ? 'is-featured' : ''}>
      <div className="website-evidence-image-preview">
        {failed ? (
          <span>
            <ImageOff size={18} aria-hidden="true" />
            {t('Preview unavailable')}
          </span>
        ) : (
          <img
            src={url}
            alt={label}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  )
}

function CandidateEvidenceImage({
  label,
  url,
  included,
  priority,
  canRaise,
  canLower,
  onToggle,
  onRaise,
  onLower,
}: {
  label: string
  url: string
  included: boolean
  priority: number | null
  canRaise: boolean
  canLower: boolean
  onToggle: () => void
  onRaise?: () => void
  onLower?: () => void
}) {
  const { t } = useI18n()
  const [failed, setFailed] = useState(false)
  const includeLabel = included
    ? t('Exclude {name} as a candidate', { name: label })
    : t('Include {name} as a candidate', { name: label })

  return (
    <figure
      className={[
        'is-candidate',
        included ? 'is-included' : 'is-excluded',
      ].join(' ')}
    >
      <div className="website-evidence-image-preview">
        {failed ? (
          <span>
            <ImageOff size={18} aria-hidden="true" />
            {t('Preview unavailable')}
          </span>
        ) : (
          <img
            src={url}
            alt={label}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        )}
        {priority !== null && (
          <b aria-label={t('Priority {number}', { number: priority })}>
            {priority}
          </b>
        )}
      </div>
      <figcaption>{label}</figcaption>
      <div className="website-evidence-candidate-controls">
        {priority !== null && onRaise && onLower && (
          <>
            <button
              type="button"
              className="icon-button"
              aria-label={t('Raise {name} candidate priority', { name: label })}
              data-tooltip={t('Raise candidate priority')}
              title={t('Raise candidate priority')}
              disabled={!canRaise}
              onClick={onRaise}
            >
              <ArrowUp size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={t('Lower {name} candidate priority', { name: label })}
              data-tooltip={t('Lower candidate priority')}
              title={t('Lower candidate priority')}
              disabled={!canLower}
              onClick={onLower}
            >
              <ArrowDown size={13} aria-hidden="true" />
            </button>
          </>
        )}
        <button
          type="button"
          className={`website-evidence-candidate-toggle${included ? ' is-included' : ''}`}
          aria-label={includeLabel}
          aria-pressed={included}
          onClick={onToggle}
        >
          {included
            ? <Check size={12} aria-hidden="true" />
            : <X size={12} aria-hidden="true" />}
          {t(included ? 'Candidate included' : 'Candidate excluded')}
        </button>
      </div>
    </figure>
  )
}

function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === 'AbortError'
}
