import { useCallback, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { Download } from 'lucide-react'
import type { Campaign, Placement } from '../lib/types'
import {
  DEFAULT_POSTER_SIZE,
  hasPosterQrBand,
  type PosterSize,
} from '../lib/posterSize'
import {
  buildPosterExportFilename,
  type PosterExportPage,
} from '../lib/posterExport'
import {
  clampRedNotePageIndex,
  resolveRedNoteRenderState,
} from '../lib/redNoteRender'
import type { PosterRenderReady } from './posters/AiPoster'
import { PosterSurface } from './posters/PosterSurface'
import { useToast } from './ui/Toast'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  campaign: Campaign
  placement?: Placement | null
  versionNumber?: number
  variant?: 'button' | 'icon'
  posterSize?: PosterSize
  pageIndex?: number
}

interface ExportRenderAttempt {
  readonly id: number
  readonly imageSrcOverride?: string
  readonly pageIndex: number
  readonly page?: PosterExportPage
}

interface PendingRenderReady {
  readonly attemptId: number
  readonly expectedImageSrc: string | null
  readonly resolve: (result: PosterRenderReady) => void
  readonly reject: (error: Error) => void
  readonly timeoutId: number
}

const RENDER_READY_TIMEOUT_ERROR = 'Poster render readiness timed out.'
const RENDER_CANCELLED_ERROR = 'Poster render was cancelled.'
const POSTER_IMAGE_TIMEOUT_ERROR = 'Timed out waiting for a poster image.'

