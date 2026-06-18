import { useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import type { Campaign, Placement, PosterStyle } from '../lib/types'
import { SaasPoster } from './posters/SaasPoster'
import { CozyPoster } from './posters/CozyPoster'
import { AiPoster } from './posters/AiPoster'

interface Props {
  campaign: Campaign
  placement: Placement
  label?: string // button text; defaults to 'Export PNG'
}

// Exports the poster — with THIS placement's QR embedded — as a PNG at the native
// 1080×1620. The template renders deterministically as HTML/CSS off-screen at full
// size; html-to-image captures it (the QR is a same-origin data-URL <img>, so no
// canvas taint). No scaling — pixel-exact output.
//
// For AI-image posters the hero lives on cross-origin Storage, which would taint
// the export canvas; we pre-fetch it to a same-origin data URL first and feed it to
// AiPoster via imageSrcOverride (falling back to the hosted URL if the fetch fails).
export function PosterExportButton({ campaign, placement, label = 'Export PNG' }: Props) {
  const offscreenRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [imgDataUrl, setImgDataUrl] = useState<string | null>(null)

  const style: PosterStyle =
    campaign.poster_style === 'saas_glassmorphism' ? 'saas_glassmorphism' : 'cozy_scrapbook'
  const isImage = campaign.poster_mode === 'image'

  async function handleExport() {
    if (busy) return
    setBusy(true)
    try {
      // AI mode: pre-fetch the cross-origin hero to a data URL to avoid canvas taint.
      if (isImage && campaign.hero_image_url) {
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
        width: 1080,
        height: 1620,
        pixelRatio: 2,
        cacheBust: true,
      })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `${campaign.product_name.replace(/\W+/g, '-')}-${placement.label.replace(/\W+/g, '-')}.png`
      a.click()
    } catch (e) {
      console.error('export failed', e)
      alert('Export failed. Please try again.')
    } finally {
      setBusy(false)
      setImgDataUrl(null) // release the (large) data URL
    }
  }

  return (
    <>
      <button className="btn secondary sm" onClick={handleExport} disabled={busy}>
        {busy ? 'Exporting…' : label}
      </button>
      {/* Offscreen full-size render target bound to this placement's QR. */}
      <div style={{ position: 'fixed', left: -20000, top: 0, pointerEvents: 'none' }} aria-hidden>
        {isImage ? (
          <AiPoster
            ref={offscreenRef}
            campaign={campaign}
            code={placement.code}
            imageSrcOverride={imgDataUrl ?? undefined}
          />
        ) : style === 'saas_glassmorphism' ? (
          <SaasPoster ref={offscreenRef} campaign={campaign} code={placement.code} />
        ) : (
          <CozyPoster ref={offscreenRef} campaign={campaign} code={placement.code} />
        )}
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
