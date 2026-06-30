// Best-effort popup / overlay dismissal, run after the page settles but BEFORE
// token extraction + screenshot — so cookie banners, GDPR overlays, newsletter
// modals, and age gates don't pollute either output.
//
// Hybrid strategy:
//   1. Click recognized consent/close controls so the SITE's own handlers fire
//      (the clean way — lets the site persist the choice and animate out).
//   2. Strict-remove only overlays that clearly look like BLOCKERS (fixed/sticky,
//      very high z-index, covering a large share of the viewport) and unlock
//      body scroll. The strict predicate avoids nuking sticky headers / real UI.
//
// Everything is wrapped so a failure leaves the page as-is and capture proceeds
// (the service degrades gracefully by contract).

import type { Page } from 'playwright';

export interface Viewport {
  width: number;
  height: number;
}

// Box descriptor for the blocker predicate — kept as a plain object so the rule
// is a pure, unit-testable seam (no DOM needed to test it).
export interface OverlayBox {
  position: string; // CSS position
  zIndex: number; // resolved z-index (0 when auto/NaN)
  coverage: number; // fraction (0..1) of the viewport area the rect covers
}

const BLOCKER_MIN_Z = 1000;
const BLOCKER_MIN_COVERAGE = 0.5;
const MAX_LABEL_LEN = 24; // longer strings are sentences, not buttons

// Curated allowlist of accept / close control labels (incl. a few common
// non-English). Matched against the FULL normalized label, so a paragraph like
// "I agree to the terms and conditions…" is excluded by the length guard.
const CONSENT_LABELS = new Set([
  'accept',
  'accept all',
  'accept all cookies',
  'allow all',
  'agree',
  'i agree',
  'ok',
  'okay',
  'got it',
  'continue',
  'close',
  'no thanks',
  'dismiss',
  'allow',
  'understood',
  // non-English
  'accepter',
  'akzeptieren',
  'zustimmen',
  'aceptar',
  'aceitar',
  'accetta',
  'godkänn',
]);

// True when `text` is a recognizable consent/close control label. Pure.
export function isConsentLabel(text: string): boolean {
  const t = (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t || t.length > MAX_LABEL_LEN) return false;
  if (CONSENT_LABELS.has(t)) return true;
  // A bare "✕"/"×"/"x" close glyph.
  if (t === '✕' || t === '×' || t === 'x') return true;
  return false;
}

// The single rule that decides a force-remove. Pure — testable against plain
// objects. A blocker is fixed/sticky AND high z-index AND covers a big share of
// the viewport (so sticky headers / small toasts are spared).
export function isBlockingOverlay(box: OverlayBox): boolean {
  const positioned = box.position === 'fixed' || box.position === 'sticky';
  return positioned && box.zIndex >= BLOCKER_MIN_Z && box.coverage >= BLOCKER_MIN_COVERAGE;
}

// Orchestrator: click known controls, then strict-remove leftover blockers and
// unlock scroll. Returns the number of force-removed nodes (for logging). Never
// throws.
export async function dismissPopups(page: Page, viewport: Viewport): Promise<number> {
  // 1. Click recognized controls (the clean way — the site's own handler fires).
  try {
    await clickConsentControls(page);
  } catch {
    /* best-effort */
  }

  // 2. Strict-remove leftover blockers + unlock scroll.
  let removed = 0;
  try {
    removed = await page.evaluate(removeBlockingOverlays, {
      width: viewport.width,
      height: viewport.height,
      minZ: BLOCKER_MIN_Z,
      minCoverage: BLOCKER_MIN_COVERAGE,
    });
  } catch {
    /* best-effort */
  }

  // 3. Second click pass: a consent bar that was OBSCURED by a (now-removed)
  // modal is exposed and topmost only after step 2, so its control is now
  // clickable. No-op when nothing was removed / nothing matches.
  if (removed > 0) {
    try {
      await clickConsentControls(page);
    } catch {
      /* best-effort */
    }
  }

  return removed;
}

