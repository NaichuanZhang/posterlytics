import {
  dataUrlToBlob,
  logPipelineEvent,
  type BackendClient,
} from './_shared.ts';
import {
  resolveInheritedStyleBoard,
  type ProductSourceMode,
} from './_sourceAcquisition.ts';
import type { EagerSourceAssets } from './_eagerCapture.ts';

function abs(url: string, base: string): string | null {
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

export function extractAssets(htmlText: string, base: string): {
  logo: string | null;
  logoCandidates: string[];
  images: string[];
  themeColor: string | null;
} {
  if (!htmlText) return { logo: null, logoCandidates: [], images: [], themeColor: null };
  const images: string[] = [];

  const og =
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(htmlText)?.[1] ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(htmlText)?.[1];
  if (og) {
    const a = abs(og, base);
    if (a) images.push(a);
  }

  const twitter = /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i.exec(htmlText)?.[1];
  if (twitter) {
    const a = abs(twitter, base);
    if (a && !images.includes(a)) images.push(a);
  }

  // A few <img> sources that look like product/hero shots.
  const imgRe = /<img[^>]+src=["']([^"']+\.(?:png|jpe?g|webp)(?:\?[^"']*)?)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(htmlText)) && images.length < 6) {
    const a = abs(m[1], base);
    if (a && !/sprite|icon|pixel|tracking|1x1|logo/i.test(a) && !images.includes(a)) images.push(a);
  }

  // Logo: try several signals in priority order and RETURN ALL candidates. Real
  // sites tag logos in many ways (canonical SVG, PNG masthead, apple-touch icon)
  // and image models can't consume SVG — so the caller picks the first raster
  // candidate that successfully rehosts, instead of dead-ending on the first hit.
  const logoCandidates: string[] = [];
  const pushCandidate = (url: string | null | undefined) => {
    if (!url) return;
    const a = abs(url, base);
    if (a && !logoCandidates.includes(a)) logoCandidates.push(a);
  };
  // 1. schema.org JSON-LD "logo": "url" (very common, points at the canonical mark).
  pushCandidate(/"logo"\s*:\s*"([^"]+\.(?:png|jpe?g|webp|svg)(?:\?[^"]*)?)"/i.exec(htmlText)?.[1]);
  // 2. <link rel="...logo..."> or <meta property="og:logo">.
  pushCandidate(/<link[^>]+rel=["'][^"']*logo[^"']*["'][^>]+href=["']([^"']+)["']/i.exec(htmlText)?.[1]);
  pushCandidate(/<meta[^>]+property=["']og:logo["'][^>]+content=["']([^"']+)["']/i.exec(htmlText)?.[1]);
  // 3. An <img> whose class/id/alt/src mentions "logo".
  const logoImg = /<img[^>]+(?:class|id|alt|src|data-[a-z-]+)=["'][^"']*logo[^"']*["'][^>]*>/i.exec(htmlText)?.[0];
  if (logoImg) pushCandidate(/\bsrc=["']([^"']+)["']/i.exec(logoImg)?.[1]);
  // 4. The first <img> inside the <header> (the masthead brand mark).
  const header = /<header\b[\s\S]*?<\/header>/i.exec(htmlText)?.[0];
  if (header) pushCandidate(/<img[^>]+\bsrc=["']([^"']+\.(?:png|jpe?g|webp|svg)(?:\?[^"']*)?)["']/i.exec(header)?.[1]);
  // 5. apple-touch-icon, then favicon (both usually raster — good final fallback).
  pushCandidate(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i.exec(htmlText)?.[1]);
  pushCandidate(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i.exec(htmlText)?.[1]);

  const themeColor =
    /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i.exec(htmlText)?.[1] || null;

  return { logo: logoCandidates[0] ?? null, logoCandidates, images, themeColor };
}

export function mergeEagerSourceAssets(
  extracted: ReturnType<typeof extractAssets>,
  eager: EagerSourceAssets,
): ReturnType<typeof extractAssets> {
  const logoCandidates = dedupeUrls([
    ...extracted.logoCandidates,
    ...eager.logoCandidates,
  ]);
  return {
    ...extracted,
    logo: logoCandidates[0] ?? null,
    logoCandidates,
    images: dedupeUrls([...extracted.images, ...eager.images]),
  };
}

// Mine the most-used VIVID (non-grayscale, mid-luminance) hex colors from the raw
// HTML+CSS. The model otherwise only sees text (styles are stripped) and guesses a
// generic SaaS palette — feeding it the site's REAL colors keeps the poster on-brand.
export function extractColors(htmlText: string): string[] {
  if (!htmlText) return [];
  const counts = new Map<string, number>();
  const re = /#([0-9a-fA-F]{6})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(htmlText))) {
    const hex = '#' + m[1].toLowerCase();
    const r = parseInt(m[1].slice(0, 2), 16);
    const g = parseInt(m[1].slice(2, 4), 16);
    const b = parseInt(m[1].slice(4, 6), 16);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    // Keep only colorful, usable accents (drop near-gray, near-black, near-white).
    if (sat < 0.25 || lum < 0.12 || lum > 0.93) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h).slice(0, 6);
}

export async function rehost(
  client: BackendClient,
  srcUrl: string,
  keyBase: string,
  opts: { rasterOnly?: boolean } = {},
): Promise<{ url: string; key: string } | null> {
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(srcUrl, { signal: ctl.signal });
    clearTimeout(to);
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!/image\//.test(ct)) return null;
    // Image models can't consume SVG (it's text). rasterOnly rejects SVG so the
    // caller can try the next candidate instead of persisting an unusable logo.
    if (opts.rasterOnly && ct.includes('svg')) return null;
    const blob = await r.blob();
    if (blob.size === 0 || blob.size > 5_000_000) return null;
    const ext = ct.includes('png') ? 'png' : ct.includes('svg') ? 'svg' : ct.includes('webp') ? 'webp' : 'jpg';
    const key = `${keyBase}.${ext}`;
    await client.storage.from('assets').remove(key).catch(() => {});
    const { data, error } = await client.storage.from('assets').upload(key, blob);
    if (error || !data) return null;
    return { url: data.url, key: data.key };
  } catch {
    return null;
  }
}

export async function rehostBrandAssets(
  client: BackendClient,
  assets: ReturnType<typeof extractAssets>,
  campaignId: string,
  generationId: string,
) {
  // Re-host logo + up to 2 product images into the public assets bucket so the
  // poster never hot-links the origin (CORS-clean export, survives churn).
  const brandAssets: {
    logo_url?: string;
    logo_key?: string;
    images: Array<{ url: string; key: string }>;
    primary_image_url?: string;
  } = { images: [] };

  // Try logo candidates in priority order, taking the first RASTER one that
  // rehosts successfully. Image models 400 on SVG references, and the site's
  // canonical <link rel="logo"> is often an SVG — so skip past it to the
  // masthead PNG or apple-touch-icon rather than persisting an unusable URL.
  for (const [index, candidate] of assets.logoCandidates.slice(0, 5).entries()) {
    const up = await rehost(
      client,
      candidate,
      `brand/${campaignId}/${generationId}/logo-${index + 1}`,
      { rasterOnly: true },
    );
    if (up) {
      brandAssets.logo_url = up.url;
      brandAssets.logo_key = up.key;
      break;
    }
  }
  if (assets.logoCandidates.length > 0 && !brandAssets.logo_url) {
    logPipelineEvent({
      source: 'analyze',
      campaignId,
      generationId,
      status: 'degraded',
      code: 'logo_rehost_no_raster',
      detail: `Found ${assets.logoCandidates.length} logo candidate(s) but none were fetchable raster images; painting with the product name instead.`,
    });
  }
  for (const [index, imgUrl] of assets.images.slice(0, 2).entries()) {
    const up = await rehost(
      client,
      imgUrl,
      `brand/${campaignId}/${generationId}/img-${index + 1}`,
    );
    if (up) brandAssets.images.push({ url: up.url, key: up.key });
  }
  brandAssets.primary_image_url = brandAssets.images[0]?.url;
  return brandAssets;
}

export async function uploadStyleBoard(
  client: BackendClient,
  styleBoardDataUrl: string | null | undefined,
  productSourceMode: ProductSourceMode,
  previousScreenshotUrlValue: unknown,
  previousScreenshotKeyValue: unknown,
  campaignId: string,
  generationId: string,
) {
  // Upload under a generation-scoped key. Older versions keep their own board.
  const previousScreenshotUrl = String(previousScreenshotUrlValue ?? '') || null;
  const previousScreenshotKey = String(previousScreenshotKeyValue ?? '') || null;
  const inheritedStyleBoard = resolveInheritedStyleBoard(productSourceMode, {
    screenshotUrl: previousScreenshotUrl,
    screenshotKey: previousScreenshotKey,
  });
  let screenshotUrl: string | null = inheritedStyleBoard.screenshotUrl;
  let screenshotKey: string | null = inheritedStyleBoard.screenshotKey;
  let uploadedStyleBoardKey: string | null = null;
  if (styleBoardDataUrl) {
    try {
      const blob = dataUrlToBlob(styleBoardDataUrl);
      const styleBoardKey = `style-board/${campaignId}/${generationId}/style-board.jpg`;
      await client.storage.from('assets').remove(styleBoardKey).catch(() => {});
      const { data, error } = await client.storage
        .from('assets')
        .upload(styleBoardKey, blob);
      if (!error && data) {
        screenshotUrl = data.url;
        screenshotKey = data.key;
        uploadedStyleBoardKey = data.key;
      } else if (error) {
        logPipelineEvent({
          source: 'analyze',
          campaignId,
          generationId,
          status: 'degraded',
          code: 'style_board_upload_failed',
          detail: 'Fresh style board could not be persisted; retaining the previous stored board.',
          error,
        });
      }
    } catch (error) {
      logPipelineEvent({
        source: 'analyze',
        campaignId,
        generationId,
        status: 'degraded',
        code: 'style_board_upload_failed',
        detail: 'Fresh style board could not be persisted; retaining the previous stored board.',
        error,
      });
    }
  }
  return { screenshotUrl, screenshotKey, uploadedStyleBoardKey };
}

export async function discardUploadedAnalysisAssets(
  client: BackendClient,
  uploadedStyleBoardKey: string | null,
  brandAssets: Awaited<ReturnType<typeof rehostBrandAssets>>,
): Promise<void> {
  const keys = [
    uploadedStyleBoardKey,
    brandAssets.logo_key,
    ...brandAssets.images.map((image) => image.key),
  ].filter((key): key is string => !!key);
  await Promise.allSettled(keys.map((key) => client.storage.from('assets').remove(key)));
}

function dedupeUrls(values: readonly string[]): string[] {
  return [...new Set(values)];
}
