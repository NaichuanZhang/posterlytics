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

// Anon-role InsForge client (the public `view` function).
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

// =====================================================================
// Designer mode: agentic poster layout (LLM-designed) → compiled image prompt.
// `PosterLayout` is the structured spec the `designer` function produces; it's
// mirrored in src/lib/types.ts (Deno bundle can't import across the SPA
// boundary — same pattern as QrZone/DesignTokens). `normalizePosterLayout`
// bounds/repairs model output; `compileLayoutPrompt` is the PURE seam that turns
// the JSON into a text-to-image prompt reusing hero.ts's framing conventions.
// =====================================================================

export type LayoutBand = 'top' | 'upper' | 'mid' | 'lower';

export interface PosterLayoutZone {
  band: LayoutBand;
  role: string; // what this zone is, e.g. "hero headline", "feature grid"
  content: string; // the exact words/text to render in this zone (quoted verbatim)
  emphasis?: 'low' | 'med' | 'high';
  align?: 'left' | 'center' | 'right';
}

export interface PosterLayout {
  composition: string; // e.g. "asymmetric, oversized hero top-left"
  mood: string; // e.g. "editorial, calm, premium"
  art_style: string; // visual medium/treatment, e.g. "flat vector + soft gradients"
  palette_roles: { bg: string; surface?: string; text: string; primary: string; accent: string };
  zones: PosterLayoutZone[]; // top→lower; must finish by ~80% (bottom reserved for the QR band)
}

const LAYOUT_BANDS: LayoutBand[] = ['top', 'upper', 'mid', 'lower'];