// Click pass — try a bounded set of locators for consent/close controls. Each
// click is short-timed and swallowed; at most a few fire.
async function clickConsentControls(page: Page): Promise<void> {
  const MAX_CLICKS = 3;
  const CLICK_TIMEOUT = 800;
  let clicks = 0;

  // 1. Well-known explicit selectors first (fast, high-precision).
  const knownSelectors = [
    '#onetrust-accept-btn-handler',
    '.cc-allow',
    '[aria-label*="accept" i]',
    '[aria-label*="close" i]',
    '[class*="cookie" i] button',
    '[class*="consent" i] button',
    '[id*="cookie" i] button',
  ];
  for (const sel of knownSelectors) {
    if (clicks >= MAX_CLICKS) break;
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 200 })) {
        await loc.click({ timeout: CLICK_TIMEOUT, force: true });
        clicks++;
        await page.waitForTimeout(150);
      }
    } catch {
      /* best-effort */
    }
  }

  // 2. Buttons/links whose accessible name reads as consent/close.
  if (clicks < MAX_CLICKS) {
    try {
      const candidates = await page.getByRole('button').all();
      for (const loc of candidates) {
        if (clicks >= MAX_CLICKS) break;
        try {
          const name = ((await loc.textContent({ timeout: 200 })) || '').trim();
          if (!isConsentLabel(name)) continue;
          if (!(await loc.isVisible({ timeout: 200 }))) continue;
          await loc.click({ timeout: CLICK_TIMEOUT, force: true });
          clicks++;
          await page.waitForTimeout(150);
        } catch {
          /* best-effort */
        }
      }
    } catch {
      /* best-effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Runs INSIDE the page (serialized by Playwright). Plain DOM only — no imports,
// so the blocker rule is mirrored inline (kept in sync with isBlockingOverlay).
// Removes large fixed/sticky high-z overlays + full-screen backdrops, and
// unlocks scroll locks. Returns the count removed.
// ---------------------------------------------------------------------------
function removeBlockingOverlays(cfg: {
  width: number;
  height: number;
  minZ: number;
  minCoverage: number;
}): number {
  const viewportArea = cfg.width * cfg.height;
  if (viewportArea <= 0) return 0;

  const selectors = [
    'body > *',
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[class*="modal" i]',
    '[class*="cookie" i]',
    '[class*="consent" i]',
    '[class*="overlay" i]',
    '[class*="popup" i]',
    '[id*="cookie" i]',
  ];
  const nodes = new Set<Element>();
  for (const sel of selectors) {
    document.querySelectorAll(sel).forEach((n) => nodes.add(n));
  }

  let removed = 0;
  nodes.forEach((el) => {
    if (!el.isConnected) return;
    const node = el as HTMLElement;
    const cs = getComputedStyle(node);
    const position = cs.position;
    if (position !== 'fixed' && position !== 'sticky') return;

    const z = parseInt(cs.zIndex, 10);
    const zIndex = Number.isFinite(z) ? z : 0;

    const rect = node.getBoundingClientRect();
    const coverage = (Math.max(0, rect.width) * Math.max(0, rect.height)) / viewportArea;

    // Mirror of isBlockingOverlay() — keep in sync.
    const isBlocker = zIndex >= cfg.minZ && coverage >= cfg.minCoverage;
    // A near-full-screen dim/backdrop layer is also a blocker even at lower z.
    const isBackdrop = coverage >= 0.9 && /rgba?\([^)]*0?\.[0-9]+\)/.test(cs.backgroundColor);

    if (isBlocker || isBackdrop) {
      node.remove();
      removed++;
    }
  });

  // Unlock scroll locks that overlays leave behind.
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    el.style.overflow = '';
    el.style.position = '';
    el.style.top = '';
    el.classList.remove('no-scroll', 'modal-open', 'overflow-hidden', 'noscroll');
  }

  return removed;
}