// Exports at the descriptor's native sheet dimensions and pixel ratio. A scaled
// QR band binds the export to a placement; an artwork-only descriptor does not.
// PosterSurface renders off-screen at full size and html-to-image captures it.
//
// The AI hero lives on cross-origin Storage, which would taint the export canvas;
// we pre-fetch it to a same-origin data URL first and feed it to PosterSurface via
// imageSrcOverride (falling back to the hosted URL if the fetch fails).
export function PosterExportButton({
  campaign,
  placement,
  versionNumber,
  variant = 'button',
  posterSize = DEFAULT_POSTER_SIZE,
  pageIndex = 0,
}: Props) {
  const offscreenRef = useRef<HTMLDivElement>(null)
  const renderSequence = useRef(0)
  const pendingRenderReady = useRef<PendingRenderReady | null>(null)
  const [busy, setBusy] = useState(false)
  const [renderAttempt, setRenderAttempt] = useState<ExportRenderAttempt | null>(null)
  const { notify } = useToast()
  const { t } = useI18n()
  const includesQrBand = hasPosterQrBand(posterSize)
  const redNoteRenderState = resolveRedNoteRenderState(campaign)
  const redNoteExportUnavailable = redNoteRenderState === 'invalid'
  const redNotePageCount = typeof redNoteRenderState === 'object'
    ? redNoteRenderState.plan.pages.length
    : null
  const exportPageIndex = redNotePageCount === null
    ? 0
    : clampRedNotePageIndex(pageIndex, redNotePageCount)
  const formatLabel = t(posterSize.label)
  const buttonLabel = redNotePageCount !== null
    ? t('Export page {number} of {count} as {format} PNG', {
        number: exportPageIndex + 1,
        count: redNotePageCount,
        format: formatLabel,
      })
    : variant === 'icon' && includesQrBand && placement
      ? t('Download {name} poster as {format} PNG', {
          name: placement.label,
          format: formatLabel,
        })
      : t('Export {format} PNG', { format: formatLabel })
  const resolveRenderReady = useCallback((
    attemptId: number,
    result: PosterRenderReady,
  ) => {
    const pending = pendingRenderReady.current
    if (
      !pending
      || pending.attemptId !== attemptId
      || pending.expectedImageSrc !== result.imageSrc
    ) {
      return
    }
    window.clearTimeout(pending.timeoutId)
    pendingRenderReady.current = null
    pending.resolve(result)
  }, [])
  const renderAttemptId = renderAttempt?.id ?? null
  const handleRenderReady = useCallback((result: PosterRenderReady) => {
    if (renderAttemptId === null) return
    resolveRenderReady(renderAttemptId, result)
  }, [renderAttemptId, resolveRenderReady])

  async function handleExport() {
    if (
      busy
      || redNoteExportUnavailable
      || (includesQrBand && !placement)
    ) return
    setBusy(true)
    try {
      const page: PosterExportPage | undefined = redNotePageCount === null
        ? undefined
        : {
            pageIndex: exportPageIndex,
            pageCount: redNotePageCount,
          }
      // Pre-fetch the cross-origin hero to a data URL to avoid canvas taint.
      const imageSrcOverride = campaign.hero_image_url
        ? await fetchAsDataUrl(campaign.hero_image_url) ?? undefined
        : undefined
      const attempt: ExportRenderAttempt = {
        id: renderSequence.current + 1,
        imageSrcOverride,
        pageIndex: page?.pageIndex ?? 0,
        page,
      }
      renderSequence.current = attempt.id
      const renderReady = createRenderReadyPromise(
        attempt.id,
        imageSrcOverride ?? campaign.hero_image_url,
      )
      setRenderAttempt(attempt)
      await renderReady

      if (!offscreenRef.current) return
      if (document.fonts?.ready) await document.fonts.ready
      await waitForPosterImages(
        offscreenRef.current,
        includesQrBand && !!placement,
      )
      const dataUrl = await toPng(offscreenRef.current, {
        width: posterSize.sheet.width,
        height: posterSize.sheet.height,
        pixelRatio: posterSize.export.pixelRatio,
        cacheBust: true,
        skipFonts: true,
      })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = buildPosterExportFilename({
        productName: campaign.product_name,
        versionNumber,
        placementLabel: includesQrBand && placement
          ? placement.label
          : undefined,
        filenameSuffix: posterSize.export.filenameSuffix,
        page: attempt.page,
      })
      a.click()
      notify(t('Poster export is ready.'), 'success')
    } catch (e) {
      console.error('export failed', e)
      notify(t('Poster export failed. Please try again.'), 'error')
    } finally {
      cancelPendingRenderReady()
      setBusy(false)
      setRenderAttempt(null) // unmount the full-size clone and release its data URL
    }
  }

  function createRenderReadyPromise(
    attemptId: number,
    expectedImageSrc: string | null,
  ): Promise<PosterRenderReady> {
    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        if (pendingRenderReady.current?.attemptId !== attemptId) return
        pendingRenderReady.current = null
        reject(new Error(RENDER_READY_TIMEOUT_ERROR))
      }, 15_000)
      pendingRenderReady.current = {
        attemptId,
        expectedImageSrc,
        resolve,
        reject,
        timeoutId,
      }
    })
  }

  function cancelPendingRenderReady() {
    const pending = pendingRenderReady.current
    if (!pending) return
    window.clearTimeout(pending.timeoutId)
    pendingRenderReady.current = null
    pending.reject(new Error(RENDER_CANCELLED_ERROR))
  }

  return (
    <>
      <button
        type="button"
        className={variant === 'icon' ? 'icon-button' : 'button button-secondary button-small'}
        onClick={handleExport}
        disabled={
          busy
          || redNoteExportUnavailable
          || (includesQrBand && !placement)
        }
        aria-label={variant === 'icon' ? buttonLabel : undefined}
        data-tooltip={variant === 'icon' ? buttonLabel : undefined}
      >
        <Download size={15} aria-hidden="true" />
        {variant === 'button' && (busy ? t('Exporting...') : buttonLabel)}
      </button>
      {renderAttempt && (
        <div
          data-poster-export-render={renderAttempt.id}
          style={{ position: 'fixed', left: -20000, top: 0, pointerEvents: 'none' }}
          aria-hidden
        >
          <PosterSurface
            key={`${renderAttempt.id}:${renderAttempt.pageIndex}`}
            ref={offscreenRef}
            campaign={campaign}
            code={placement?.code ?? null}
            imageAlt=""
            imageSrcOverride={renderAttempt.imageSrcOverride}
            onRenderReady={handleRenderReady}
            pageIndex={renderAttempt.pageIndex}
            posterSize={posterSize}
          />
        </div>
      )}
    </>
  )
}

// Fetch a (possibly cross-origin) image and convert it to a same-origin data URL.
// Returns null on any failure so the caller can fall back gracefully.
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors', cache: 'no-store' })
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result as string)
      fr.onerror = reject
      fr.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

async function waitForPosterImages(
  poster: HTMLDivElement,
  requiresQr: boolean,
) {
  const hero = poster.querySelector<HTMLImageElement>('[data-poster-hero]')
  if (hero) await decodeImage(hero)

  if (requiresQr) {
    const qr = await waitForImage(
      poster,
      '[data-poster-qr-chip] img',
      5_000,
    )
    await decodeImage(qr)
  }
}

async function waitForImage(
  root: HTMLElement,
  selector: string,
  timeoutMs: number,
): Promise<HTMLImageElement> {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    const image = root.querySelector<HTMLImageElement>(selector)
    if (image) return image
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
  throw new Error(POSTER_IMAGE_TIMEOUT_ERROR)
}

async function decodeImage(image: HTMLImageElement) {
  try {
    await image.decode()
  } catch {
    if (!image.complete) {
      await new Promise<void>((resolve) => {
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener('error', () => resolve(), { once: true })
      })
    }
  }
}
