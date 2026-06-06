import { forwardRef } from 'react'
import type { Campaign, SaasPosterSpec } from '../../lib/types'
import { posterColors } from '../../lib/posterColors'
import { buildViewUrl } from '../../lib/landingUrl'
import { QrCode } from '../QrCode'

interface Props {
  campaign: Campaign
  code: string
}

// Deterministic HTML/CSS render of the premium SaaS / glassmorphism product-launch
// poster (1080×1620, 2:3). Because the whole poster is real DOM, the QR is a real
// fixed-size <img> at a known anchor (no AI placeholder to mismatch), text never
// garbles, and PNG export stays crisp. Accent colors come from the analyzed brand
// palette via posterColors(). Content comes from the analyzer's poster_spec.
export const SaasPoster = forwardRef<HTMLDivElement, Props>(function SaasPoster({ campaign, code }, ref) {
  const c = posterColors(campaign.style_profile)
  const spec = (campaign.poster_spec ?? {}) as Partial<SaasPosterSpec>
  const product = campaign.product_name || 'Product'

  // Split headline so the second half gets the accent "hammer".
  const headline = spec.headline || product
  const words = headline.trim().split(/\s+/)
  const head1 = words.length > 1 ? words.slice(0, Math.ceil(words.length / 2)).join(' ') : headline
  const head2 = words.length > 1 ? words.slice(Math.ceil(words.length / 2)).join(' ') : ''

  const features = (spec.feature_matrix ?? []).slice(0, 6)
  const floats = (spec.float_cards ?? []).slice(0, 4)
  const reasons = (spec.reasons ?? []).slice(0, 4)
  const logoAbbr = product.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'IF'

  // Metric bars (demo card) — fixed, credible-looking, accent-colored.
  const metrics = [
    { label: 'Agent Readiness', pct: 96 },
    { label: 'Backend Coverage', pct: 94 },
    { label: 'Deploy Flow', pct: 91 },
  ]

  const vars = {
    '--plp-accent': c.accent,
    '--plp-accent2': c.accent2,
    '--plp-ink': c.ink,
    '--plp-paper': c.paper,
    '--plp-paper2': c.paper2,
    '--plp-text': c.textLight,
    '--plp-text-dark': c.textDark,
  } as React.CSSProperties

  return (
    <div ref={ref} className="plp-saas" style={vars}>
      <style>{CSS}</style>

      {/* Brand row */}
      <header className="plp-brand">
        <div className="plp-lockup">
          <div className="plp-mark">{logoAbbr}</div>
          <div>
            <div className="plp-bname">{product}</div>
            <div className="plp-bsub">{spec.sub_name || 'Agent-native cloud'}</div>
          </div>
        </div>
        <div className="plp-laurel">{spec.slogan ? 'Built for builders' : 'Product launch'}</div>
      </header>

      {/* Hero copy */}
      <section className="plp-hero">
        <h1>
          {head1}
          {head2 && <><br /><span>{head2}</span></>}
        </h1>
        <div className="plp-divider" />
        <p className="plp-tagline">{spec.slogan || campaign.tagline || product}</p>
        <p className="plp-intro">{spec.product_intro || campaign.landing_content?.what_it_does || ''}</p>
      </section>

      {/* 3D device */}
      <section className="plp-device">
        <div className="plp-halo" />
        <div className="plp-pedestal" />
        <div className="plp-browser">
          <div className="plp-browser-top">
            <span className="plp-bdot" /><span className="plp-bdot" /><span className="plp-bdot" />
            <div className="plp-url">{product.toLowerCase().replace(/\s+/g, '')}.app</div>
          </div>
          <div className="plp-screen">
            <div className="plp-screen-title">
              <strong>{spec.device_context ? truncate(spec.device_context, 26) : `${product} console`}</strong>
              <span>LIVE</span>
            </div>
            <div className="plp-screen-grid">
              <div className="plp-scard">
                <label>Primary</label>
                <b>{spec.hero_metric || '+20%'}</b>
                <div className="plp-statusline"><span className="plp-dot" /> healthy</div>
              </div>
              <div className="plp-scard">
                <label>Services</label>
                <b>{features.length || 6} modules</b>
                <div className="plp-statusline"><span className="plp-dot" /> online</div>
              </div>
              <div className="plp-terminal">
                <div><em>$</em> {product.toLowerCase().replace(/\s+/g, '')} deploy</div>
                <div><em>OK</em> {features.slice(0, 3).map((f) => f.title?.toLowerCase()).filter(Boolean).join(', ') || 'auth, db, storage'}</div>
                <div><em>OK</em> live preview ready</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Floating glass cards */}
      {floats[0] && <FloatCard className="plp-fc1" card={floats[0]} />}
      {floats[1] && <FloatCard className="plp-fc2 dark" card={floats[1]} />}
      {floats[2] && <FloatCard className="plp-fc3" card={floats[2]} />}
      {floats[3] && <FloatCard className="plp-fc4 dark" card={floats[3]} />}

      {/* Feature matrix */}
      <section className="plp-matrix">
        <div className="plp-matrix-title">{features.length || 6} Core Modules</div>
        <div className="plp-features">
          {(features.length ? features : DEFAULT_FEATURES).map((f, i) => (
            <div className="plp-feature" key={i}>
              <div className="plp-licon" />
              <div>
                <b>{f.title}</b>
                <span>{f.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Lower dark zone */}
      <section className="plp-lower">
        <div className="plp-reasons">
          <h2>Why {product}?</h2>
          <div className="plp-reason-grid">
            {(reasons.length ? reasons : DEFAULT_REASONS).map((r, i) => (
              <div className="plp-reason" key={i}>
                <div className="plp-licon" />
                <b>{r.title}</b>
                <p>{r.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA copy */}
      <section className="plp-cta">
        <h2>{spec.cta_main || `Build with ${product}.`}</h2>
        <p>{spec.cta_sub || 'Scan to get started in seconds.'}</p>
      </section>

      {/* Real QR at the fixed anchor */}
      <div className="plp-qr">
        <QrCode value={buildViewUrl(code)} size={144} dark="#0b0c0b" light="#ffffff" />
      </div>
      <div className="plp-qr-guide">{spec.qr_label || 'Scan to Start'}</div>

      {/* Demo / metric card */}
      <aside className="plp-demo">
        <div className="plp-demo-head">
          <b>Live Run</b>
          <div className="plp-score">{spec.hero_metric ? truncate(spec.hero_metric, 5) : 'OK'}</div>
        </div>
        <div className="plp-mini-console">
          <div><span>$</span> {product.toLowerCase().replace(/\s+/g, '')} deploy</div>
          <div><span>OK</span> services online</div>
          <div><span>URL</span> live preview ready</div>
        </div>
        {metrics.map((m) => (
          <div className="plp-metric" key={m.label}>
            <div className="plp-metric-row"><span>{m.label}</span><span>{m.pct}%</span></div>
            <div className="plp-bar"><span style={{ width: `${m.pct}%` }} /></div>
          </div>
        ))}
      </aside>

      {/* Footer */}
      <footer className="plp-footer">
        <span>{(spec.footer_slogan || `${product} — built for builders.`).toUpperCase()}</span>
      </footer>
    </div>
  )
})

function FloatCard({ className, card }: { className: string; card: { title: string; desc: string } }) {
  return (
    <aside className={`plp-float ${className}`}>
      <div className="plp-tiny-icon" />
      <h3>{card.title}</h3>
      <p>{card.desc}</p>
    </aside>
  )
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

const DEFAULT_FEATURES = [
  { title: 'Auth', desc: 'Signups, sessions, OAuth.' },
  { title: 'Database', desc: 'Managed Postgres.' },
  { title: 'Storage', desc: 'Files, media, URLs.' },
  { title: 'Functions', desc: 'Backend logic, no servers.' },
  { title: 'Realtime', desc: 'Events and live sync.' },
  { title: 'Deployments', desc: 'Sites, branches, compute.' },
]
const DEFAULT_REASONS = [
  { title: 'All-in-one', desc: 'One platform, no glue.' },
  { title: 'Fast', desc: 'Ship in minutes.' },
  { title: 'Trusted', desc: 'Used by modern teams.' },
  { title: 'Scalable', desc: 'Grows with you.' },
]

// Native 1080×1620. All selectors scoped under .plp-saas. Colors via CSS vars.
const CSS = `
.plp-saas { position:relative; width:1080px; height:1620px; overflow:hidden; isolation:isolate;
  font-family: 'Manrope','Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Arial,sans-serif;
  color:var(--plp-text);
  background: linear-gradient(180deg, var(--plp-paper) 0%, #eef0eb 45%, var(--plp-paper2) 59.8%, var(--plp-ink) 59.9%, #050607 100%);
  background-color:#050607; }
.plp-saas *{ box-sizing:border-box; }
.plp-saas::before{ content:""; position:absolute; inset:0 0 645px 0;
  background: linear-gradient(rgba(15,15,15,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(15,15,15,.035) 1px, transparent 1px);
  background-size:36px 36px; mask-image:linear-gradient(180deg, rgba(0,0,0,.75), transparent 86%); pointer-events:none; z-index:0; }
.plp-saas::after{ content:""; position:absolute; left:0; right:0; top:970px; height:1px;
  background:linear-gradient(90deg, transparent, var(--plp-accent), transparent); opacity:.8; z-index:4; }

.plp-brand{ position:absolute; top:42px; left:54px; right:54px; display:flex; align-items:center; justify-content:space-between; z-index:5; }
.plp-lockup{ display:flex; align-items:center; gap:14px; }
.plp-mark{ width:58px; height:58px; border-radius:16px; background:var(--plp-ink); color:var(--plp-accent);
  display:grid; place-items:center; font-weight:800; font-size:20px; box-shadow:0 18px 48px rgba(0,0,0,.22); }
.plp-bname{ font-size:25px; font-weight:800; color:#101010; }
.plp-bsub{ margin-top:2px; color:#555b57; font-size:12px; font-family:'IBM Plex Mono',Consolas,monospace; text-transform:uppercase; }
.plp-laurel{ color:#1d211f; font-size:14px; font-weight:700; text-align:right; max-width:340px; }

.plp-hero{ position:absolute; top:151px; left:64px; width:482px; z-index:5; }
.plp-hero h1{ margin:0; font-family:Georgia,'Times New Roman',serif; font-size:108px; line-height:.86; color:#101010; }
.plp-hero h1 span{ color:var(--plp-accent); }
.plp-divider{ width:104px; height:7px; margin:28px 0 18px; background:var(--plp-accent); }
.plp-tagline{ margin:0; font-size:25px; line-height:1.18; font-weight:900; color:#121412; }
.plp-intro{ margin:18px 0 0; width:420px; font-size:16px; line-height:1.6; color:#414844; }

.plp-device{ position:absolute; top:150px; right:52px; width:478px; height:560px; perspective:1100px; z-index:4; }
.plp-halo{ position:absolute; left:88px; top:334px; width:310px; height:110px; border-radius:50%;
  background:radial-gradient(circle, color-mix(in srgb, var(--plp-accent) 55%, transparent), transparent 72%); filter:blur(8px); }
.plp-pedestal{ position:absolute; left:116px; top:395px; width:268px; height:86px; border-radius:50%;
  background:radial-gradient(circle at 50% 38%, rgba(255,255,255,.4), rgba(25,27,24,.86) 73%), linear-gradient(120deg,#8b6f52,#1b1b1b);
  border:1px solid rgba(255,255,255,.42); box-shadow:0 46px 80px rgba(0,0,0,.24); }
.plp-browser{ position:absolute; left:40px; top:34px; width:420px; height:330px; border-radius:24px;
  background:linear-gradient(180deg,#191a1a,#090a0a); transform:rotateY(-18deg) rotateX(8deg) rotateZ(1deg); transform-style:preserve-3d;
  box-shadow:0 42px 80px rgba(0,0,0,.38), 0 0 0 1px rgba(255,255,255,.13) inset; overflow:hidden; }
.plp-browser-top{ height:44px; display:flex; align-items:center; padding:0 16px; gap:8px; background:#111; border-bottom:1px solid rgba(255,255,255,.09); }
.plp-bdot{ width:9px; height:9px; border-radius:50%; background:#3a3a3a; }
.plp-url{ margin-left:10px; flex:1; height:22px; border-radius:999px; background:#202020; color:#a3a3a3; display:flex; align-items:center; padding-left:14px; font-size:10px; font-family:'IBM Plex Mono',Consolas,monospace; }
.plp-screen{ padding:18px; color:#fff; }
.plp-screen-title{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:14px; }
.plp-screen-title strong{ font-size:20px; }
.plp-screen-title span{ color:var(--plp-accent); font-size:12px; font-family:'IBM Plex Mono',Consolas,monospace; }
.plp-screen-grid{ display:grid; grid-template-columns:1.05fr .95fr; gap:12px; }
.plp-scard{ min-height:82px; border-radius:14px; background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.12); padding:13px; }
.plp-scard label{ display:block; color:#a3a3a3; font-size:10px; text-transform:uppercase; margin-bottom:8px; font-family:'IBM Plex Mono',Consolas,monospace; }
.plp-scard b{ display:block; color:#fff; font-size:18px; line-height:1.05; }
.plp-statusline{ display:flex; align-items:center; gap:8px; margin-top:8px; color:#cfd4d1; font-size:11px; }
.plp-dot{ width:7px; height:7px; border-radius:50%; background:var(--plp-accent); }
.plp-terminal{ grid-column:span 2; height:96px; border-radius:14px; background:#050607; border:1px solid rgba(255,255,255,.12); padding:13px 14px;
  font-family:'IBM Plex Mono',Consolas,monospace; font-size:11px; line-height:1.75; color:#b9bfb9; }
.plp-terminal em{ color:var(--plp-accent); font-style:normal; }

.plp-float{ position:absolute; width:182px; min-height:85px; border-radius:18px; background:rgba(255,255,255,.62); border:1px solid rgba(255,255,255,.7);
  box-shadow:0 22px 55px rgba(0,0,0,.16); backdrop-filter:blur(18px); padding:14px 15px; z-index:6; }
.plp-float.dark{ background:rgba(17,17,17,.68); border-color:rgba(255,255,255,.14); color:#fff; }
.plp-float h3{ margin:0 0 5px; font-size:13px; color:#111; }
.plp-float.dark h3{ color:#fff; }
.plp-float p{ margin:0; font-size:10px; line-height:1.36; color:#5b625e; }
.plp-float.dark p{ color:#bfc6c1; }
.plp-tiny-icon{ width:22px; height:22px; margin-bottom:8px; border:2px solid var(--plp-accent); border-radius:7px; }
.plp-fc1{ left:520px; top:300px; }
.plp-fc2{ right:48px; top:470px; }
.plp-fc3{ left:636px; top:612px; }
.plp-fc4{ right:74px; top:182px; }

.plp-matrix{ position:absolute; left:64px; top:712px; width:600px; z-index:5; }
.plp-matrix-title{ font-size:24px; font-weight:900; color:#111; margin-bottom:18px; }
.plp-features{ display:grid; grid-template-columns:1fr 1fr; gap:11px; }
.plp-feature{ display:grid; grid-template-columns:35px 1fr; gap:12px; align-items:start; min-height:75px; padding:14px; border-radius:18px;
  background:rgba(255,255,255,.54); border:1px solid rgba(255,255,255,.7); backdrop-filter:blur(16px); box-shadow:0 14px 35px rgba(0,0,0,.08); }
.plp-licon{ width:32px; height:32px; border-radius:10px; border:1.7px solid var(--plp-accent); position:relative; }
.plp-licon::before{ content:""; position:absolute; left:7px; right:7px; top:10px; height:1.7px; background:var(--plp-accent); box-shadow:0 7px 0 var(--plp-accent); }
.plp-feature b{ display:block; font-size:13px; color:#111; margin-bottom:3px; }
.plp-feature span{ display:block; font-size:10.5px; line-height:1.35; color:#5f6762; }

.plp-lower{ position:absolute; left:0; right:0; top:970px; bottom:0;
  background:radial-gradient(circle at 50% 44%, color-mix(in srgb, var(--plp-accent) 17%, transparent), transparent 30%), linear-gradient(180deg,#111,#050607 68%);
  color:#fff; z-index:2; }
.plp-lower::before{ content:""; position:absolute; inset:0;
  background:linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
  background-size:44px 44px; opacity:.55; mask-image:linear-gradient(180deg, rgba(0,0,0,.8), transparent 88%); }
.plp-reasons{ position:absolute; top:48px; left:54px; right:54px; z-index:4; }
.plp-reasons h2{ margin:0 0 16px; font-size:28px; font-weight:900; }
.plp-reason-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:13px; }
.plp-reason{ height:120px; padding:17px 16px; border-radius:18px; background:rgba(255,255,255,.065); border:1px solid rgba(255,255,255,.14); backdrop-filter:blur(14px); }
.plp-reason .plp-licon{ border-color:var(--plp-accent); margin-bottom:8px; }
.plp-reason b{ display:block; font-size:13px; margin-bottom:4px; }
.plp-reason p{ margin:0; color:#bfc6c1; font-size:10.5px; line-height:1.42; }

.plp-cta{ position:absolute; left:64px; top:1206px; width:355px; color:#fff; z-index:6; }
.plp-cta h2{ margin:0; font-family:Georgia,'Times New Roman',serif; font-size:50px; line-height:.98; font-weight:800; }
.plp-cta h2 span{ color:var(--plp-accent); }
.plp-cta p{ margin:18px 0 0; color:#cbd1ce; font-size:15px; line-height:1.52; }

.plp-qr{ position:absolute; left:540px; top:1296px; width:160px; height:160px; transform:translate(-50%,-50%);
  background:#fff; padding:8px; box-shadow:0 0 0 1px rgba(255,255,255,.72), 0 24px 70px rgba(0,0,0,.45); z-index:7; }
.plp-qr img{ display:block; width:144px; height:144px; border-radius:0 !important; }
.plp-qr-guide{ position:absolute; left:540px; top:1392px; transform:translateX(-50%); width:280px; text-align:center; color:#dce4e0; font-size:13px; font-weight:800; z-index:7; }

.plp-demo{ position:absolute; right:64px; top:1176px; width:330px; height:304px; padding:22px; border-radius:22px;
  background:rgba(255,255,255,.072); border:1px solid rgba(255,255,255,.14); backdrop-filter:blur(18px); box-shadow:0 28px 70px rgba(0,0,0,.45); z-index:6; }
.plp-demo-head{ display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; color:#fff; }
.plp-demo-head b{ font-size:18px; }
.plp-score{ min-width:64px; height:48px; padding:0 12px; border-radius:14px; display:grid; place-items:center;
  background:color-mix(in srgb, var(--plp-accent) 14%, transparent); color:var(--plp-accent); font-weight:900; font-size:20px; border:1px solid color-mix(in srgb, var(--plp-accent) 42%, transparent); }
.plp-mini-console{ height:92px; border-radius:16px; background:#050607; border:1px solid rgba(255,255,255,.12); padding:13px; color:#b9c2bd;
  font-size:11px; line-height:1.72; font-family:'IBM Plex Mono',Consolas,monospace; margin-bottom:18px; }
.plp-mini-console span{ color:var(--plp-accent); }
.plp-metric{ margin-top:13px; }
.plp-metric-row{ display:flex; justify-content:space-between; color:#dce4e0; font-size:11px; margin-bottom:6px; }
.plp-bar{ height:8px; border-radius:99px; background:rgba(255,255,255,.12); overflow:hidden; }
.plp-bar span{ display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg, var(--plp-accent), var(--plp-accent2)); }

.plp-footer{ position:absolute; left:0; right:0; top:1512px; text-align:center; color:#dfe5e2; font-size:13px;
  font-family:'IBM Plex Mono',Consolas,monospace; letter-spacing:.08em; z-index:8; }
.plp-footer span{ color:var(--plp-accent); }
`
