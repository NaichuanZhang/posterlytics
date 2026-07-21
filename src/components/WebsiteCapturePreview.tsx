import {
  Camera,
  ImageOff,
  LoaderCircle,
  RefreshCw,
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
import { InlineNotice } from './ui/Feedback'

type CaptureStatus = 'idle' | 'capturing' | 'ready' | 'error'

const CAPTURE_COOLDOWN_MS = 5_000

export function WebsiteCapturePreview({
  url,
  disabled = false,
}: {
  url: string
  disabled?: boolean
}) {
  const { t } = useI18n()
  const [status, setStatus] = useState<CaptureStatus>('idle')
  const [preview, setPreview] = useState<CapturePreview | null>(null)
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
    setError(null)
  }, [url])

  useEffect(() => () => {
    requestToken.current += 1
    activeRequest.current?.abort()
    activeRequest.current = null
    if (cooldownTimer.current !== null) {
      clearTimeout(cooldownTimer.current)
      cooldownTimer.current = null
    }
  }, [])

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
    setError(null)

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
      setPreview(response.preview)
      setError(response.error)
      setStatus(response.error ? 'error' : 'ready')
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
      startCooldown()
    } finally {
      if (token === requestToken.current) {
        activeRequest.current = null
      }
    }
  }

  const evidenceImages = preview
    ? [
        ...(preview.styleBoardDataUrl
          ? [{
              key: 'style-board',
              label: t('Website style board'),
              url: preview.styleBoardDataUrl,
              featured: true,
            }]
          : []),
        ...(preview.logoUrl
          ? [{
              key: 'logo',
              label: t('Website logo'),
              url: preview.logoUrl,
              featured: false,
            }]
          : []),
        ...preview.imageUrls.map((imageUrl, index) => ({
          key: `product-${imageUrl}`,
          label: t('Product image {number}', { number: index + 1 }),
          url: imageUrl,
          featured: false,
        })),
      ]
    : []
  const hasEvidence = !!preview && (
    evidenceImages.length > 0
    || preview.colors.length > 0
    || preview.fonts.length > 0
  )

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
          {evidenceImages.length > 0 && (
            <div className="website-evidence-images">
              {evidenceImages.map((image) => (
                <EvidenceImage
                  key={image.key}
                  label={image.label}
                  url={image.url}
                  featured={image.featured}
                />
              ))}
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
      <div>
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

function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === 'AbortError'
}
