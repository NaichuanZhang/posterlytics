import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minus,
  Plus,
} from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  CANVAS_ZOOM_LEVELS,
  calculateFitScale,
  calculateFitZoom,
  stepCanvasZoom,
  type CanvasZoom,
} from '../lib/workspace'
import {
  DEFAULT_POSTER_SIZE,
  hasPosterQrBand,
  type PosterSize,
} from '../lib/posterSize'
import {
  clampRedNotePageIndex,
  resolveRedNoteRenderState,
} from '../lib/redNoteRender'
import type { Campaign } from '../lib/types'
import { LayoutPreview } from './LayoutPreview'
import { Poster } from './Poster'
import { useI18n } from '../i18n/I18nProvider'

interface PosterCanvasProps {
  campaign: Campaign
  code: string | null
  imageAlt: string
  zoom: CanvasZoom
  versionLabel: string
  onZoomChange: (zoom: CanvasZoom) => void
  posterSize?: PosterSize
  pageIndex?: number
  pageCount?: number
  onPageIndexChange?: (pageIndex: number) => void
}

interface ElementSize {
  width: number
  height: number
}

export function PosterCanvas({
  campaign,
  code,
  imageAlt,
  zoom,
  versionLabel,
  onZoomChange,
  posterSize = DEFAULT_POSTER_SIZE,
  pageIndex = 0,
  pageCount,
  onPageIndexChange,
}: PosterCanvasProps) {
  const { t } = useI18n()
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<ElementSize>({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = viewportRef.current
    if (!element) return

    const update = () => {
      setViewport({ width: element.clientWidth, height: element.clientHeight })
    }
    update()

    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const scale = useMemo(() => {
    if (zoom !== 'fit') return zoom / 100
    return calculateFitScale(
      viewport.width,
      viewport.height,
      posterSize.sheet.width,
      posterSize.sheet.height,
      48,
    )
  }, [posterSize, viewport, zoom])

  const fitZoom = calculateFitZoom(
    viewport.width,
    viewport.height,
    posterSize.sheet.width,
    posterSize.sheet.height,
    48,
  )
  const previewWidth = scale > 0 ? Math.max(120, Math.round(posterSize.sheet.width * scale)) : 0
  const previewHeight = scale > 0 ? Math.round(posterSize.sheet.height * scale) : 0
  const stageWidth = Math.max(viewport.width, previewWidth + 96)
  const stageHeight = Math.max(viewport.height, previewHeight + 96)
  const requiresPlacement = hasPosterQrBand(posterSize)
  const redNoteRenderState = useMemo(
    () => resolveRedNoteRenderState(campaign),
    [campaign],
  )
  const compositePageCount = typeof redNoteRenderState === 'object'
    ? redNoteRenderState.plan.pages.length
    : null
  const renderedPageIndex = compositePageCount === null
    ? 0
    : clampRedNotePageIndex(pageIndex, compositePageCount)
  const showPageControls = (
    compositePageCount !== null
    && pageCount === compositePageCount
    && !!onPageIndexChange
    && !!campaign.hero_image_url
  )

  return (
    <div className="canvas-shell">
      <div className="canvas-meta">
        <span>{versionLabel}</span>
        <span>
          {zoom === 'fit' ? t('{percent}% fitted', { percent: fitZoom }) : `${zoom}%`}
        </span>
      </div>
      <div ref={viewportRef} className="canvas-viewport">
        <div
          className="canvas-stage"
          style={{ width: stageWidth || '100%', height: stageHeight || '100%' }}
        >
          {previewWidth > 0 && (
            campaign.hero_image_url || !campaign.poster_layout ? (
              code || !requiresPlacement ? (
                <Poster
                  campaign={campaign}
                  code={code}
                  imageAlt={imageAlt}
                  width={previewWidth}
                  posterSize={posterSize}
                  pageIndex={renderedPageIndex}
                />
              ) : (
                <div className="canvas-message">{t('Preparing the tracked placement')}</div>
              )
            ) : (
              <LayoutPreview
                layout={campaign.poster_layout}
                ariaHidden
                width={previewWidth}
                posterSize={posterSize}
              />
            )
          )}
        </div>
      </div>
      {showPageControls && compositePageCount !== null && onPageIndexChange ? (
        <div className="canvas-control-row">
          <RedNotePageControls
            pageIndex={renderedPageIndex}
            pageCount={compositePageCount}
            onPageIndexChange={onPageIndexChange}
          />
          <CanvasZoomControls
            zoom={zoom}
            fitZoom={fitZoom}
            onZoomChange={onZoomChange}
          />
        </div>
      ) : (
        <CanvasZoomControls
          zoom={zoom}
          fitZoom={fitZoom}
          onZoomChange={onZoomChange}
        />
      )}
    </div>
  )
}

function RedNotePageControls({
  pageIndex,
  pageCount,
  onPageIndexChange,
}: {
  pageIndex: number
  pageCount: number
  onPageIndexChange: (pageIndex: number) => void
}) {
  const { t } = useI18n()
  return (
    <div
      className="rednote-page-controls"
      role="group"
      aria-label={t('Page navigation')}
    >
      <button
        type="button"
        className="zoom-icon"
        aria-label={t('Previous page')}
        data-tooltip={t('Previous page')}
        disabled={pageIndex === 0}
        onClick={() => onPageIndexChange(pageIndex - 1)}
      >
        <ChevronLeft size={15} aria-hidden="true" />
      </button>
      <span className="rednote-page-position" aria-live="polite">
        {t('Page {number} of {count}', {
          number: pageIndex + 1,
          count: pageCount,
        })}
      </span>
      <button
        type="button"
        className="zoom-icon"
        aria-label={t('Next page')}
        data-tooltip={t('Next page')}
        disabled={pageIndex === pageCount - 1}
        onClick={() => onPageIndexChange(pageIndex + 1)}
      >
        <ChevronRight size={15} aria-hidden="true" />
      </button>
    </div>
  )
}

function CanvasZoomControls({
  zoom,
  fitZoom,
  onZoomChange,
}: {
  zoom: CanvasZoom
  fitZoom: number
  onZoomChange: (zoom: CanvasZoom) => void
}) {
  const { t } = useI18n()
  // Disable each direction only when the step would not change the effective
  // scale, so `fit` (a computed percentage) is not assumed to be the extreme.
  const zoomOutDisabled = stepCanvasZoom(zoom, -1, fitZoom) === zoom
  const zoomInDisabled = stepCanvasZoom(zoom, 1, fitZoom) === zoom
  return (
    <div className="zoom-controls" aria-label={t('Canvas zoom controls')}>
      <button
        type="button"
        className="zoom-icon"
        aria-label={t('Zoom out')}
        data-tooltip={t('Zoom out')}
        disabled={zoomOutDisabled}
        onClick={() => onZoomChange(stepCanvasZoom(zoom, -1, fitZoom))}
      >
        <Minus size={14} aria-hidden="true" />
      </button>
      <label className="zoom-select">
        <Maximize2 size={13} aria-hidden="true" />
        <span className="sr-only">{t('Canvas zoom')}</span>
        <select
          value={zoom}
          onChange={(event) => {
            const value = event.target.value
            onZoomChange(value === 'fit' ? 'fit' : Number(value) as CanvasZoom)
          }}
        >
          <option value="fit">
            {fitZoom > 0 ? t('Fit ({percent}%)', { percent: fitZoom }) : t('Fit')}
          </option>
          {CANVAS_ZOOM_LEVELS.map((level) => (
            <option key={level} value={level}>{level}%</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="zoom-icon"
        aria-label={t('Zoom in')}
        data-tooltip={t('Zoom in')}
        disabled={zoomInDisabled}
        onClick={() => onZoomChange(stepCanvasZoom(zoom, 1, fitZoom))}
      >
        <Plus size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
