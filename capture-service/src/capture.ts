// Playwright capture orchestration. Loads a URL in a real Chromium, collects
// viewport-visible computed styles + font links at up to three scroll positions,
// and delegates browser-free token/style-board finalization.

import { chromium, type Browser, type Page } from 'playwright';
import { finalizeCaptureEvidence } from './captureEvidence.js';
import {
  FRAME_SETTLE_MS,
  FULL_FINALIZATION_MIN_REMAINING_MS,
  NAV_TIMEOUT_MS,
  OPTIONAL_FRAME_MIN_REMAINING_MS,
  POST_NAV_SETTLE_MS,
  SOFT_SAMPLING_BUDGET_MS,
  TOP_FRAME_RESERVE_MS,
  startMonotonicTimer,
} from './captureLifecycle.js';
import type { ColorScheme } from './captureOptions.js';
import { DISMISS_BUDGET_MS, dismissPopups } from './dismissPopups.js';
import { framePositions, visibleIntersectionArea } from './frameSampling.js';
import { assertPublicUrl } from './networkSafety.js';
import type {
  BrowserCollection,
  CaptureExecutionResult,
  ElementSample,
  RawTokens,
} from './types.js';

const POST_NAV_SETTLE_MIN_REMAINING_MS =
  TOP_FRAME_RESERVE_MS + POST_NAV_SETTLE_MS;
const POPUP_DISMISS_MIN_REMAINING_MS =
  TOP_FRAME_RESERVE_MS + DISMISS_BUDGET_MS;
const VIEWPORT = { width: 1280, height: 800 };
const FRAME_QUALITY = 78;

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
): Promise<CaptureExecutionResult> {
  const url = normalizeUrl(rawUrl);
  await assertPublicUrl(url);
  signal?.throwIfAborted();
  const browser = await getBrowser();
  signal?.throwIfAborted();
  // The 10-second sampling budget governs PAGE work, so it starts only once a
  // browser exists. Starting it earlier charged a cold Chromium launch (~11s on
  // this container) to the page, which then had no budget left and returned
  // zero-frame evidence. The 13-second request deadline in server.ts is the
  // ceiling that still covers the launch.
  const timer = startMonotonicTimer();
  const hasSamplingBudget = (minimumMs: number): boolean =>
    timer.hasRemaining(minimumMs, SOFT_SAMPLING_BUDGET_MS);
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
    const samples: ElementSample[] = [];
    const fontLinks = new Set<string>();
    let title = '';
    const frameBuffers: Buffer[] = [];
    let captureComplete = true;
    let budgetConstrained = false;

    if (hasSamplingBudget(POST_NAV_SETTLE_MIN_REMAINING_MS)) {
      try {
        await page.waitForTimeout(POST_NAV_SETTLE_MS);
      } catch {
        signal?.throwIfAborted();
        captureComplete = false;
      }
    } else {
      budgetConstrained = true;
      captureComplete = false;
    }

    // Dismiss optional blockers only when its full ceiling still leaves enough
    // time to collect the top frame.
    if (hasSamplingBudget(POPUP_DISMISS_MIN_REMAINING_MS)) {
      try {
        await dismissPopups(page, VIEWPORT);
        signal?.throwIfAborted();
      } catch {
        signal?.throwIfAborted();
        captureComplete = false;
      }
    } else {
      budgetConstrained = true;
      captureComplete = false;
    }

    // The top frame is always attempted before scroll-height work so a slow page
    // can still return useful evidence.
    const topFrame = await captureFrame(page, 0, signal);
    captureComplete = captureComplete && topFrame.complete;
    title = appendFrameEvidence(
      topFrame,
      samples,
      fontLinks,
      frameBuffers,
      title,
    );

    let lowerPositions: number[] = [];
    if (hasSamplingBudget(OPTIONAL_FRAME_MIN_REMAINING_MS)) {
      try {
        const scrollHeight = await page.evaluate(() => Math.max(
          document.documentElement.scrollHeight,
          document.body?.scrollHeight ?? 0,
        ));
        lowerPositions = framePositions(scrollHeight, VIEWPORT.height).slice(1);
      } catch {
        signal?.throwIfAborted();
        captureComplete = false;
      }
    } else {
      budgetConstrained = true;
      captureComplete = false;
    }

    for (const position of lowerPositions) {
      if (!hasSamplingBudget(OPTIONAL_FRAME_MIN_REMAINING_MS)) {
        budgetConstrained = true;
        captureComplete = false;
        break;
      }
      const frame = await captureFrame(page, position, signal);
      captureComplete = captureComplete && frame.complete;
      title = appendFrameEvidence(
        frame,
        samples,
        fontLinks,
        frameBuffers,
        title,
      );
    }

    signal?.throwIfAborted();
    const finalUrl = page.url();
    const meta: RawTokens['meta'] = {
      url,
      finalUrl,
      title,
      viewport: VIEWPORT,
    };
    if (!hasSamplingBudget(FULL_FINALIZATION_MIN_REMAINING_MS)) {
      budgetConstrained = true;
      captureComplete = false;
    }
    const evidence = await finalizeCaptureEvidence({
      samples,
      fontLinks: [...fontLinks],
      meta,
      frameBuffers,
      captureComplete,
      useFastPath: budgetConstrained || !captureComplete,
    });

    return {
      response: {
        tokens: evidence.tokens,
        screenshot_b64: evidence.styleBoard.toString('base64'),
        final_url: finalUrl,
        title,
      },
      outcome: evidence.outcome,
      framesCaptured: frameBuffers.length,
    };
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    await context.close().catch(() => {});
  }
}

interface FrameCapture {
  collection: BrowserCollection | null;
  screenshot: Buffer | null;
  complete: boolean;
}

async function captureFrame(
  page: Page,
  position: number,
  signal?: AbortSignal,
): Promise<FrameCapture> {
  let complete = true;
  try {
    await page.evaluate((top) => {
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, top);
    }, position);
  } catch {
    signal?.throwIfAborted();
    complete = false;
  }
  try {
    await page.waitForTimeout(FRAME_SETTLE_MS);
  } catch {
    signal?.throwIfAborted();
    complete = false;
  }

  let collection: BrowserCollection | null = null;
  try {
    collection = (await page.evaluate(collectInBrowser)) as BrowserCollection;
  } catch {
    signal?.throwIfAborted();
    complete = false;
  }

  let screenshot: Buffer | null = null;
  try {
    screenshot = await page.screenshot({
      type: 'jpeg',
      quality: FRAME_QUALITY,
      animations: 'disabled',
    });
  } catch {
    signal?.throwIfAborted();
    // DOM evidence remains useful if a particular frame cannot be painted.
    complete = false;
  }
  return { collection, screenshot, complete };
}

function appendFrameEvidence(
  frame: FrameCapture,
  samples: ElementSample[],
  fontLinks: Set<string>,
  frameBuffers: Buffer[],
  currentTitle: string,
): string {
  if (frame.screenshot) frameBuffers.push(frame.screenshot);
  if (!frame.collection) return currentTitle;
  for (const link of frame.collection.fontLinks) fontLinks.add(link);
  for (const reading of frame.collection.samples) {
    const { bounds, ...sample } = reading;
    const area = visibleIntersectionArea(bounds, VIEWPORT);
    if (area > 0) samples.push({ ...sample, area: Math.round(area) });
  }
  return currentTitle || frame.collection.title;
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
