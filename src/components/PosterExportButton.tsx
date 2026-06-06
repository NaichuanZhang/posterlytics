import { useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import type { Campaign, Placement, PosterStyle } from '../lib/types'
import { SaasPoster } from './posters/SaasPoster'
import { CozyPoster } from './posters/CozyPoster'
import { AiPoster } from './posters/AiPoster'

interface Props {
  campaign: Campaign
  placement: Placement
}

// Exports the poster — with THIS placement's QR embedded — as a PNG at the native
// 1080×1620. The template renders deterministically as HTML/CSS off-screen at full
// size; html-to-image captures it (the QR is a same-origin data-URL <img>, so no
// canvas taint). No scaling, no AI image — pixel-exact output.
export function PosterExportButton({ campaign, placement }: Props) {
  const offscreenRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)

  const style: PosterStyle =
    campaign.poster_style === 'saas_glassmorphism' ? 'saas_glassmorphism' : 'cozy_scrapbook'
  const isImage = campaign.poster_mode === 'image'

  async function handleExport() {
    if (!offscreenRef.current || busy) return
    setBusy(true)
    try {
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
    }
  }

  return (
    <>
      <button className="btn secondary sm" onClick={handleExport} disabled={busy}>
        {busy ? 'Exporting…' : `Export PNG`}
      </button>
      {/* Offscreen full-size render target bound to this placement's QR. */}
      <div style={{ position: 'fixed', left: -20000, top: 0, pointerEvents: 'none' }} aria-hidden>
        {isImage ? (
          <AiPoster ref={offscreenRef} campaign={campaign} code={placement.code} />
        ) : style === 'saas_glassmorphism' ? (
          <SaasPoster ref={offscreenRef} campaign={campaign} code={placement.code} />
        ) : (
          <CozyPoster ref={offscreenRef} campaign={campaign} code={placement.code} />
        )}
      </div>
    </>
  )
}
