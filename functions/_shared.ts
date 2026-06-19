// Shared helpers for Posterlytics edge functions (Deno Subhosting).
import { createClient } from 'npm:@insforge/sdk';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function env(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

// Anon-role InsForge client (public functions: view, convert, scan-geo).
// Sees only published campaigns/placements and the anon-granted RPCs.
export function createAnonClient() {
  return createClient({
    baseUrl: env('INSFORGE_BASE_URL'),
    anonKey: env('ANON_KEY'),
  });
}

// User-scoped client for authenticated functions (analyze, hero): forwards the
// caller's bearer token so owner RLS applies.
export function createUserClient(req: Request) {
  const authHeader = req.headers.get('Authorization');
  const token = authHeader ? authHeader.replace('Bearer ', '') : null;
  return createClient({
    baseUrl: env('INSFORGE_BASE_URL'),
    edgeFunctionToken: token ?? undefined,
  });
}

// Classify a User-Agent into a coarse device + OS. Light regex, no library.
export function parseUA(ua: string): { device: string; os: string } {
  const s = ua || '';
  let device = 'desktop';
  if (/bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot/i.test(s)) device = 'bot';
  else if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(s)) device = 'tablet';
  else if (/Mobi|Android|iPhone|iPod|IEMobile|BlackBerry|Opera Mini/i.test(s)) device = 'mobile';

  let os = 'unknown';
  if (/Windows NT/i.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
  else if (/Mac OS X/i.test(s)) os = 'macOS';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/Linux/i.test(s)) os = 'Linux';
  return { device, os };
}

// SHA-256 hex of (salt | visitorId). Stable visitor identity from a first-party
// cookie — no raw IP ever touches the database.
export async function visitorHash(salt: string, visitorId: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}|${visitorId}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Read a cookie value from the request's Cookie header.
export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? '';
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(raw);
  return m ? decodeURIComponent(m[1]) : null;
}

// Call the InsForge AI chat proxy. Returns the model's text output.
// `content` may be a plain string OR an OpenAI-style multimodal parts array
// ([{type:'text',text},{type:'image_url',image_url:{url}}]) — the proxy forwards
// the messages verbatim, so vision-capable models (gpt-4o) accept both.
export async function aiChat(
  baseUrl: string,
  apiKey: string,
  messages: Array<{ role: string; content: string | unknown[] }>,
  opts: { maxTokens?: number } = {},
): Promise<string> {
  const r = await fetch(`${baseUrl}/api/ai/chat/completion`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: Deno.env.get('OPENROUTER_CHAT_MODEL') ?? 'openai/gpt-4o',
      messages,
      max_completion_tokens: opts.maxTokens ?? 1200,
    }),
  });
  if (!r.ok) throw new Error(`AI chat failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.text ?? '';
}

// Vision-detected calm zone for the AI-poster QR: 0..1 fractions, top-left origin.
export interface QrZone { x: number; y: number; w: number; h: number }

// Ask a vision model (gpt-4o via the chat proxy) for the bounding box of the
// largest clean/empty region in a generated poster image, suitable for compositing
// a square QR sticker. Returns 0..1 fractions (top-left origin) or null on ANY
// failure/uncertainty — NEVER throws, so callers can treat it as best-effort.
// `styleHint` nudges where the gap likely is for the active template.
export async function detectQrZone(
  baseUrl: string,
  apiKey: string,
  imageUrl: string,
  styleHint: string,
): Promise<QrZone | null> {
  try {
    const sys =
      'You are a precise layout analyzer. You receive a portrait product poster ' +
      'image. Find the SINGLE largest clean, empty area suitable for placing a ' +
      'square QR sticker — an area with no text, icons, cards, or busy detail. ' +
      'Respond with ONLY minified JSON: {"x":<0..1>,"y":<0..1>,"w":<0..1>,"h":<0..1>} ' +
      'where x,y is the TOP-LEFT corner as a fraction of image width/height and w,h ' +
      'are its width/height fractions. No prose, no code fences.';
    const user =
      `The empty area is most likely toward the ${styleHint} of the poster. Return the ` +
      'box for that area. If unsure, return the calmest large region you can find.';

    const raw = await aiChat(
      baseUrl,
      apiKey,
      [
        { role: 'system', content: sys },
        {
          role: 'user',
          content: [
            { type: 'text', text: user },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      { maxTokens: 200 },
    );

    const j = extractJson(raw) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : NaN);
    let x = num(j.x), y = num(j.y), w = num(j.w), h = num(j.h);
    if ([x, y, w, h].some((n) => Number.isNaN(n))) return null;

    // Clamp into bounds, keep the box inside the image.
    const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
    x = clamp01(x); y = clamp01(y); w = clamp01(w); h = clamp01(h);
    if (x + w > 1) w = 1 - x;
    if (y + h > 1) h = 1 - y;

    // Lenient size gate: reject only pathological/degenerate boxes. The frontend
    // positions the QR from the box CENTER and sizes it mostly from width, so a
    // short (low-h) gap — common for the SaaS CTA band — is still usable.
    if (w < 0.08 || h < 0.04 || w > 0.6 || h > 0.6) return null;
    return { x, y, w, h };
  } catch {
    return null; // proxy rejected multimodal content / junk output / parse failure
  }
}

// Call the InsForge AI image proxy. Returns a base64 data URL.
export async function aiImage(
  baseUrl: string,
  apiKey: string,
  prompt: string,
  aspectRatio = '4:5',
): Promise<string> {
  const r = await fetch(`${baseUrl}/api/ai/image/generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: Deno.env.get('OPENROUTER_IMAGE_MODEL') ?? 'google/gemini-2.5-flash-image',
      prompt,
      image_config: { aspect_ratio: aspectRatio },
    }),
  });
  if (!r.ok) throw new Error(`AI image failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  const url = j?.images?.[0]?.imageUrl;
  if (!url) throw new Error('AI image response had no imageUrl');
  return url;
}

// Convert a base64 data URL to a Blob (for Storage upload).
export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(meta)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// Extract the first balanced JSON object from a string (handles models that
// wrap JSON in prose or ```json fences).
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in model output');
  return JSON.parse(candidate.slice(start, end + 1));
}

