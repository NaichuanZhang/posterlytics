import { forwardRef } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import {
  resolveRedNoteRenderState,
} from '../../lib/redNoteRender'
import {
  DEFAULT_POSTER_SIZE,
  type PosterSize,
} from '../../lib/posterSize'
import type { Campaign } from '../../lib/types'
import {
  AiPoster,
  type PosterRenderReady,
} from './AiPoster'
import { RedNotePostPage } from './RedNotePostPage'

interface Props {
  campaign: Campaign
  code: string | null
  imageAlt: string
  imageSrcOverride?: string
  compositedFooterAriaHidden?: boolean
  onRenderReady?: (result: PosterRenderReady) => void
  posterSize?: PosterSize
  pageIndex?: number
}

export const PosterSurface = forwardRef<HTMLDivElement, Props>(
  function PosterSurface(
    {
      campaign,
      code,
      imageAlt,
      imageSrcOverride,
      compositedFooterAriaHidden,
      onRenderReady,
      posterSize = DEFAULT_POSTER_SIZE,
      pageIndex = 0,
    },
    ref,
  ) {
    const { t } = useI18n()
    const renderState = resolveRedNoteRenderState(campaign)

    if (renderState === 'legacy') {
      return (
        <AiPoster
          ref={ref}
          campaign={campaign}
          code={code}
          imageAlt={imageAlt}
          imageSrcOverride={imageSrcOverride}
          compositedFooterAriaHidden={compositedFooterAriaHidden}
          onRenderReady={onRenderReady}
          posterSize={posterSize}
        />
      )
    }

    if (renderState === 'invalid') {
      return (
        <div
          ref={ref}
          role="img"
          aria-label={imageAlt}
          data-poster-size={posterSize.slug}
          data-qr-band={posterSize.qrBand.mode}
          data-poster-render-status="invalid"
          style={{
            width: posterSize.sheet.width,
            height: posterSize.sheet.height,
            display: 'grid',
            placeItems: 'center',
            padding: 96,
            boxSizing: 'border-box',
            background: '#f4f5f1',
            color: '#4f515a',
            fontSize: 34,
            fontWeight: 600,
            lineHeight: 1.35,
            textAlign: 'center',
          }}
        >
          {t('This RedNote cover cannot be rendered because its page plan is invalid.')}
        </div>
      )
    }

    return (
      <RedNotePostPage
        ref={ref}
        campaign={campaign}
        plan={renderState.plan}
        pageIndex={pageIndex}
        imageAlt={imageAlt}
        imageSrcOverride={imageSrcOverride}
        onRenderReady={onRenderReady}
        posterSize={posterSize}
      />
    )
  },
)