// Bound + repair an LLM-produced layout into a safe PosterLayout. Pulls palette
// defaults from the campaign style_profile when the model omits them. Pure.
export function normalizePosterLayout(
  raw: unknown,
  palette: { bg?: string; text?: string; primary?: string; accent?: string } = {},
): PosterLayout {
  const o = (raw ?? {}) as Record<string, unknown>;
  const pr = (o.palette_roles ?? {}) as Record<string, unknown>;
  const str = (v: unknown, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

  const zonesRaw = Array.isArray(o.zones) ? o.zones : [];
  const zones: PosterLayoutZone[] = zonesRaw
    .slice(0, 8)
    .map((z) => {
      const x = (z ?? {}) as Record<string, unknown>;
      const band = LAYOUT_BANDS.includes(x.band as LayoutBand) ? (x.band as LayoutBand) : 'mid';
      const emphasis = ['low', 'med', 'high'].includes(x.emphasis as string)
        ? (x.emphasis as 'low' | 'med' | 'high')
        : undefined;
      const align = ['left', 'center', 'right'].includes(x.align as string)
        ? (x.align as 'left' | 'center' | 'right')
        : undefined;
      return {
        band,
        role: str(x.role).slice(0, 80),
        content: str(x.content).slice(0, 280),
        ...(emphasis ? { emphasis } : {}),
        ...(align ? { align } : {}),
      };
    })
    .filter((z) => z.role || z.content);

  return {
    composition: str(o.composition, 'balanced vertical flow, clear hierarchy top to bottom').slice(0, 240),
    mood: str(o.mood, 'modern, clean, professional').slice(0, 120),
    art_style: str(o.art_style, 'modern editorial graphic design, crisp vector shapes, soft shadows').slice(0, 200),
    palette_roles: {
      bg: str(pr.bg, palette.bg || '#ffffff'),
      ...(str(pr.surface) ? { surface: str(pr.surface) } : {}),
      text: str(pr.text, palette.text || '#111827'),
      primary: str(pr.primary, palette.primary || '#1f2937'),
      accent: str(pr.accent, palette.accent || '#10b981'),
    },
    zones,
  };
}

// Compile a PosterLayout into a text-to-image prompt. PURE + deterministic — the
// testable seam between the agentic layout and the image model. Reuses hero.ts's
// proven conventions: 2:3 framing, brand-honoring, "render only these exact
// quoted strings", the bottom ~20% empty-margin rule (so the SPA letterbox crop
// + QR band stay clean), and an Avoid list.
export function compileLayoutPrompt(
  layout: PosterLayout,
  ctx: { product: string; essence: string; hasLogo?: boolean },
): string {
  const p = layout.palette_roles;
  const bandLabel: Record<LayoutBand, string> = {
    top: 'TOP strip (0-12% down)',
    upper: 'UPPER area (12-40% down)',
    mid: 'MIDDLE area (40-60% down)',
    lower: 'LOWER area (60-74% down)',
  };
  // Stable top→lower order regardless of the order the model emitted zones in.
  const ordered = [...layout.zones].sort((a, b) => LAYOUT_BANDS.indexOf(a.band) - LAYOUT_BANDS.indexOf(b.band));
  const zoneLines = ordered
    .map((z) => {
      const emph = z.emphasis === 'high' ? ' (dominant, largest element)' : z.emphasis === 'low' ? ' (small, secondary)' : '';
      const align = z.align ? `, ${z.align}-aligned` : '';
      const text = z.content ? ` Render the exact text: "${z.content}".` : '';
      return `- ${bandLabel[z.band]}${align}: ${z.role}${emph}.${text}`;
    })
    .join('\n');

  const logoLine = ctx.hasLogo
    ? '\nA reference image of the brand LOGO is provided alongside this prompt — reproduce it FAITHFULLY (exact shape, proportions, and colors) in the top brand row. Do not redraw, restyle, or distort it.\n'
    : '';

  return `Create a single PORTRAIT 2:3 product-promotion poster. Custom art-directed layout (NOT a generic template).
Composition: ${layout.composition}. Overall mood: ${layout.mood}. Visual treatment: ${layout.art_style}.

This is a PRINTED POSTER IMAGE, not a web page or app screen: do NOT draw buttons, pills, rounded clickable controls, tabs, or any UI chrome. The scannable QR footer bar (composited afterward) IS the call-to-action, so do NOT render any "Get started" / "Sign up" / "Join now" CTA line or button anywhere — it would be redundant.

Make the poster INFORMATION-DENSE and editorial: fill the composition with multiple supporting elements (a feature grid, a stat or proof row, product detail, icons) so it feels rich and considered — avoid large empty areas above the reserved bottom margin.
${logoLine}
Color roles — use these exact colors: background ${p.bg}; primary brand color ${p.primary}; vivid accent ${p.accent}; ${p.surface ? `card/surface ${p.surface}; ` : ''}body text ${p.text}. Stay within this palette plus neutrals — no rogue colors.

Honor this brand — infuse its palette, logo motif and vibe, do not invent an unrelated look:
${ctx.essence || ctx.product}

CRITICAL: the ONLY words rendered anywhere on the poster are the exact quoted strings listed below, and they must all be in ENGLISH. Do NOT print any of the layout/section descriptions, role names, position words, or instruction words as visible text — those are directions, not content.

Arrange the poster top to bottom using these zones:
${zoneLines || '- UPPER area: a bold hero headline.\n- MIDDLE area: supporting product detail.'}

CRITICAL FRAMING: FINISH all artwork and text by about 74% of the way down the poster. Leave the BOTTOM ~26% — a full-width horizontal strip along the very bottom edge — as completely clean, plain, EMPTY background (color ${p.bg}) with absolutely nothing in it: no cards, panels, frames, text, icons, buttons, QR code, barcode, or decoration. That bottom margin is cropped off and replaced by a branded footer bar afterward, so anything drawn there is discarded or clashes. Keep a comfortable empty gap of plain background between the last content and that bottom margin so the transition reads cleanly.

All rendered text must be crisp, correctly spelled, legible, ENGLISH only, and limited to the quoted strings above. High quality, sharp, 8k, intentional professional graphic-design composition.
Avoid: garbled or misspelled text, painted buttons / pills / clickable UI controls, any "Get started"/"Sign up" CTA line (the QR footer bar is the call-to-action), any QR code or barcode drawn by you, more than the quoted strings, non-English text, watermarks, and a busy/cluttered bottom edge.`;
}

// Call the InsForge AI image proxy. Returns a base64 data URL. `referenceImages`
// (optional) are URLs passed to the proxy's `images:[{url}]` field so an
// image-capable model (gemini) can condition on them — used to paint the real
// brand logo into the poster. Omitted entirely when empty (identical request to
// text-only), so the feature degrades gracefully when no logo is available.
export async function aiImage(
  baseUrl: string,
  apiKey: string,
  prompt: string,
  aspectRatio = '4:5',
  referenceImages: string[] = [],
): Promise<string> {
  const refs = referenceImages.filter(Boolean);
  const r = await fetch(`${baseUrl}/api/ai/image/generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: Deno.env.get('OPENROUTER_IMAGE_MODEL') ?? 'google/gemini-2.5-flash-image',
      prompt,
      image_config: { aspect_ratio: aspectRatio },
      ...(refs.length ? { images: refs.map((url) => ({ url })) } : {}),
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

// =====================================================================
// Agentic failure traces (persist request/response when a step fails/degrades)
// =====================================================================

// Clamp any value to a bounded, JSON-safe shape so a trace row never bloats.
// Strings longer than `cap` are truncated with a "…[+N chars]" marker; objects
// are walked and each string field clamped; the whole thing is size-guarded by
// re-clamping the serialized form. Pure — unit-tested.
export function truncateForTrace(value: unknown, cap = 12_000): unknown {
  const clampStr = (s: string): string =>
    s.length > cap ? `${s.slice(0, cap)}…[+${s.length - cap} chars]` : s;

  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined) return v ?? null;
    if (typeof v === 'string') return clampStr(v);
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (depth >= 6) return clampStr(String(v));
    if (Array.isArray(v)) return v.slice(0, 50).map((x) => walk(x, depth + 1));
    if (typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(val, depth + 1);
      }
      return out;
    }
    return clampStr(String(v));
  };

  return walk(value, 0);
}

export type TraceStep = 'analyze' | 'designer' | 'hero' | 'landing' | 'capture';
export type TraceStatus = 'failed' | 'degraded';

// Best-effort insert of one agent_traces row. Owner RLS (the auth-scoped client
// already carries the caller's bearer token). SWALLOWS its own errors — a failed
// trace-write must never mask the real error or throw into the pipeline.
export async function logTrace(
  // deno-lint-ignore no-explicit-any
  client: any,
  entry: {
    campaignId: string;
    userId: string;
    step: TraceStep;
    status: TraceStatus;
    detail?: string;
    request?: unknown;
    response?: unknown;
  },
): Promise<void> {
  try {
    await client.database.from('agent_traces').insert([
      {
        campaign_id: entry.campaignId,
        user_id: entry.userId,
        step: entry.step,
        status: entry.status,
        detail: entry.detail ?? null,
        request: entry.request === undefined ? null : truncateForTrace(entry.request),
        response: entry.response === undefined ? null : truncateForTrace(entry.response),
      },
    ]);
  } catch {
    // Never let observability break the pipeline.
  }
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
// Event scenario: Luma event scraping + logistics formatting (PURE)
//
// A Luma event page is server-rendered with a schema.org/Event JSON-LD block
// (startDate/endDate ISO w/ tz offset, location Place, organizer[], image) plus
// OG tags. `extractEventDetails` parses that deterministically (NO LLM) so the
// poster's date/time/location are accurate — the image model never authors them.
// `formatEventLines` turns EventDetails into the exact human strings the poster
// renders. Both are pure + unit-tested. `EventDetails` mirrors src/lib/types.ts.
// =====================================================================

export interface EventDetails {
  event_name?: string;
  starts_at?: string; // ISO-8601 with tz offset
  ends_at?: string;
  tz_offset?: string; // e.g. "-07:00"
  tz_label?: string;
  location_name?: string;
  location_address?: string;
  location_city?: string;
  location_region?: string;
  location_country?: string;
  attendance_mode?: 'offline' | 'online';
  online_platform?: string;
  address_hidden?: boolean;
  host_name?: string;
  host_url?: string;
  host_logo_url?: string;
  hosts?: string[];
  price_label?: string;
  register_url?: string;
  cover_image_url?: string;
  cover_image_key?: string;
}

// Event promo-poster zones (poster_spec when scenario === 'event'). Mirrors
// src/lib/types.ts EventPosterSpec.
export interface EventPosterSpec {
  title: string;
  date_line: string;
  time_line: string;
  location_line: string;
  host_line: string;
  rsvp_label: string;
  price_line?: string;
  urls: string;
}

// Host allowlist for any server-side Luma fetch (SSRF guard): luma.com / lu.ma
// and their subdomains only. Case-insensitive. Used by both `event-preview`
// (wizard pre-fill) and `sync-event` (refresh) before fetching a caller/stored URL.
export function isLumaHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'luma.com' ||
    h === 'lu.ma' ||
    h.endsWith('.luma.com') ||
    h.endsWith('.lu.ma')
  );
}

// Fetch a Luma event page's HTML safely. SSRF-hardened + bounded:
//   • the initial `target` MUST already be a validated Luma https URL (callers
//     parse + isLumaHost-check it so they can return their own status code);
//   • redirects are handled MANUALLY and each hop's Location is re-validated
//     against the Luma allowlist — a `follow` could otherwise bounce to an
//     internal/arbitrary host after the first check passed;
//   • the body is STREAM-read with a hard byte cap so an unexpectedly huge (or
//     hostile) allowed page can't exhaust edge memory;
//   • non-HTML content-types are skipped.
// Returns '' on ANY failure/timeout/off-allowlist redirect — callers treat an
// empty parse as "no usable data" and degrade gracefully. Never throws.
export async function fetchLumaHtml(target: URL, maxBytes = 2_000_000, timeoutMs = 5000): Promise<string> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let current = target;
    let hops = 0;
    while (hops < 4) {
      const r = await fetch(current.href, {
        signal: ctl.signal,
        redirect: 'manual',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        },
      });
      // Redirect: validate the next hop against the allowlist before following.
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location');
        if (!loc) { await r.body?.cancel().catch(() => {}); return ''; }
        let next: URL;
        try {
          next = new URL(loc, current);
        } catch {
          await r.body?.cancel().catch(() => {});
          return '';
        }
        await r.body?.cancel().catch(() => {}); // drain the redirect response
        if (next.protocol !== 'https:' || !isLumaHost(next.hostname)) return ''; // off-allowlist
        current = next;
        hops++;
        continue;
      }
      if (!r.ok) { await r.body?.cancel().catch(() => {}); return ''; }
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      if (ct && !ct.includes('html') && !ct.includes('text')) {
        await r.body?.cancel().catch(() => {});
        return '';
      }
      return await readCapped(r, maxBytes);
    }
    return '';
  } catch {
    return '';
  } finally {
    clearTimeout(to);
  }
}

// Read a response body up to `maxBytes` via the stream, then stop and cancel —
// so we never buffer an unbounded body into memory. Returns the decoded prefix.
async function readCapped(r: Response, maxBytes: number): Promise<string> {
  const reader = r.body?.getReader();
  if (!reader) {
    const t = await r.text();
    return t.length > maxBytes ? t.slice(0, maxBytes) : t;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); total += value.length; }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const merged = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, merged.length - off);
    if (take <= 0) break;
    merged.set(c.subarray(0, take), off);
    off += take;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

// Pull the tz offset ("-07:00" / "+05:30" / "Z"→"+00:00") out of an ISO datetime.
function tzOffsetOf(iso: string): string | undefined {
  const m = /([+-]\d{2}:?\d{2})$|Z$/.exec(iso.trim());
  if (!m) return undefined;
  if (m[0] === 'Z') return '+00:00';
  const raw = m[1];
  return raw.includes(':') ? raw : `${raw.slice(0, 3)}:${raw.slice(3)}`;
}

// Parse a schema.org/Event JSON-LD block + OG tags out of a Luma event page's
// HTML into EventDetails. Deterministic and defensive: any missing/blocked field
// simply stays undefined (e.g. "Register to See Address" events expose only a
// city). Returns a best-effort object; callers merge in an og:title fallback.
export function extractEventDetails(html: string): EventDetails {
  const out: EventDetails = {};
  if (!html) return out;

  // 1. Find and parse each <script type="application/ld+json"> block; keep the
  //    first that is (or contains) an Event.
  const ld = findEventJsonLd(html);
  if (ld) {
    const name = strOf(ld.name);
    if (name) out.event_name = name;
    const start = strOf(ld.startDate);
    if (start) { out.starts_at = start; out.tz_offset = tzOffsetOf(start); }
    const end = strOf(ld.endDate);
    if (end) out.ends_at = end;

    const mode = strOf(ld.eventAttendanceMode).toLowerCase();
    if (mode.includes('online')) out.attendance_mode = 'online';
    else if (mode.includes('offline')) out.attendance_mode = 'offline';

    // location: a Place ({name,address}) or a VirtualLocation ({url}).
    const loc = ld.location;
    const locObj = Array.isArray(loc) ? loc[0] : loc;
    if (locObj && typeof locObj === 'object') {
      const l = locObj as Record<string, unknown>;
      const lname = strOf(l.name);
      if (lname) out.location_name = lname;
      if (strOf(l.url) && !out.location_name) out.online_platform = strOf(l.url);
      const addr = l.address;
      if (addr && typeof addr === 'object') {
        const a = addr as Record<string, unknown>;
        const street = strOf(a.streetAddress);
        if (street) out.location_address = street;
        const city = strOf(a.addressLocality);
        if (city) out.location_city = city;
        const region = strOf(a.addressRegion);
        if (region) out.location_region = region;
        const country = strOf(a.addressCountry);
        if (country) out.location_country = country;
      } else if (typeof addr === 'string' && addr.trim()) {
        // Luma sometimes emits a bare address string; "Register to See Address"
        // means the real street is withheld.
        if (/register to see/i.test(addr)) out.address_hidden = true;
        else out.location_address = addr.trim();
      }
    }

    // organizer: an Organization and/or Person entries.
    const orgs = Array.isArray(ld.organizer) ? ld.organizer : ld.organizer ? [ld.organizer] : [];
    const names: string[] = [];
    for (const o of orgs) {
      if (o && typeof o === 'object') {
        const oo = o as Record<string, unknown>;
        const n = strOf(oo.name);
        if (n) names.push(n);
        if (!out.host_url && strOf(oo.url)) out.host_url = strOf(oo.url);
        if (!out.host_logo_url && strOf(oo.image)) out.host_logo_url = strOf(oo.image);
      }
    }
    if (names.length) { out.host_name = names[0]; out.hosts = names; }

    const img = strOf(Array.isArray(ld.image) ? ld.image[0] : ld.image);
    if (img) out.cover_image_url = img;

    // offers.price → a "Free"/"$N" label.
    const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
    if (offer && typeof offer === 'object') {
      const price = strOf((offer as Record<string, unknown>).price);
      if (price === '0' || price === '0.00') out.price_label = 'Free';
      else if (price) out.price_label = price;
    }
  }

  // 2. OG-tag fallbacks for anything JSON-LD didn't provide.
  if (!out.event_name) {
    const ogT = metaContent(html, 'og:title');
    if (ogT) out.event_name = ogT.replace(/\s*·\s*Luma\s*$/i, '').trim();
  }
  if (!out.cover_image_url) {
    const ogImg = metaContent(html, 'og:image');
    if (ogImg) out.cover_image_url = ogImg;
  }
  return out;
}

// Find the first Event (or @graph member that is an Event) among all JSON-LD
// blocks. Returns the raw object or null.
function findEventJsonLd(html: string): Record<string, unknown> | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let parsed: unknown;
    try { parsed = JSON.parse(m[1].trim()); } catch { continue; }
    const found = pickEvent(parsed);
    if (found) return found;
  }
  return null;
}

function pickEvent(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) { const f = pickEvent(n); if (f) return f; }
    return null;
  }
  const o = node as Record<string, unknown>;
  const t = o['@type'];
  const typeStr = Array.isArray(t) ? t.join(' ') : String(t ?? '');
  if (/event/i.test(typeStr)) return o;
  if (Array.isArray(o['@graph'])) return pickEvent(o['@graph']);
  return null;
}

function strOf(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// Read a <meta property|name="key" content="..."> value (either attribute order).
function metaContent(html: string, key: string): string | null {
  const k = key.replace(/[:]/g, '\\:');
  return (
    new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]+content=["']([^"']+)["']`, 'i').exec(html)?.[1] ||
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${k}["']`, 'i').exec(html)?.[1] ||
    null
  );
}

// Format EventDetails into the human strings the poster renders. PURE + tz-aware:
// renders the event's LOCAL time from its own offset (never the viewer's zone).
// Any missing field yields an empty string so callers can omit that line.
export function formatEventLines(ev: EventDetails): {
  date_line: string;
  time_line: string;
  location_line: string;
  host_line: string;
} {
  const start = ev.starts_at ? parseIsoParts(ev.starts_at) : null;
  const end = ev.ends_at ? parseIsoParts(ev.ends_at) : null;

  const date_line = start
    ? `${WEEKDAYS[start.weekday]}, ${MONTHS[start.month - 1]} ${start.day}`
    : '';

  const tz = ev.tz_label ? ` ${ev.tz_label}` : ev.tz_offset && ev.tz_offset !== '+00:00' ? ` GMT${ev.tz_offset}` : '';
  const time_line = start
    ? `${clock(start.hour, start.minute)}${end ? `–${clock(end.hour, end.minute)}` : ''}${tz}`
    : '';

  let location_line = '';
  if (ev.attendance_mode === 'online' && !ev.location_name) {
    location_line = ev.online_platform ? 'Online' : 'Online';
  } else {
    const parts = [ev.location_name, ev.location_city].filter((s): s is string => !!s && s.trim().length > 0);
    location_line = parts.join(' · ');
    if (!location_line && ev.address_hidden && ev.location_city) location_line = ev.location_city;
  }

  const host_line = ev.host_name ? `Hosted by ${ev.host_name}` : '';
  return { date_line, time_line, location_line, host_line };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Parse an ISO datetime into its LOCAL calendar parts (as written, honoring the
// embedded offset — not converted to UTC or the runtime's zone). We read the
// wall-clock fields directly from the string and compute the weekday from the
// offset-adjusted UTC instant so it matches the event's own local day.
function parseIsoParts(iso: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso.trim());
  if (!m) return null;
  const year = +m[1], month = +m[2], day = +m[3], hour = +m[4], minute = +m[5];
  // Weekday from the event's local wall-clock date (offset already baked into the
  // written Y-M-D), via a UTC construction to avoid the runtime tz shifting it.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour, minute, weekday };
}

// 24h → "6:30 PM" / "10 AM" (drops ":00").
function clock(hour: number, minute: number): string {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${h12} ${ampm}` : `${h12}:${String(minute).padStart(2, '0')} ${ampm}`;
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