// =====================================================================
// Programmatic design tokens (capture-service → normalized DesignTokens)
// Canonical copy of src/lib/{colorUtils,designTokens}.ts. The Deno bundle
// can't import across the SPA boundary, so this is mirrored (same pattern as
// QrZone). The SPA copy carries the unit tests; keep the two in sync.
// =====================================================================

export type RGB = [number, number, number];

export interface DesignTokens {
  typography: { headingFamily: string; bodyFamily: string; scale: number[]; weights: number[] };
  colors: { bg: string; text: string; primary: string; accent: string; palette: string[] };
  radii: number[];
  shadows: string[];
  spacing: number[];
  button: { bg: string; color: string; radius: number; paddingX: number; paddingY: number; weight: number; shadow?: string } | null;
  fontLinks: string[];
}

// Compact wire shape returned by the capture-service (all-optional / loose).
export interface RawTokens {
  fonts?: Array<{ value: string; count: number; role: string }>;
  fontSizes?: number[];
  fontWeights?: number[];
  colors?: Array<{ value: string; count: number; role: string }>;
  radii?: number[];
  shadows?: string[];
  spacing?: number[];
  button?: { bg?: string; color?: string; radius?: number; paddingX?: number; paddingY?: number; weight?: number; shadow?: string } | null;
  fontLinks?: string[];
  meta?: unknown;
}

export function parseColor(input: string | undefined | null): RGB | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  const fn = /^rgba?\(([^)]+)\)$/.exec(s);
  if (fn) {
    const parts = fn[1].split(',').map((p) => p.trim());
    if (parts.length < 3) return null;
    const r = Number(parts[0]), g = Number(parts[1]), b = Number(parts[2]);
    const a = parts.length >= 4 ? Number(parts[3]) : 1;
    if (![r, g, b].every((n) => Number.isFinite(n))) return null;
    if (Number.isFinite(a) && a < 0.05) return null;
    return [clamp255(r), clamp255(g), clamp255(b)];
  }
  let h = s.replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function clamp255(n: number): number { return Math.max(0, Math.min(255, Math.round(n))); }

export function toHex(rgb: RGB): string {
  return '#' + rgb.map((c) => clamp255(c).toString(16).padStart(2, '0')).join('');
}

export function relativeLuminance(rgb: RGB): number {
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
}

export function vividness(rgb: RGB): number {
  const max = Math.max(...rgb), min = Math.min(...rgb);
  const sat = max === 0 ? 0 : (max - min) / max;
  const lum = relativeLuminance(rgb);
  const lumOk = lum > 0.18 && lum < 0.9 ? 1 : 0.25;
  return sat * lumOk;
}

const GENERIC_FONTS = new Set(['system-ui', '-apple-system', 'sans-serif', 'serif', 'monospace', 'inherit', 'blinkmacsystemfont']);

function firstNonGenericFont(fonts: Array<{ value: string; role: string }>, role: string): string {
  const inRole = fonts.filter((f) => f.role === role && f.value);
  const named = inRole.find((f) => !GENERIC_FONTS.has(f.value.toLowerCase()));
  return (named ?? inRole[0])?.value ?? '';
}

function pickBy<T extends { rgb: RGB }>(entries: T[], score: (e: T) => number): RGB | null {
  let best: RGB | null = null, bestScore = -Infinity;
  for (const e of entries) {
    const s = score(e);
    if (s > bestScore) { bestScore = s; best = e.rgb; }
  }
  return best;
}

