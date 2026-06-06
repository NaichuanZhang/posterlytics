import { forwardRef } from 'react'
import type { Campaign, CozyPosterSpec } from '../../lib/types'
import { posterColors } from '../../lib/posterColors'
import { buildViewUrl } from '../../lib/landingUrl'
import { QrCode } from '../QrCode'

interface Props {
  campaign: Campaign
  code: string
}

// Deterministic HTML/CSS render of the cozy "scrapbook / life-RPG" poster
// (1080×1620, 2:3). Warm cream paper, hand-made card feel, BUT rendered as real
// DOM so the QR is a real fixed-size <img> placeholder at a known anchor (no AI
// mismatch, crisp export). Accent color is driven by the analyzed brand palette.
export const CozyPoster = forwardRef<HTMLDivElement, Props>(function CozyPoster({ campaign, code }, ref) {
  const c = posterColors(campaign.style_profile)
  const spec = (campaign.poster_spec ?? {}) as Partial<CozyPosterSpec>
  const product = campaign.product_name || 'Product'

  const stats = (spec.stat_nodes ?? []).slice(0, 5)
  const quests = (spec.quest_cards ?? []).slice(0, 3)
  const leftLines = (spec.conv_left?.lines ?? []).slice(0, 3)
  const rightSteps = (spec.conv_right?.steps ?? []).slice(0, 3)

  const vars = {
    '--plc-accent': c.accent,
    '--plc-accent2': c.accent2,
  } as React.CSSProperties

  return (
    <div ref={ref} className="plc" style={vars}>
      <style>{CSS}</style>

      {/* Status bar */}
      <header className="plc-status">
        <span className="plc-cal">▦ {product}</span>
        <span className="plc-badge">{spec.level_badge || 'Lv.1'} · {spec.xp || '100 XP'}</span>
      </header>

      {/* Hero headline */}
      <section className="plc-hero">
        <h1>{spec.hook_line1 || `Others use ${product}.`}</h1>
        <h1 className="plc-accent-line">{spec.hook_line2 || 'You level up.'}</h1>
        <div className="plc-washi">{spec.subtitle || product}</div>
      </section>

      {/* Mascot + stat ring */}
      <section className="plc-stats">
        <div className="plc-mascot">★</div>
        <div className="plc-stat-grid">
          {(stats.length ? stats : DEFAULT_STATS).map((s, i) => (
            <div className="plc-stat" key={i}>
              <div className="plc-stat-icon" />
              <div className="plc-stat-label">{s.label}</div>
              <div className="plc-stars">{stars(s.stars)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Quest cards */}
      <section className="plc-quests">
        {(quests.length ? quests : DEFAULT_QUESTS).map((q, i) => (
          <div className="plc-quest" key={i}>
            <div className="plc-quest-icon" />
            <b>{q.title}</b>
            <span>{q.desc}</span>
          </div>
        ))}
      </section>

      {/* Conversion row: left note · QR placeholder · right note */}
      <section className="plc-conv">
        <div className="plc-note">
          <b>{spec.conv_left?.heading || `Why ${product}`}</b>
          <ul>{(leftLines.length ? leftLines : ['Save time', 'Do more']).map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>

        <div className="plc-qr-wrap">
          <div className="plc-qr">
            <QrCode value={buildViewUrl(code)} size={150} dark="#3a2f25" light="#ffffff" />
          </div>
          <div className="plc-qr-label">{spec.qr_label || 'Scan to Start'}</div>
        </div>

        <div className="plc-note">
          <b>{spec.conv_right?.heading || 'Start in 3 Steps'}</b>
          <ol>{(rightSteps.length ? rightSteps : ['Scan', 'Sign up', 'Go']).map((s, i) => <li key={i}>{s}</li>)}</ol>
        </div>
      </section>

      {/* Footer */}
      <footer className="plc-footer">
        {spec.footer_formula || `${product} × Speed × Joy`}
        {spec.urls ? <span className="plc-url">{spec.urls}</span> : null}
      </footer>
    </div>
  )
})

function stars(n: number | undefined): string {
  const f = Math.max(0, Math.min(5, Math.round(Number(n) || 0)))
  return '★'.repeat(f) + '☆'.repeat(5 - f)
}

const DEFAULT_STATS = [
  { icon: 'spark', label: 'Easy', stars: 5 },
  { icon: 'bolt', label: 'Fast', stars: 5 },
  { icon: 'heart', label: 'Loved', stars: 4 },
]
const DEFAULT_QUESTS = [
  { icon: 'spark', title: 'Get started', desc: 'in minutes' },
  { icon: 'bolt', title: 'Go live', desc: 'one click' },
  { icon: 'star', title: 'Grow', desc: 'with ease' },
]

// Native 1080×1620. All selectors scoped under .plc. Accent via CSS vars.
const CSS = `
.plc{ position:relative; width:1080px; height:1620px; overflow:hidden; isolation:isolate;
  font-family:'Baloo 2','Quicksand','Comic Sans MS',ui-rounded,'Segoe UI',sans-serif; color:#3a2f25;
  background:
    radial-gradient(circle at 18% 12%, rgba(255,255,255,.5), transparent 30%),
    radial-gradient(circle at 85% 88%, color-mix(in srgb, var(--plc-accent) 12%, transparent), transparent 40%),
    linear-gradient(160deg,#f7efe0,#efe2cc); }
.plc *{ box-sizing:border-box; }
.plc::before{ content:""; position:absolute; inset:0;
  background-image: radial-gradient(rgba(120,98,70,.10) 1.2px, transparent 1.2px);
  background-size:26px 26px; opacity:.5; pointer-events:none; }

.plc-status{ position:absolute; top:40px; left:60px; right:60px; display:flex; justify-content:space-between; align-items:center; z-index:3; }
.plc-cal{ font-weight:800; font-size:20px; color:#6a5740; }
.plc-badge{ background:#fff; border:2px solid #3a2f25; border-radius:999px; padding:8px 18px; font-weight:800; font-size:16px;
  box-shadow:4px 4px 0 rgba(58,47,37,.18); }

.plc-hero{ position:absolute; top:120px; left:0; right:0; text-align:center; z-index:3; }
.plc-hero h1{ margin:0; font-size:88px; line-height:.96; font-weight:800; color:#4a3b2b; }
.plc-hero h1.plc-accent-line{ color:var(--plc-accent); }
.plc-washi{ display:inline-block; margin-top:22px; background:color-mix(in srgb, var(--plc-accent) 22%, #fff);
  transform:rotate(-1.5deg); padding:10px 28px; font-weight:700; font-size:24px; color:#4a3b2b;
  box-shadow:3px 3px 0 rgba(58,47,37,.16); }

.plc-stats{ position:absolute; top:404px; left:60px; right:60px; display:flex; align-items:center; justify-content:center; gap:30px; z-index:3; }
.plc-mascot{ width:160px; height:160px; flex:0 0 160px; border-radius:50%; display:grid; place-items:center; font-size:80px; color:#fff;
  background:radial-gradient(circle at 40% 35%, color-mix(in srgb, var(--plc-accent) 80%, #fff), var(--plc-accent));
  border:4px solid #fff; box-shadow:0 12px 0 rgba(58,47,37,.14), 6px 6px 0 rgba(58,47,37,.10); }
.plc-stat-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px 24px; flex:1; }
.plc-stat{ background:#fff; border:2px solid #3a2f25; border-radius:18px; padding:12px 14px; box-shadow:4px 4px 0 rgba(58,47,37,.14); }
.plc-stat-icon{ width:26px; height:26px; border-radius:8px; background:color-mix(in srgb, var(--plc-accent) 35%, #fff); border:2px solid #3a2f25; margin-bottom:6px; }
.plc-stat-label{ font-weight:800; font-size:16px; }
.plc-stars{ color:var(--plc-accent); font-size:16px; letter-spacing:1px; }

.plc-quests{ position:absolute; top:636px; left:60px; right:60px; display:grid; grid-template-columns:repeat(3,1fr); gap:22px; z-index:3; }
.plc-quest{ background:#fffdf7; border:2px solid #3a2f25; border-radius:20px; padding:20px; box-shadow:5px 5px 0 rgba(58,47,37,.15); transform:rotate(-1deg); }
.plc-quest:nth-child(2){ transform:rotate(1deg); }
.plc-quest:nth-child(3){ transform:rotate(-.5deg); }
.plc-quest-icon{ width:38px; height:38px; border-radius:10px; background:color-mix(in srgb, var(--plc-accent) 30%, #fff); border:2px solid #3a2f25; margin-bottom:12px; }
.plc-quest b{ display:block; font-size:22px; color:#4a3b2b; }
.plc-quest span{ display:block; margin-top:4px; font-size:16px; color:#6a5740; }

.plc-conv{ position:absolute; top:900px; left:60px; right:60px; height:520px; display:grid; grid-template-columns:1fr 320px 1fr; gap:24px; align-items:center; z-index:3; }
.plc-note{ background:#fffdf7; border:2px dashed #b9a584; border-radius:18px; padding:24px; align-self:stretch; }
.plc-note b{ display:block; font-size:22px; color:#4a3b2b; margin-bottom:14px; }
.plc-note ul, .plc-note ol{ margin:0; padding-left:22px; }
.plc-note li{ font-size:18px; line-height:1.9; color:#5b4a37; }

.plc-qr-wrap{ display:flex; flex-direction:column; align-items:center; gap:14px; }
.plc-qr{ background:#fff; padding:14px; border:3px solid #3a2f25; border-radius:18px; box-shadow:6px 6px 0 rgba(58,47,37,.18); }
.plc-qr img{ display:block; width:150px; height:150px; border-radius:0 !important; }
.plc-qr-label{ font-weight:800; font-size:20px; color:#4a3b2b; background:color-mix(in srgb, var(--plc-accent) 22%, #fff);
  padding:6px 18px; border-radius:999px; transform:rotate(-1deg); }

.plc-footer{ position:absolute; left:0; right:0; bottom:54px; text-align:center; font-weight:800; font-size:26px; color:#4a3b2b; z-index:3; }
.plc-url{ display:block; margin-top:14px; font-size:16px; font-weight:700; color:#fff; background:var(--plc-accent);
  width:max-content; margin-left:auto; margin-right:auto; padding:6px 20px; border-radius:999px; }
`
