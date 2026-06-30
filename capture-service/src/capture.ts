// Playwright capture orchestration. Loads a URL in a real Chromium, collects
// per-element computed styles + font links (the dumb DOM pass), aggregates them
// into RawTokens (pure), and takes a downscaled screenshot small enough for the
// downstream vision model (~<750KB target).

import { chromium, type Browser } from 'playwright';
import { buildRawTokens } from './buildRawTokens.js';
import { dismissPopups } from './dismissPopups.js';
import type { BrowserCollection, CaptureResponse, RawTokens } from './types.js';

const NAV_TIMEOUT_MS = 15_000;
const VIEWPORT = { width: 1280, height: 800 };
// JPEG keeps the screenshot well under the AI proxy's ~750KB data-URL ceiling.
const SCREENSHOT_QUALITY = 70;

let browserPromise: Promise<Browser> | null = null;

// One shared browser per container process (Chromium launch is expensive).
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browserPromise;
}

export async function captureUrl(rawUrl: string): Promise<CaptureResponse> {
  const url = normalizeUrl(rawUrl);
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  // Never let a download or dialog wedge the page.
  page.on('dialog', (d) => void d.dismiss().catch(() => {}));

  try {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
    } catch {
      // Slow/streaming sites never reach networkidle — fall back to DOM ready.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    }
    // Give late CSS/fonts a beat to settle.
    await page.waitForTimeout(600);

    // Dismiss cookie banners / consent + newsletter modals / age gates BEFORE
    // sampling tokens and screenshotting, so both come out clean. Best-effort:
    // any failure leaves the page as-is and capture proceeds.
    await dismissPopups(page, VIEWPORT).catch(() => {});

    const collection = (await page.evaluate(collectInBrowser)) as BrowserCollection;
    const finalUrl = page.url();
    const meta: RawTokens['meta'] = {
      url,
      finalUrl,
      title: collection.title,
      viewport: VIEWPORT,
    };
    const raw_tokens = buildRawTokens(collection.samples, collection.fontLinks, meta);

    // Above-the-fold JPEG screenshot (clip to viewport so the payload stays tiny).
    let screenshot_b64: string | null = null;
    try {
      const buf = await page.screenshot({
        type: 'jpeg',
        quality: SCREENSHOT_QUALITY,
        clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
      });
      screenshot_b64 = buf.toString('base64');
    } catch {
      screenshot_b64 = null;
    }

    return { raw_tokens, screenshot_b64, final_url: finalUrl, title: collection.title };
  } finally {
    await context.close().catch(() => {});
  }
}

function normalizeUrl(u: string): string {
  const s = (u || '').trim();
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

// ---------------------------------------------------------------------------
// Runs INSIDE the page (serialized by Playwright). No TS/Node here — plain DOM.
// Returns dumb per-element readings; all ranking happens in buildRawTokens.
// ---------------------------------------------------------------------------
function collectInBrowser(): BrowserCollection {
  const HEADING_TAGS = new Set(['H1', 'H2', 'H3']);
  const px = (v: string): number => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  // A curated set of meaningful elements (cap to keep the payload bounded).
  const selectors = 'h1,h2,h3,p,a,button,[role="button"],[class*="btn"],header,nav,section,main,body';
  const nodes = Array.from(document.querySelectorAll(selectors)).slice(0, 400);

  const samples: BrowserCollection['samples'] = [];
  for (const el of nodes) {
    const node = el as HTMLElement;
    const cs = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    if (area <= 0) continue; // skip hidden/zero-size

    const tag = node.tagName;
    const cls = (node.getAttribute('class') || '').toLowerCase();
    const isButton =
      tag === 'BUTTON' ||
      node.getAttribute('role') === 'button' ||
      /\bbtn\b|button/.test(cls);
    const lh = cs.lineHeight === 'normal' ? 0 : px(cs.lineHeight);

    samples.push({
      tag,
      role: HEADING_TAGS.has(tag) ? 'heading' : tag === 'BODY' ? 'other' : 'body',
      isButton,
      area: Math.round(area),
      fontFamily: cs.fontFamily || '',
      fontSize: px(cs.fontSize),
      fontWeight: parseInt(cs.fontWeight, 10) || 400,
      lineHeight: lh,
      color: cs.color || '',
      backgroundColor: cs.backgroundColor || '',
      borderRadius: px(cs.borderTopLeftRadius || cs.borderRadius),
      boxShadow: cs.boxShadow || 'none',
      paddingX: (px(cs.paddingLeft) + px(cs.paddingRight)) / 2,
      paddingY: (px(cs.paddingTop) + px(cs.paddingBottom)) / 2,
      isLink: tag === 'A',
    });
  }

  // Web-font stylesheets so the generated landing can <link> the same fonts.
  const fontLinks: string[] = [];
  document.querySelectorAll('link[rel="stylesheet"]').forEach((l) => {
    const href = (l as HTMLLinkElement).href;
    if (href && /fonts\.googleapis|fonts\.gstatic|typekit|use\.typekit|fontawesome|font/i.test(href)) {
      fontLinks.push(href);
    }
  });

  return { samples, fontLinks, title: document.title || '' };
}