function dedupeHex(rgbs: RGB[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const rgb of rgbs) {
    const hex = toHex(rgb);
    if (!seen.has(hex)) { seen.add(hex); out.push(hex); }
    if (out.length >= 10) break;
  }
  return out;
}

function assignColors(raw: RawTokens): DesignTokens['colors'] {
  const entries = (raw.colors ?? [])
    .map((c) => ({ rgb: parseColor(c.value), count: c.count ?? 1, role: c.role ?? 'other' }))
    .filter((c): c is { rgb: RGB; count: number; role: string } => c.rgb !== null);
  const palette = dedupeHex(entries.map((e) => e.rgb));
  const bgC = entries.filter((e) => e.role === 'bg');
  const bg = pickBy(bgC.length ? bgC : entries, (e) => relativeLuminance(e.rgb) * Math.log2(e.count + 2)) ?? [255, 255, 255];
  const textC = entries.filter((e) => e.role === 'text');
  const text = pickBy(textC.length ? textC : entries, (e) => (1 - relativeLuminance(e.rgb)) * Math.log2(e.count + 2)) ?? [17, 24, 39];
  const brandC = entries.filter((e) => e.role === 'button-bg' || e.role === 'link' || e.role === 'border');
  const primary = pickBy(brandC.length ? brandC : entries, (e) => (vividness(e.rgb) + 0.15) * Math.log2(e.count + 2)) ?? [31, 41, 55];
  const accent = pickBy(entries, (e) => vividness(e.rgb)) ?? primary;
  return { bg: toHex(bg), text: toHex(text), primary: toHex(primary), accent: toHex(accent), palette };
}

function cleanNums(arr: number[] | undefined, limit: number): number[] {
  return [...new Set((arr ?? []).filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.round(n)))]
    .sort((a, b) => a - b).slice(0, limit);
}

function numOr(n: number | undefined, fallback: number): number {
  return Number.isFinite(n) ? Math.round(n as number) : fallback;
}

function normHex(c: string | undefined): string | null {
  const rgb = parseColor(c);
  return rgb ? toHex(rgb) : null;
}

// RawTokens -> bounded, role-assigned DesignTokens. Returns null for an empty
// capture so callers fall back to legacy regex mining.
export function normalizeDesignTokens(raw: RawTokens | null | undefined): DesignTokens | null {
  if (!raw || (!raw.colors?.length && !raw.fonts?.length)) return null;
  const fonts = (raw.fonts ?? []).filter((f) => f && f.value);
  const headingFamily = firstNonGenericFont(fonts, 'heading');
  const bodyFamily = firstNonGenericFont(fonts, 'body');
  const button = raw.button
    ? {
        bg: normHex(raw.button.bg) ?? '',
        color: normHex(raw.button.color) ?? '',
        radius: numOr(raw.button.radius, 0),
        paddingX: numOr(raw.button.paddingX, 0),
        paddingY: numOr(raw.button.paddingY, 0),
        weight: numOr(raw.button.weight, 600),
        shadow: raw.button.shadow && raw.button.shadow !== 'none' ? raw.button.shadow : undefined,
      }
    : null;
  return {
    typography: {
      headingFamily,
      bodyFamily: bodyFamily || headingFamily,
      scale: cleanNums(raw.fontSizes, 8),
      weights: cleanNums(raw.fontWeights, 6),
    },
    colors: assignColors(raw),
    radii: cleanNums(raw.radii, 5),
    shadows: (raw.shadows ?? []).filter((s) => s && s !== 'none').slice(0, 4),
    spacing: cleanNums(raw.spacing, 6),
    button,
    fontLinks: [...new Set((raw.fontLinks ?? []).filter(Boolean))].slice(0, 8),
  };
}

// Call the Playwright capture-service for a URL. Best-effort: returns null on any
// failure (missing config, network, non-200, bad payload) so analyze degrades to
// its legacy regex extraction. Never throws.
export async function captureSite(
  url: string,
): Promise<{ tokens: DesignTokens | null; rawTokens: RawTokens | null; screenshotDataUrl: string | null } | null> {
  const serviceUrl = Deno.env.get('CAPTURE_SERVICE_URL');
  const token = Deno.env.get('CAPTURE_TOKEN');
  if (!serviceUrl || !token) return null;
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(`${serviceUrl.replace(/\/$/, '')}/capture`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    clearTimeout(to);
    if (!r.ok) return null;
    const j = await r.json() as { raw_tokens?: RawTokens; screenshot_b64?: string | null };
    const rawTokens = j.raw_tokens ?? null;
    const tokens = normalizeDesignTokens(rawTokens);
    const screenshotDataUrl = j.screenshot_b64 ? `data:image/jpeg;base64,${j.screenshot_b64}` : null;
    return { tokens, rawTokens, screenshotDataUrl };
  } catch {
    return null;
  }
}

