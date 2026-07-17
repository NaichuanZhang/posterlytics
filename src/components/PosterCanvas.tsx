import { Maximize2, Minus, Plus } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  CANVAS_ZOOM_LEVELS,
  calculateFitScale,
  calculateFitZoom,
  stepCanvasZoom,
  type CanvasZoom,
} from '../lib/workspace'
import { POSTER_HEIGHT, POSTER_WIDTH } from '../lib/posterSize'
import type { Campaign } from '../lib/types'
import { LayoutPreview } from './LayoutPreview'
import { Poster } from './Poster'

interface PosterCanvasProps {
  campaign: Campaign
  code: string | null
  zoom: CanvasZoom
  versionLabel: string
  onZoomChange: (zoom: CanvasZoom) => void
}

interface ElementSize {
  width: number
  height: number
}

export function PosterCanvas({
  campaign,
  code,
  zoom,
  versionLabel,
  onZoomChange,
}: PosterCanvasProps) {
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
      POSTER_WIDTH,
      POSTER_HEIGHT,
      48,
    )
  }, [viewport, zoom])

  const fitZoom = calculateFitZoom(
    viewport.width,
    viewport.height,
    POSTER_WIDTH,
    POSTER_HEIGHT,
    48,
  )
  const previewWidth = scale > 0 ? Math.max(120, Math.round(POSTER_WIDTH * scale)) : 0
  const previewHeight = scale > 0 ? Math.round(POSTER_HEIGHT * scale) : 0
  const stageWidth = Math.max(viewport.width, previewWidth + 96)
  const stageHeight = Math.max(viewport.height, previewHeight + 96)

  return (
    <div className="canvas-shell">
      <div className="canvas-meta">
        <span>{versionLabel}</span>
        <span>{zoom === 'fit' ? `${fitZoom}% fitted` : `${zoom}%`}</span>
      </div>
      <div ref={viewportRef} className="canvas-viewport">
        <div
          className="canvas-stage"
          style={{ width: stageWidth || '100%', height: stageHeight || '100%' }}
        >
          {previewWidth > 0 && (
            campaign.hero_image_url || !campaign.poster_layout ? (
              code ? (
                <Poster campaign={campaign} code={code} width={previewWidth} />
              ) : (
                <div className="canvas-message">Preparing the tracked placement</div>
              )
            ) : (
              <LayoutPreview layout={campaign.poster_layout} width={previewWidth} />
            )
          )}
        </div>
      </div>
      <CanvasZoomControls
        zoom={zoom}
        fitZoom={fitZoom}
        onZoomChange={onZoomChange}
      />
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
  return (
    <div className="zoom-controls" aria-label="Canvas zoom controls">
      <button
        type="button"
        className="zoom-icon"
        aria-label="Zoom out"
        data-tooltip="Zoom out"
        disabled={zoom === 'fit'}
        onClick={() => onZoomChange(stepCanvasZoom(zoom, -1))}
      >
        <Minus size={14} aria-hidden="true" />
      </button>
      <label className="zoom-select">
        <Maximize2 size={13} aria-hidden="true" />
        <span className="sr-only">Canvas zoom</span>
        <select
          value={zoom}
          onChange={(event) => {
            const value = event.target.value
            onZoomChange(value === 'fit' ? 'fit' : Number(value) as CanvasZoom)
          }}
        >
          <option value="fit">Fit{fitZoom > 0 ? ` (${fitZoom}%)` : ''}</option>
          {CANVAS_ZOOM_LEVELS.map((level) => (
            <option key={level} value={level}>{level}%</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="zoom-icon"
        aria-label="Zoom in"
        data-tooltip="Zoom in"
        disabled={zoom === 100}
        onClick={() => onZoomChange(stepCanvasZoom(zoom, 1))}
      >
        <Plus size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
