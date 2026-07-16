// Playwright capture orchestration. Loads a URL in a real Chromium, collects
// viewport-visible computed styles + font links at three scroll positions,
// aggregates them into RawTokens (pure), and merges compressed frames into one
// style board for downstream vision models.

import { chromium, type Browser } from 'playwright';
import sharp from 'sharp';
import { buildRawTokens } from './buildRawTokens.js';
import type { ColorScheme } from './captureOptions.js';
import { dismissPopups } from './dismissPopups.js';
import { framePositions, visibleIntersectionArea } from './frameSampling.js';
import { assertPublicUrl } from './networkSafety.js';
import { normalizeDesignTokens } from './normalizeDesignTokens.js';
import { extractPixelEvidence } from './pixelPalette.js';
import type {
  BrowserCollection,
  CaptureResponse,
  ElementSample,
  RawTokens,
} from './types.js';

const NAV_TIMEOUT_MS = 9_000;
const VIEWPORT = { width: 1280, height: 800 };
const FRAME_QUALITY = 78;
const STYLE_BOARD_WIDTH = 960;
const STYLE_BOARD_QUALITY = 68;

let browserPromise: Promise<Browser> | null = null;

// One shared browser per container process (Chromium launch is expensive).
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const launch = chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    browserPromise = launch;
    void launch.then(
      (browser) => {
        browser.once('disconnected', () => {
          if (browserPromise === launch) browserPromise = null;
        });
      },
      () => {
        if (browserPromise === launch) browserPromise = null;
      },
    );
  }
  return browserPromise;
}

export async function warmBrowser(): Promise<void> {
  await getBrowser();
}

export async function captureUrl(
  rawUrl: string,
  colorScheme: ColorScheme = 'light',
  signal?: AbortSignal,
): Promise<CaptureResponse> {
  const url = normalizeUrl(rawUrl);
  await assertPublicUrl(url);
  signal?.throwIfAborted();
  const browser = await getBrowser();
  signal?.throwIfAborted();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    deviceScaleFactor: 1,
    colorScheme,
  });
  const closeOnAbort = () => void context.close().catch(() => {});
  signal?.addEventListener('abort', closeOnAbort, { once: true });
  const checkedHosts = new Map<string, Promise<void>>();
  await context.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    if (/^(data|blob):/.test(requestUrl)) return route.continue();
    try {
      const hostname = new URL(requestUrl).hostname.toLowerCase();
      let check = checkedHosts.get(hostname);
      if (!check) {
        check = assertPublicUrl(requestUrl).then(() => undefined);
        checkedHosts.set(hostname, check);
      }
      await check;
      await route.continue();
    } catch {
      await route.abort('blockedbyclient');
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(1_500);
  // Never let a download or dialog wedge the page.
  page.on('dialog', (d) => void d.dismiss().catch(() => {}));

  try {
    signal?.throwIfAborted();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForTimeout(400);

    // Dismiss cookie banners / consent + newsletter modals / age gates BEFORE
    // sampling tokens and screenshotting, so both come out clean. Best-effort:
    // any failure leaves the page as-is and capture proceeds.
    await dismissPopups(page, VIEWPORT).catch(() => {});

    const scrollHeight = await page.evaluate(() => Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
    ));
    const positions = framePositions(scrollHeight, VIEWPORT.height);
    const samples: ElementSample[] = [];
    const fontLinks = new Set<string>();
    let title = '';
    const frameBuffers: Buffer[] = [];
    for (const position of positions) {
      signal?.throwIfAborted();
      await page.evaluate((top) => {
        document.documentElement.style.scrollBehavior = 'auto';
        window.scrollTo(0, top);
      }, position);
      await page.waitForTimeout(100);
      const frame = (await page.evaluate(collectInBrowser)) as BrowserCollection;
      if (!title) title = frame.title;
      for (const link of frame.fontLinks) fontLinks.add(link);
      for (const reading of frame.samples) {
        const { bounds, ...sample } = reading;
        const area = visibleIntersectionArea(bounds, VIEWPORT);
        if (area > 0) samples.push({ ...sample, area: Math.round(area) });
      }
      try {
        frameBuffers.push(await page.screenshot({
          type: 'jpeg',
          quality: FRAME_QUALITY,
          animations: 'disabled',
        }));
      } catch {
        // DOM evidence remains useful if a particular frame cannot be painted.
      }
    }

    const finalUrl = page.url();
    const meta: RawTokens['meta'] = {
      url,
      finalUrl,
      title,
      viewport: VIEWPORT,
    };
    const rawTokens = buildRawTokens(samples, [...fontLinks], meta);
    let styleBoard: Buffer | null = null;
    try {
      styleBoard = frameBuffers.length ? await mergeStyleBoard(frameBuffers) : null;
    } catch {
      styleBoard = null;
    }
    const pixelEvidence = styleBoard ? await readPixelEvidence(styleBoard).catch(() => undefined) : undefined;
    const tokens = normalizeDesignTokens(rawTokens, pixelEvidence);

    return {
      tokens,
      screenshot_b64: styleBoard?.toString('base64') ?? null,
      final_url: finalUrl,
      title,
    };
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    await context.close().catch(() => {});
  }
}

async function mergeStyleBoard(frames: Buffer[]): Promise<Buffer> {
  const normalized = await Promise.all(frames.map(async (frame) => {
    const { data, info } = await sharp(frame)
      .resize({ width: STYLE_BOARD_WIDTH, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: FRAME_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  }));
  const width = Math.max(...normalized.map((frame) => frame.width));
  const height = normalized.reduce((sum, frame) => sum + frame.height, 0);
  let top = 0;
  const composites = normalized.map((frame) => {
    const input = { input: frame.data, left: 0, top };
    top += frame.height;
    return input;
  });
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite(composites)
    .jpeg({ quality: STYLE_BOARD_QUALITY, mozjpeg: true })
    .toBuffer();
}

async function readPixelEvidence(styleBoard: Buffer) {
  const { data, info } = await sharp(styleBoard)
    .resize({ width: 180, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return extractPixelEvidence(data, info.channels);
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

  // A curated set of meaningful elements. Cap only after viewport filtering so
  // lower frames are not crowded out by hundreds of earlier offscreen nodes.
  const selectors = 'h1,h2,h3,p,a,button,[role="button"],[class*="btn"],header,nav,section,main,body';
  const nodes = Array.from(document.querySelectorAll(selectors));

  const samples: BrowserCollection['samples'] = [];
  for (const el of nodes) {
    const node = el as HTMLElement;
    const cs = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    if (
      cs.display === 'none' ||
      cs.visibility === 'hidden' ||
      Number(cs.opacity) <= 0.01 ||
      rect.right <= 0 ||
      rect.bottom <= 0 ||
      rect.left >= window.innerWidth ||
      rect.top >= window.innerHeight
    ) continue;

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
      bounds: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      },
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
    if (samples.length >= 400) break;
  }

  // Web-font stylesheets the site loads (kept in design_tokens.fontLinks).
  const fontLinks: string[] = [];
  document.querySelectorAll('link[rel="stylesheet"]').forEach((l) => {
    const href = (l as HTMLLinkElement).href;
    if (href && /fonts\.googleapis|fonts\.gstatic|typekit|use\.typekit|fontawesome|font/i.test(href)) {
      fontLinks.push(href);
    }
  });

  return { samples, fontLinks, title: document.title || '' };
}