// =====================================================================
// Generated-landing safety + runtime injection (pure)
//
// The landing agent authors full HTML but is FORBIDDEN to ship JavaScript. We
// enforce that here, then inject the two pieces that MUST be per-request and
// can't be baked into stored HTML: the tracked CTA href and the scan geo-beacon.
// This is the programmatic seam guaranteeing tracking integrity regardless of
// what the model wrote.
// =====================================================================

export const CTA_PLACEHOLDER = '{{CTA_HREF}}';
export const BEACON_PLACEHOLDER = '{{SCAN_BEACON}}';

// Strip every script/handler the model may have emitted; guarantee the two
// runtime placeholders exist. Returns HTML that is inert until injection.
export function sanitizeLandingHtml(html: string): string {
  let out = String(html ?? '');

  // Defense in depth: remove anything executable the model produced. Only our
  // injected beacon is ever allowed to run.
  out = out.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  out = out.replace(/<script\b[^>]*>/gi, ''); // stray unclosed <script>
  // Inline event handlers: on...="..." / on...='...' / on...=value
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  // Neutralize dangerous URL schemes (javascript:, data: — a data:text/html href
  // executes JS on click) in any URL-bearing attribute. action/formaction also
  // matter: <form action="https://evil"> would exfiltrate inputs.
  const badScheme = '(?:\\s*(?:javascript|data|vbscript):)';
  out = out.replace(new RegExp(`(href|src|action|formaction)\\s*=\\s*"${badScheme}[^"]*"`, 'gi'), '$1="#"');
  out = out.replace(new RegExp(`(href|src|action|formaction)\\s*=\\s*'${badScheme}[^']*'`, 'gi'), "$1='#'");
  out = out.replace(new RegExp(`(href|src|action|formaction)\\s*=\\s*${badScheme}[^\\s>]*`, 'gi'), '$1="#"');
  // Strip CSS @import from inline <style> blocks — it loads attacker-controlled
  // external CSS on every view (a silent visitor beacon / exfiltration vector).
  out = out.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    (_m, open: string, body: string, close: string) => open + body.replace(/@import\b[^;]*;?/gi, '') + close,
  );

  // Guarantee a tracked CTA placeholder. If the model omitted it, append a
  // fallback CTA bar before </body> so the link is never dead.
  if (!out.includes(CTA_PLACEHOLDER)) {
    const fallbackCta =
      `<div style="position:sticky;bottom:14px;margin:44px auto 0;max-width:680px;padding:0 20px">` +
      `<a href="${CTA_PLACEHOLDER}" style="display:block;text-align:center;background:#111;color:#fff;` +
      `text-decoration:none;font-weight:700;padding:16px;border-radius:14px">Learn more</a></div>`;
    out = insertBeforeBodyClose(out, fallbackCta);
  }

  // Guarantee a beacon placeholder slot (rendered inert in preview, real in view).
  if (!out.includes(BEACON_PLACEHOLDER)) {
    out = insertBeforeBodyClose(out, `<!--${BEACON_PLACEHOLDER}-->`);
  }

  return out;
}

// Build the per-request geo-beacon script (mirrors the one in view.ts). When
// scanId is null (e.g. preview), returns '' so nothing fires.
export function beaconScript(scanId: string | null, fnHost: string): string {
  if (!scanId) return '';
  return (
    `<script>(function(){var scanId=${JSON.stringify(scanId)};if(!scanId)return;` +
    `fetch('https://ipapi.co/json/').then(function(r){return r.json()}).then(function(g){` +
    `if(!g||!g.country)return;` +
    `fetch(${JSON.stringify(fnHost)}+'/scan-geo',{method:'POST',headers:{'Content-Type':'application/json'},` +
    `body:JSON.stringify({scan_id:scanId,country:g.country_name||g.country,city:g.city||null})}).catch(function(){});` +
    `}).catch(function(){});})();</script>`
  );
}

// Replace the placeholders with the live tracked CTA + beacon. The BEACON
// placeholder may appear bare or wrapped in an HTML comment (from sanitize).
export function injectLandingRuntime(
  html: string,
  code: string,
  scanId: string | null,
  fnHost: string,
): string {
  const ctaHref = `${fnHost}/convert?code=${encodeURIComponent(code)}`;
  let out = String(html ?? '').split(CTA_PLACEHOLDER).join(ctaHref);
  const beacon = beaconScript(scanId, fnHost);
  out = out.split(`<!--${BEACON_PLACEHOLDER}-->`).join(beacon);
  out = out.split(BEACON_PLACEHOLDER).join(beacon);
  return out;
}

function insertBeforeBodyClose(html: string, snippet: string): string {
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) return html + snippet;
  return html.slice(0, idx) + snippet + html.slice(idx);
}
