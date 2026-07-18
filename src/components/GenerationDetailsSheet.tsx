import {
  AlertCircle,
  CheckCircle2,
  ImageOff,
  LoaderCircle,
  X,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { fetchGenerationHeroImages } from '../lib/generationTraceApi'
import {
  deriveGenerationProvidedImages,
  deriveGenerationUsedImages,
  type GenerationDetailImage,
} from '../lib/generationTraces'
import type { PosterGeneration, TraceImageAsset } from '../lib/types'

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
  const { locale, t } = useI18n()
  const [heroAttachedImages, setHeroAttachedImages] = useState<TraceImageAsset[] | null>(null)
  const [loading, setLoading] = useState(generation.trace_schema_version !== null)
  const [loadFailed, setLoadFailed] = useState(false)
  const sheetRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const generationRunning = isRunningGeneration(generation)
  const parent = generations.find(
    (candidate) => candidate.id === generation.parent_generation_id,
  ) ?? null
  const providedImages = useMemo(
    () => deriveGenerationProvidedImages(generation, locale),
    [generation, locale],
  )
  const usedImages = useMemo(
    () => deriveGenerationUsedImages({
      generation,
      parent,
      heroAttachedImages,
      locale,
    }),
    [generation, heroAttachedImages, locale, parent],
  )

  useEffect(() => {
    setHeroAttachedImages(null)
    setLoading(generation.trace_schema_version !== null)
    setLoadFailed(false)
  }, [generation.id, generation.trace_schema_version])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    if (generation.trace_schema_version === null) return

    async function refreshImages() {
      try {
        const images = await fetchGenerationHeroImages(generation.id)
        if (!cancelled) {
          setHeroAttachedImages(images)
          setLoadFailed(false)
        }
      } catch {
        if (!cancelled) setLoadFailed(true)
      } finally {
        if (!cancelled) {
          setLoading(false)
          if (generationRunning) {
            timer = window.setTimeout(() => void refreshImages(), 3000)
          }
        }
      }
    }

    void refreshImages()

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [generation.id, generation.trace_schema_version, generationRunning])

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
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

  let usedImagesState: 'loading' | 'pending' | 'unavailable' | 'empty' | 'ready'
  if (usedImages && usedImages.length > 0) {
    usedImagesState = 'ready'
  } else if (loading && generation.trace_schema_version !== null) {
    usedImagesState = 'loading'
  } else if (generationRunning) {
    usedImagesState = 'pending'
  } else if (loadFailed || usedImages === null) {
    usedImagesState = 'unavailable'
  } else {
    usedImagesState = 'empty'
  }

  return (
    <div className="generation-details-layer">
      <button
        type="button"
        className="generation-details-backdrop"
        aria-label={t('Close generation details')}
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
                ? t('Failed attempt')
                : generation.status === 'canceled'
                  ? t('Canceled attempt')
                  : generationRunning
                    ? t('Generation in progress')
                    : t('Version {number}', {
                      number: generation.version_number ?? '-',
                    })}
            </span>
            <h2 id="generation-details-title">{t('Generation details')}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            aria-label={t('Close generation details')}
            onClick={onClose}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="generation-details-scroll">
          <GenerationStatus generation={generation} running={generationRunning} />

          <section
            className="generation-details-prompt"
            aria-labelledby="generation-user-prompt"
          >
            <h3 id="generation-user-prompt">{t('User prompt')}</h3>
            <p>{generation.instruction || t('Initial website-based poster')}</p>
          </section>

          <ImageSummarySection
            id="generation-provided-images"
            title={t('Images provided')}
            images={providedImages}
            empty={t('No images were provided.')}
          />

          <ImageSummarySection
            id="generation-used-images"
            title={t('Images used for the poster')}
            images={usedImages ?? []}
            loading={usedImagesState === 'loading'}
            empty={
              usedImagesState === 'pending'
                ? t('Images used will appear when the poster is generated.')
                : usedImagesState === 'unavailable'
                  ? t('Images used are unavailable for this version.')
                  : t('No images were used for this poster.')
            }
          />
        </div>
      </aside>
    </div>
  )
}

function GenerationStatus({
  generation,
  running,
}: {
  generation: PosterGeneration
  running: boolean
}) {
  const { t } = useI18n()
  if (running) {
    return (
      <div className="generation-details-status is-running" aria-live="polite">
        <LoaderCircle size={17} className="is-spinning" aria-hidden="true" />
        <strong>{t('Generation in progress')}</strong>
      </div>
    )
  }
  if (generation.status === 'failed') {
    return (
      <div className="generation-details-status is-failed" role="status">
        <AlertCircle size={17} aria-hidden="true" />
        <div>
          <strong>{t('Generation failed')}</strong>
          <span>{t('The generation did not complete.')}</span>
        </div>
      </div>
    )
  }
  if (generation.status === 'canceled') {
    return (
      <div className="generation-details-status is-canceled" role="status">
        <XCircle size={17} aria-hidden="true" />
        <div>
          <strong>{t('Canceled attempt')}</strong>
          <span>{t('Canceled before poster generation.')}</span>
        </div>
      </div>
    )
  }
  return (
    <div className="generation-details-status is-ready" role="status">
      <CheckCircle2 size={17} aria-hidden="true" />
      <strong>{t('Poster ready')}</strong>
    </div>
  )
}

function ImageSummarySection({
  id,
  title,
  images,
  empty,
  loading = false,
}: {
  id: string
  title: string
  images: GenerationDetailImage[]
  empty: string
  loading?: boolean
}) {
  const { t } = useI18n()
  return (
    <section className="generation-image-section" aria-labelledby={id}>
      <div className="generation-image-section-heading">
        <h3 id={id}>{title}</h3>
        <span>{images.length}</span>
      </div>
      {loading ? (
        <div className="generation-details-loading" aria-busy="true">
          <LoaderCircle size={18} className="is-spinning" aria-hidden="true" />
          <span>{t('Loading')}</span>
        </div>
      ) : images.length === 0 ? (
        <p className="generation-details-empty">{empty}</p>
      ) : (
        <ul className="generation-image-grid">
          {images.map((image) => (
            <li key={image.id}>
              <figure>
                <GenerationImage image={image} />
                <figcaption>
                  <strong>{image.label}</strong>
                  {image.filename && <span>{image.filename}</span>}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function GenerationImage({ image }: { image: GenerationDetailImage }) {
  const { t } = useI18n()
  const [failed, setFailed] = useState(false)
  if (!image.url || failed) {
    return (
      <span className="generation-image-missing">
        <ImageOff size={19} aria-hidden="true" />
        <span>{t('Preview unavailable')}</span>
      </span>
    )
  }
  return (
    <img
      src={image.url}
      alt={image.label}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

function isRunningGeneration(generation: PosterGeneration): boolean {
  return ['created', 'analyzing', 'reviewing', 'designing', 'painting'].includes(generation.status)
}
