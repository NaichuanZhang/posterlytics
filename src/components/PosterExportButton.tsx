import { useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import type { Campaign, Placement } from '../lib/types'
import { Poster } from './Poster'

interface Props {
  campaign: Campaign
  placement: Placement
}

// Exports the poster — with THIS placement's QR embedded — as a high-res PNG.
// Renders an offscreen Poster bound to the placement code, waits for fonts,
// captures via html-to-image, and triggers a download.
export function PosterExportButton({ campaign, placement }: Props) {
  const offscreenRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)

  async function handleExport() {
    if (!offscreenRef.current || busy) return
    setBusy(true)
    try {
      // Ensure brand fonts (and any web fonts) are ready before capture.
      if (document.fonts?.ready) await document.fonts.ready
      // Give the QR image a tick to render.
      await new Promise((r) => setTimeout(r, 120))
      const dataUrl = await toPng(offscreenRef.current, {
        pixelRatio: 3,
        cacheBust: true,
        backgroundColor: campaign.style_profile?.palette.bg ?? '#ffffff',
      })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `${campaign.product_name.replace(/\W+/g, '-')}-${placement.label.replace(/\W+/g, '-')}.png`
      a.click()
    } catch (e) {
      console.error('export failed', e)
      alert('Export failed — the brand image may not allow cross-origin capture. Try regenerating.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="btn secondary sm" onClick={handleExport} disabled={busy}>
        {busy ? 'Exporting…' : `Export PNG`}
      </button>
      {/* Offscreen render target bound to this placement's QR. */}
      <div style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }} aria-hidden>
        <Poster ref={offscreenRef} campaign={campaign} code={placement.code} />
      </div>
    </>
  )
}
