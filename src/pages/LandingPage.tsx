import { Link } from 'react-router-dom'
import { useReveal } from '../hooks/useReveal'

// Public marketing landing page. Explains what Posterlytics does and routes
// visitors to sign in / get started. Styled in the app's "Warm Editorial Craft"
// system (cream paper, ink outlines, cobalt accent, hard offset shadows).
export function LandingPage() {
  const reveal = useReveal()

  return (
    <div className="lp" ref={reveal}>
      {/* Nav */}
      <nav className="lp-nav">
        <div className="brand">
          <span className="mark">P</span> Posterlytics
        </div>
        <div className="nav-actions">
          <Link to="/signin" className="btn ghost">Sign in</Link>
          <Link to="/signin" className="btn">Get started <span className="btn-icon">→</span></Link>
        </div>
      </nav>

      {/* Hero */}
      <header className="lp-section lp-hero">
        <span className="eyebrow reveal">Poster agent · per-placement QR attribution</span>
        <h1 className="reveal">
          On-brand posters that prove <span className="ink-accent">which placement converts</span>.
        </h1>
        <p className="lede reveal">
          Paste your product URL. Posterlytics reads your brand, generates an on-brand
          poster, and mints a unique tracked QR for every place you post —
          so you know the bulletin board out-pulled LinkedIn, not just that "someone clicked."
        </p>
        <div className="lp-cta-row reveal">
          <Link to="/signin" className="btn">Create your first poster <span className="btn-icon">→</span></Link>
          <a href="#how" className="btn secondary">See how it works</a>
        </div>
        <p className="micro reveal">Email + password · no credit card · live in minutes</p>

        <div className="lp-shot reveal">
          <div className="bar"><i /><i /><i /></div>
          <img src="/shots/picker.png" alt="An on-brand AI-generated poster with a tracked QR" loading="lazy" />
        </div>
      </header>

      {/* Value props */}
      <section className="lp-block alt">
        <div className="lp-section">
          <div className="lp-head reveal">
            <span className="eyebrow">Why Posterlytics</span>
            <h2>From a link to a tracked, on-brand poster</h2>
            <p>Everything a generic QR shortener can't do — the design, the brand match, and the attribution that actually answers "what worked."</p>
          </div>
          <div className="lp-features">
            <div className="lp-feature reveal">
              <div className="ic">{ICONS.wand}</div>
              <h3>On-brand by default</h3>
              <p>We mine your site's real colors, copy, and style, then auto-pick a look that fits — SaaS, cozy, or a bespoke designer layout.</p>
            </div>
            <div className="lp-feature reveal">
              <div className="ic">{ICONS.layers}</div>
              <h3>AI-generated, on-brand</h3>
              <p>A polished poster painted from your brand analysis — your colors, copy, and style, with the real logo worked in.</p>
            </div>
            <div className="lp-feature reveal">
              <div className="ic">{ICONS.qr}</div>
              <h3>A tracked QR per placement</h3>
              <p>Bulletin board, LinkedIn, IG story — each gets its own code and link, so every scan is attributed to a channel.</p>
            </div>
            <div className="lp-feature reveal">
              <div className="ic">{ICONS.chart}</div>
              <h3>Conversions, not just clicks</h3>
              <p>Each scan is logged and attributed, then redirected straight to your product — the scan is the conversion, tied to its exact placement.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Showcase: attribution */}
      <section className="lp-block">
        <div className="lp-section lp-split">
          <div className="reveal">
            <span className="eyebrow">The moat</span>
            <h2>Know which placement actually drove conversions</h2>
            <p>Same product, N unique codes. The dashboard ranks every placement by scans, unique visitors, conversions, and rate.</p>
            <ul>
              <li><span className="tick">✓</span> Per-placement scans &amp; unique visitors (cookie-based, no raw IP stored)</li>
              <li><span className="tick">✓</span> Conversions logged before the redirect to your real page</li>
              <li><span className="tick">✓</span> A clear winner — the channel a bit.ly link can never reveal</li>
            </ul>
          </div>
          <div className="lp-split-media reveal">
            <img src="/shots/analytics.png" alt="Analytics dashboard with per-placement scans, unique visitors, conversions, and rate" loading="lazy" />
          </div>
        </div>
      </section>

      {/* Showcase: placements */}
      <section className="lp-block alt">
        <div className="lp-section lp-split flip">
          <div className="reveal">
            <span className="eyebrow">Placements</span>
            <h2>One poster, a unique QR for every channel</h2>
            <p>Add a placement for each spot you'll promote in. Each mints its own short link and QR, exportable to a crisp PNG.</p>
            <ul>
              <li><span className="tick">✓</span> Unique, scannable QR composited at a fixed, reliable spot</li>
              <li><span className="tick">✓</span> Copy the tracked link or export a print-ready PNG</li>
              <li><span className="tick">✓</span> Publish to activate the tracked QR links</li>
            </ul>
          </div>
          <div className="lp-split-media reveal">
            <img src="/shots/placements.png" alt="Placements view — a unique QR and tracked link per channel" loading="lazy" />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="lp-block" id="how">
        <div className="lp-section">
          <div className="lp-head reveal">
            <span className="eyebrow">How it works</span>
            <h2>Four steps from URL to attribution</h2>
          </div>
          <div className="lp-steps">
            <div className="lp-step reveal"><div className="n" /><h3>Paste your URL</h3><p>Add your product name, CTA, and destination. Pick Auto, SaaS, Cozy, or Designer.</p></div>
            <div className="lp-step reveal"><div className="n" /><h3>Get your poster</h3><p>We analyze your brand and paint an on-brand poster — refine it anytime.</p></div>
            <div className="lp-step reveal"><div className="n" /><h3>Mint placements</h3><p>One tracked QR + link per channel. Export PNGs and post them anywhere.</p></div>
            <div className="lp-step reveal"><div className="n" /><h3>See what converts</h3><p>Publish, then watch scans, unique visitors, and conversions per placement.</p></div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="lp-section">
        <div className="lp-cta reveal">
          <h2>Turn your link into a poster that proves itself</h2>
          <p>Generate an on-brand poster and start tracking which placement converts — in minutes.</p>
          <Link to="/signin" className="btn">Get started free <span className="btn-icon">→</span></Link>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-section">
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 700, color: 'var(--ink)' }}>
            <span className="mark" style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--accent)', color: '#fff', display: 'grid', placeItems: 'center', border: '1.5px solid var(--ink-line)', fontFamily: 'Georgia, serif', fontSize: '0.9rem' }}>P</span>
            Posterlytics
          </div>
          <span>Per-placement attribution for on-brand posters.</span>
          <Link to="/signin" className="link-btn">Sign in →</Link>
        </div>
      </footer>
    </div>
  )
}

const ICONS = {
  wand: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 4 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z" /><path d="M4 20 14 10" /><path d="M19 13l.7 1.5L21 15l-1.3.5L19 17l-.7-1.5L17 15l1.3-.5L19 13Z" /></svg>
  ),
  layers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></svg>
  ),
  qr: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M21 14v.01M14 21h3M21 18v3" /></svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m7 14 3-4 3 3 4-6" /></svg>
  ),
}
