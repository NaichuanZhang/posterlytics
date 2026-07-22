import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { resolveRedNoteRenderState } from '../../lib/redNoteRender'
import { getPosterSize } from '../../lib/posterSize'
import type { Campaign } from '../../lib/types'
import { RedNotePostPage } from './RedNotePostPage'

interface Props {
  campaign: Campaign
  imageAlt: string
  fallbackImageUrl?: string | null
  className?: string
}

interface Size {
  width: number
  height: number
}

export function PosterThumbnail({
  campaign,
  imageAlt,
  fallbackImageUrl,
  className,
}: Props) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const posterSize = useMemo(
    () => getPosterSize(campaign.poster_format),
    [campaign.poster_format],
  )
  const renderState = resolveRedNoteRenderState(campaign)

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    const update = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const imageSrc = campaign.hero_image_url || fallbackImageUrl || ''
  const scale = size.width > 0 && size.height > 0
    ? Math.max(
        size.width / posterSize.sheet.width,
        size.height / posterSize.sheet.height,
      )
    : 0

  return (
    <div
      ref={containerRef}
      className={['poster-thumbnail', className].filter(Boolean).join(' ')}
    >
      {renderState === 'legacy' ? (
        imageSrc ? <img src={imageSrc} alt={imageAlt} /> : null
      ) : renderState === 'invalid' ? (
        <span className="poster-thumbnail-error" role="img" aria-label={imageAlt}>
          {t('This RedNote cover cannot be rendered because its page plan is invalid.')}
        </span>
      ) : scale > 0 ? (
        <div
          className="poster-thumbnail-native"
          style={{
            width: posterSize.sheet.width,
            height: posterSize.sheet.height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <RedNotePostPage
            campaign={campaign}
            plan={renderState.plan}
            pageIndex={0}
            imageAlt={imageAlt}
            posterSize={posterSize}
          />
        </div>
      ) : null}
    </div>
  )
}
