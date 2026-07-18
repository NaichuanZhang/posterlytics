import { useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { Download } from 'lucide-react'
import type { Campaign, Placement } from '../lib/types'
import { POSTER_HEIGHT, POSTER_WIDTH } from '../lib/posterSize'
import { AiPoster } from './posters/AiPoster'
import { useToast } from './ui/Toast'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  campaign: Campaign
  placement: Placement
  label?: string // button text; defaults to 'Export A4 PNG'
  versionNumber?: number
  variant?: 'button' | 'icon'
}

// Exports the poster with this placement's QR embedded as an A4 PNG
// (2480×3508 — the 1240×1754 sheet captured at pixelRatio 2). AiPoster renders
// off-screen at full size and html-to-image captures it (the QR is a
// same-origin data-URL <img>, so no canvas taint).
//
// The AI hero lives on cross-origin Storage, which would taint the export canvas;
// we pre-fetch it to a same-origin data URL first and feed it to AiPoster via
// imageSrcOverride (falling back to the hosted URL if the fetch fails).
export function PosterExportButton({
  campaign,
  placement,
  label,
  versionNumber,
  variant = 'button',
}: Props) {
  const offscreenRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [imgDataUrl, setImgDataUrl] = useState<string | null>(null)
  const { notify } = useToast()
  const { t } = useI18n()
  const buttonLabel = label ?? t('Export A4 PNG')

  async function handleExport() {
    if (busy) return
    setBusy(true)
    try {
      // Pre-fetch the cross-origin hero to a data URL to avoid canvas taint.
      if (campaign.hero_image_url) {
        const data = await fetchAsDataUrl(campaign.hero_image_url)
        setImgDataUrl(data) // null on failure → AiPoster uses the hosted URL (today's behavior)
        // Let React commit the new src, then wait for the image to actually DECODE.
        // A bare rAF/timeout can fire before a multi-MB data URL has painted, which
        // would capture a blank hero. decode() resolves only once it's render-ready.
        await new Promise((r) => requestAnimationFrame(() => r(null)))
        const imgEl = offscreenRef.current?.querySelector('img')
        if (imgEl) {
          try {
            await imgEl.decode()
          } catch {
            if (!imgEl.complete) {
              await new Promise<void>((resolve) => {
                imgEl.addEventListener('load', () => resolve(), { once: true })
                imgEl.addEventListener('error', () => resolve(), { once: true })
              })
            }
          }
        }
      }
      if (!offscreenRef.current) return
      if (document.fonts?.ready) await document.fonts.ready
      // Give the QR image a tick to render.
      await new Promise((r) => setTimeout(r, 150))
      const dataUrl = await toPng(offscreenRef.current, {
        width: POSTER_WIDTH,
        height: POSTER_HEIGHT,
        pixelRatio: 2,
        cacheBust: true,
        skipFonts: true,
      })
      const a = document.createElement('a')
      a.href = dataUrl
      const version = versionNumber ? `-v${versionNumber}` : ''
      a.download = `${campaign.product_name.replace(/\W+/g, '-')}${version}-${placement.label.replace(/\W+/g, '-')}-A4.png`
      a.click()
      notify(t('Poster export is ready.'), 'success')
    } catch (e) {
      console.error('export failed', e)
      notify(t('Poster export failed. Please try again.'), 'error')
    } finally {
      setBusy(false)
      setImgDataUrl(null) // release the (large) data URL
    }
  }

  return (
    <>
      <button
        type="button"
        className={variant === 'icon' ? 'icon-button' : 'button button-secondary button-small'}
        onClick={handleExport}
        disabled={busy}
        aria-label={variant === 'icon' ? buttonLabel : undefined}
        data-tooltip={variant === 'icon' ? buttonLabel : undefined}
      >
        <Download size={15} aria-hidden="true" />
        {variant === 'button' && (busy ? t('Exporting...') : buttonLabel)}
      </button>
      {/* Offscreen full-size render target bound to this placement's QR. */}
      <div style={{ position: 'fixed', left: -20000, top: 0, pointerEvents: 'none' }} aria-hidden>
        <AiPoster
          ref={offscreenRef}
          campaign={campaign}
          code={placement.code}
          imageSrcOverride={imgDataUrl ?? undefined}
        />
      </div>
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
