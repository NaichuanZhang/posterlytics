import {
  forwardRef,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import {
  REDNOTE_CJK_FONT_FAMILY,
  REDNOTE_CJK_FONT_LOAD,
  getRedNotePageFontUsage,
} from '../../lib/redNoteFont'
import {
  getRedNotePageRenderModel,
  resolveRedNotePalette,
} from '../../lib/redNoteRender'
import type { RedNoteRect, RedNotePostPlan } from '../../lib/redNotePost'
import {
  DEFAULT_POSTER_SIZE,
  type PosterSize,
} from '../../lib/posterSize'
import type { Campaign } from '../../lib/types'
import type { PosterRenderReady } from './AiPoster'
import './RedNotePostPage.css'

interface Props {
  campaign: Campaign
  plan: RedNotePostPlan
  pageIndex: number
  imageAlt: string
  imageSrcOverride?: string
  onRenderReady?: (result: PosterRenderReady) => void
  posterSize?: PosterSize
}

const TEXT_FONT =
  `"${REDNOTE_CJK_FONT_FAMILY}", Arial, "Microsoft YaHei", `
  + '"PingFang SC", "Noto Sans CJK SC", sans-serif'

type RedNoteFontStatus = 'loading' | 'loaded' | 'not-required' | 'failed'

interface FontLoadState {
  readonly key: string
  readonly status: Exclude<RedNoteFontStatus, 'not-required'>
}

export const RedNotePostPage = forwardRef<HTMLDivElement, Props>(
  function RedNotePostPage(
    {
      campaign,
      plan,
      pageIndex,
      imageAlt,
      imageSrcOverride,
      onRenderReady,
      posterSize = DEFAULT_POSTER_SIZE,
    },
    ref,
  ) {
    const imageSrc = imageSrcOverride ?? campaign.hero_image_url
    const model = useMemo(
      () => getRedNotePageRenderModel(plan, pageIndex),
      [pageIndex, plan],
    )
    const fontUsage = useMemo(
      () => getRedNotePageFontUsage(plan, pageIndex),
      [pageIndex, plan],
    )
    const fontLoadKey = `${pageIndex}:${fontUsage.cjkText}`
    const [imageLoaded, setImageLoaded] = useState(false)
    const [fontLoad, setFontLoad] = useState<FontLoadState | null>(null)
    const notifiedReady = useRef<string | null>(null)
    const readinessKey = imageSrc
      ? `${pageIndex}:${imageSrc}:${fontLoadKey}`
      : null
    const fontStatus: RedNoteFontStatus = !fontUsage.needsBundledFace
      ? 'not-required'
      : fontLoad?.key === fontLoadKey
        ? fontLoad.status
        : 'loading'
    const fontsLoaded =
      fontStatus === 'loaded' || fontStatus === 'not-required'
    const palette = useMemo(
      () => resolveRedNotePalette(campaign.poster_layout),
      [campaign.poster_layout],
    )

    useLayoutEffect(() => {
      let active = true
      if (!fontUsage.needsBundledFace) {
        setFontLoad(null)
        return
      }
      setFontLoad({ key: fontLoadKey, status: 'loading' })
      if (typeof document === 'undefined' || !document.fonts) {
        setFontLoad({ key: fontLoadKey, status: 'failed' })
        return
      }
      void document.fonts.load(
        REDNOTE_CJK_FONT_LOAD,
        fontUsage.cjkText,
      ).then((faces) => {
        if (!active) return
        const loadedSpecificFace = faces.some((face) =>
          face.family.replace(/["']/g, '') === REDNOTE_CJK_FONT_FAMILY
          && face.status === 'loaded'
        )
        setFontLoad({
          key: fontLoadKey,
          status: loadedSpecificFace ? 'loaded' : 'failed',
        })
      }, () => {
        if (active) setFontLoad({ key: fontLoadKey, status: 'failed' })
      })
      return () => {
        active = false
      }
    }, [
      fontLoadKey,
      fontUsage.cjkText,
      fontUsage.needsBundledFace,
      pageIndex,
    ])

    useLayoutEffect(() => {
      setImageLoaded(false)
      notifiedReady.current = null
    }, [imageSrc])

    useLayoutEffect(() => {
      if (!imageLoaded || !fontsLoaded || !imageSrc || !readinessKey) return
      if (notifiedReady.current === readinessKey) return
      notifiedReady.current = readinessKey
      onRenderReady?.({
        imageSrc,
        footerColor: palette.background,
        footerColorSource: 'not-applicable',
      })
    }, [
      fontsLoaded,
      imageLoaded,
      imageSrc,
      onRenderReady,
      palette.background,
      readinessKey,
    ])

    return (
      <div
        ref={ref}
        role="img"
        aria-label={imageAlt}
        data-poster-size={posterSize.slug}
        data-qr-band={posterSize.qrBand.mode}
        data-poster-render-status={
          imageLoaded && fontsLoaded ? 'not-applicable' : 'pending'
        }
        data-rednote-font-status={fontStatus}
        data-rednote-page-index={pageIndex}
        style={{
          position: 'relative',
          width: posterSize.sheet.width,
          height: posterSize.sheet.height,
          overflow: 'hidden',
          background: palette.background,
          fontFamily: TEXT_FONT,
        }}
      >
        {imageSrc && (
          <img
            src={imageSrc}
            crossOrigin="anonymous"
            data-poster-hero
            alt=""
            aria-hidden="true"
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageLoaded(false)}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        )}
        {model.kind === 'cover' ? (
          <>
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                background: palette.coverScrim,
              }}
            />
            <div
              style={{
                ...rectStyle(model.composition.coverText!),
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                gap: 28,
                padding: '34px 26px 18px',
                color: palette.coverText,
                boxSizing: 'border-box',
                overflowWrap: 'anywhere',
                whiteSpace: 'pre-wrap',
              }}
            >
              <strong
                data-rednote-title
                style={{
                  display: 'block',
                  fontSize: model.titleSize,
                  fontWeight: 800,
                  lineHeight: 1.02,
                  letterSpacing: 0,
                }}
              >
                {model.page.title}
              </strong>
              {model.page.subtitle && (
                <span
                  style={{
                    display: 'block',
                    maxWidth: 920,
                    fontSize: model.subtitleSize,
                    fontWeight: 600,
                    lineHeight: 1.22,
                    letterSpacing: 0,
                  }}
                >
                  {model.page.subtitle}
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                ...rectStyle(model.composition.panel!),
                background: palette.panel,
              }}
            />
            <strong
              data-rednote-heading
              style={{
                ...rectStyle(model.composition.heading!),
                color: palette.text,
                fontSize: model.headingSize,
                fontWeight: 800,
                lineHeight: 1.08,
                letterSpacing: 0,
                overflowWrap: 'anywhere',
                whiteSpace: 'pre-wrap',
              }}
            >
              {model.page.heading}
            </strong>
            <div
              data-rednote-body
              style={{
                ...rectStyle(model.composition.body!),
                display: 'flex',
                flexDirection: 'column',
                gap: 34,
                color: palette.text,
                fontSize: model.bodySize,
                fontWeight: 500,
                lineHeight: 1.42,
                letterSpacing: 0,
                overflowWrap: 'anywhere',
                whiteSpace: 'pre-wrap',
              }}
            >
              {model.page.blocks.map((block, index) => (
                <p key={index} style={{ margin: 0 }}>{block}</p>
              ))}
            </div>
          </>
        )}
        <span
          style={{
            ...rectStyle(model.composition.pageMarker),
            color: model.kind === 'cover' ? palette.coverText : palette.accent,
            fontSize: 24,
            fontWeight: 700,
            lineHeight: '40px',
            letterSpacing: 0,
            textAlign: 'right',
          }}
        >
          {model.pageMarker}
        </span>
      </div>
    )
  },
)

function rectStyle(rect: RedNoteRect): CSSProperties {
  return {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  }
}
