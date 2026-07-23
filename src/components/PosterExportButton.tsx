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
  buildPosterExportArchiveFilename,
  buildPosterExportFilename,
  buildPosterExportRunSnapshot,
  type PosterExportPage,
  type PosterExportRunSnapshot,
} from '../lib/posterExport'
import {
  buildStoredZip,
  pngDataUrlToBytes,
  type StoredZipEntry,
} from '../lib/posterZip'
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
  showAllPagesExport?: boolean
}

interface ExportRenderAttempt {
  readonly id: number
  readonly run: PosterExportRunSnapshot
  readonly imageSrcOverride: string | undefined
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

type ExportActivity =
  | { readonly kind: 'idle' }
  | { readonly kind: 'current-page' }
  | {
      readonly kind: 'all-pages'
      readonly number: number
      readonly count: number
    }

const RENDER_READY_TIMEOUT_ERROR = 'Poster render readiness timed out.'
const RENDER_CANCELLED_ERROR = 'Poster render was cancelled.'
const POSTER_IMAGE_TIMEOUT_ERROR = 'Timed out waiting for a poster image.'
const POSTER_RENDER_MISSING_ERROR = 'Poster export render was not mounted.'
const POSTER_HERO_FETCH_ERROR = 'Poster hero could not be prepared for ZIP export.'

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
  showAllPagesExport = false,
}: Props) {
  const offscreenRef = useRef<HTMLDivElement>(null)
  const renderSequence = useRef(0)
  const pendingRenderReady = useRef<PendingRenderReady | null>(null)
  const [activity, setActivity] = useState<ExportActivity>({ kind: 'idle' })
  const [renderAttempt, setRenderAttempt] = useState<ExportRenderAttempt | null>(null)
  const { notify } = useToast()
  const { t } = useI18n()
  const includesQrBand = hasPosterQrBand(posterSize)
  const redNoteRenderState = resolveRedNoteRenderState(campaign)
  const redNoteExportUnavailable = redNoteRenderState === 'invalid'
  const redNotePageCount = typeof redNoteRenderState === 'object'
    ? redNoteRenderState.plan.pages.length
    : null
  const busy = activity.kind !== 'idle'
  const showAllPagesButton = (
    showAllPagesExport
    && variant === 'button'
    && redNotePageCount !== null
  )
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
  const allPagesButtonLabel = redNotePageCount === null
    ? ''
    : t('Export all {count} pages as {format} ZIP', {
        count: redNotePageCount,
        format: formatLabel,
      })
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

  async function capturePageToPng(
    run: PosterExportRunSnapshot,
    page: PosterExportPage | undefined,
    imageSrcOverride: string | undefined,
  ): Promise<string | null> {
    const attempt: ExportRenderAttempt = {
      id: renderSequence.current + 1,
      run,
      imageSrcOverride,
      pageIndex: page?.pageIndex ?? 0,
      page,
    }
    renderSequence.current = attempt.id
    const renderReady = createRenderReadyPromise(
      attempt.id,
      attempt.imageSrcOverride ?? attempt.run.heroImageUrl,
    )
    setRenderAttempt(attempt)
    await renderReady

    if (!offscreenRef.current) return null
    if (document.fonts?.ready) await document.fonts.ready
    await waitForPosterImages(
      offscreenRef.current,
      attempt.run.requiresQrImage,
    )
    return toPng(offscreenRef.current, {
      width: attempt.run.capture.width,
      height: attempt.run.capture.height,
      pixelRatio: attempt.run.capture.pixelRatio,
      cacheBust: true,
    })
  }

  async function handleExport() {
    if (
      busy
      || redNoteExportUnavailable
      || (includesQrBand && !placement)
    ) return
    const run = buildPosterExportRunSnapshot({
      campaign,
      placement,
      versionNumber,
      posterSize,
      pageIndex: exportPageIndex,
      pageCount: redNotePageCount,
    })
    setActivity({ kind: 'current-page' })
    try {
      const page = run.pages.selected
      // Pre-fetch the cross-origin hero to a data URL to avoid canvas taint.
      const imageSrcOverride = run.heroImageUrl
        ? await fetchAsDataUrl(run.heroImageUrl) ?? undefined
        : undefined
      const dataUrl = await capturePageToPng(run, page, imageSrcOverride)
      if (!dataUrl) return
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = buildPosterExportFilename({
        productName: run.naming.productName,
        versionNumber: run.naming.versionNumber,
        placementLabel: run.naming.placementLabel,
        filenameSuffix: run.naming.filenameSuffix,
        page,
      })
      a.click()
      notify(t('Poster export is ready.'), 'success')
    } catch (e) {
      console.error('export failed', e)
      notify(t('Poster export failed. Please try again.'), 'error')
    } finally {
      cancelPendingRenderReady()
      setActivity({ kind: 'idle' })
      setRenderAttempt(null) // unmount the full-size clone and release its data URL
    }
  }

  async function handleAllPagesExport() {
    if (busy || !showAllPagesButton || redNotePageCount === null) return
    const run = buildPosterExportRunSnapshot({
      campaign,
      placement,
      versionNumber,
      posterSize,
      pageIndex: exportPageIndex,
      pageCount: redNotePageCount,
    })
    const pageCount = run.pages.count
    if (pageCount === null) return
    setActivity({
      kind: 'all-pages',
      number: 1,
      count: pageCount,
    })
    let entries: StoredZipEntry[] = []
    try {
      if (!run.heroImageUrl) throw new Error(POSTER_HERO_FETCH_ERROR)
      const imageSrcOverride = await fetchAsDataUrl(run.heroImageUrl)
      if (!imageSrcOverride) throw new Error(POSTER_HERO_FETCH_ERROR)

      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        setActivity({
          kind: 'all-pages',
          number: pageIndex + 1,
          count: pageCount,
        })
        const page: PosterExportPage = {
          pageIndex,
          pageCount,
        }
        const dataUrl = await capturePageToPng(run, page, imageSrcOverride)
        if (!dataUrl) throw new Error(POSTER_RENDER_MISSING_ERROR)
        entries = [
          ...entries,
          {
            filename: buildPosterExportFilename({
              productName: run.naming.productName,
              versionNumber: run.naming.versionNumber,
              placementLabel: run.naming.placementLabel,
              filenameSuffix: run.naming.filenameSuffix,
              page,
            }),
            bytes: pngDataUrlToBytes(dataUrl),
          },
        ]
      }

      const archive = buildStoredZip(entries)
      entries = []
      downloadZip(
        archive,
        buildPosterExportArchiveFilename({
          productName: run.naming.productName,
          versionNumber: run.naming.versionNumber,
          filenameSuffix: run.naming.filenameSuffix,
        }),
      )
      notify(t('All pages are ready in one ZIP.'), 'success')
    } catch (e) {
      console.error('all-page export failed', e)
      notify(t('All-page export failed. Please try again.'), 'error')
    } finally {
      entries = []
      cancelPendingRenderReady()
      setActivity({ kind: 'idle' })
      setRenderAttempt(null)
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
        {variant === 'button' && (
          activity.kind === 'current-page' ? t('Exporting...') : buttonLabel
        )}
      </button>
      {showAllPagesButton && (
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={handleAllPagesExport}
          disabled={busy}
        >
          <Download size={15} aria-hidden="true" />
          <span aria-live="polite">
            {activity.kind === 'all-pages'
              ? t('Exporting page {number} of {count}...', {
                  number: activity.number,
                  count: activity.count,
                })
              : allPagesButtonLabel}
          </span>
        </button>
      )}
      {renderAttempt && (
        <div
          data-poster-export-render={renderAttempt.id}
          style={{ position: 'fixed', left: -20000, top: 0, pointerEvents: 'none' }}
          aria-hidden
        >
          <PosterSurface
            key={`${renderAttempt.id}:${renderAttempt.pageIndex}`}
            ref={offscreenRef}
            campaign={renderAttempt.run.campaign}
            code={renderAttempt.run.placementCode}
            imageAlt=""
            imageSrcOverride={renderAttempt.imageSrcOverride}
            onRenderReady={handleRenderReady}
            pageIndex={renderAttempt.pageIndex}
            posterSize={renderAttempt.run.posterSize}
          />
        </div>
      )}
    </>
  )
}

function downloadZip(bytes: Uint8Array, filename: string) {
  const blobBytes = new Uint8Array(bytes)
  const objectUrl = URL.createObjectURL(new Blob(
    [blobBytes],
    { type: 'application/zip' },
  ))
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.style.display = 'none'
  try {
    document.body.append(anchor)
    anchor.click()
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  } finally {
    anchor.remove()
  }
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
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
