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

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export class UpstreamError extends Error {
  code: string;
  status: number;
  retryable: boolean;

  constructor(
    code: string,
    message: string,
    status: number,
    retryable: boolean,
  ) {
    super(message);
    this.name = 'UpstreamError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function errorDetails(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
  upstream_status?: number;
} {
  if (error instanceof UpstreamError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      upstream_status: error.status || undefined,
    };
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const message = typeof record.message === 'string' ? record.message : String(error);
    const code = typeof record.code === 'string' ? record.code : 'internal_error';
    const status = typeof record.status === 'number'
      ? record.status
      : typeof record.statusCode === 'number'
        ? record.statusCode
        : undefined;
    return {
      code,
      message,
      retryable: status === 408 || status === 429 || (status !== undefined && status >= 500),
      upstream_status: status,
    };
  }
  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

export async function markGenerationFailed(
  client: ReturnType<typeof createUserClient>,
  generationId: string,
  stage: 'analyze' | 'designer' | 'hero' | 'complete',
  error: unknown,
  code?: string,
): Promise<void> {
  const details = errorDetails(error);
  await client.database
    .from('poster_generations')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      failure_stage: stage,
      failure_code: code ?? details.code,
      failure_message: details.message.slice(0, 2000),
    })
    .eq('id', generationId)
    .catch(() => {});
}

export function userContentWithImages(text: string, imageUrls: readonly string[]): string | unknown[] {
  const urls = imageUrls.filter(Boolean).slice(0, 5);
  if (urls.length === 0) return text;
  return [
    { type: 'text', text },
    ...urls.map((url) => ({ type: 'image_url', image_url: { url } })),
  ];
}

export type ImageReferenceKind =
  | 'previous-poster'
  | 'style-board'
  | 'user-reference'
  | 'logo'
  | 'product';

export interface TypedImageReference {
  kind: ImageReferenceKind;
  url: string;
  purpose: string;
}

const SOURCE_REFERENCE_PRIORITY: Record<ImageReferenceKind, number> = {
  'previous-poster': 0,
  'style-board': 1,
  'user-reference': 2,
  logo: 3,
  product: 4,
};

const PAINTER_REFERENCE_PRIORITY: Record<ImageReferenceKind, number> = {
  'previous-poster': 0,
  'user-reference': 1,
  logo: 2,
  product: 3,
  'style-board': 4,
};

export function orderImageReferences(
  references: readonly TypedImageReference[],
  maxImages = 6,
): TypedImageReference[] {
  return orderReferences(references, maxImages, SOURCE_REFERENCE_PRIORITY);
}

export function orderPainterImageReferences(
  references: readonly TypedImageReference[],
  maxImages = 6,
): TypedImageReference[] {
  return orderReferences(references, maxImages, PAINTER_REFERENCE_PRIORITY);
}

function orderReferences(
  references: readonly TypedImageReference[],
  maxImages: number,
  priority: Record<ImageReferenceKind, number>,
): TypedImageReference[] {
  const seen = new Set<string>();
  return references
    .map((reference, index) => ({ reference, index }))
    .filter(({ reference }) => !!reference.url)
    .sort((a, b) =>
      priority[a.reference.kind] - priority[b.reference.kind] ||
      a.index - b.index
    )
    .filter(({ reference }) => {
      if (seen.has(reference.url)) return false;
      seen.add(reference.url);
      return true;
    })
    .slice(0, Math.max(0, maxImages))
    .map(({ reference }) => reference);
}

export function userContentWithImageReferences(
  text: string,
  references: readonly TypedImageReference[],
  maxImages = 6,
): string | unknown[] {
  const selected = orderImageReferences(references, maxImages);
  if (selected.length === 0) return text;
  return [
    { type: 'text', text },
    ...selected.flatMap((reference, index) => [
      {
        type: 'text',
        text: `IMAGE ${index + 1} PURPOSE [${reference.kind.toUpperCase()}]: ${reference.purpose.slice(0, 240)}`,
      },
      { type: 'image_url', image_url: { url: reference.url } },
    ]),
  ];
}

export function imageGenerationContent(
  prompt: string,
  references: readonly (TypedImageReference | string)[],
  maxImages = 6,
  ordering: 'source' | 'painter' = 'source',
): unknown[] {
  const content: unknown[] = [{ type: 'text', text: prompt }];
  if (references.every((reference) => typeof reference === 'string')) {
    for (const url of (references as readonly string[]).filter(Boolean).slice(0, maxImages)) {
      content.push({ type: 'image_url', image_url: { url } });
    }
    return content;
  }

  const typed = references.filter(
    (reference): reference is TypedImageReference => typeof reference !== 'string',
  );
  const ordered = ordering === 'painter'
    ? orderPainterImageReferences(typed, maxImages)
    : orderImageReferences(typed, maxImages);
  for (const [index, reference] of ordered.entries()) {
    content.push({
      type: 'text',
      text: `REFERENCE ${index + 1} [${reference.kind.toUpperCase()}]: ${reference.purpose.slice(0, 240)}`,
    });
    content.push({ type: 'image_url', image_url: { url: reference.url } });
  }
  return content;
}

// Detect a raster image mime from magic bytes. Content-type headers are
// untrustworthy here — the storage CDN serves everything as
// binary/octet-stream — and SVG/XML/text never match, which is the point:
// image models can only consume raster references. Pure; unit-tested.
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'; // WEBP
  if (bytes.length >= 6 &&
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'; // GIF8
  return null;
}

// Chunked base64 so a multi-MB image never hits the String.fromCharCode
// argument-count limit.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Fetch a reference image and return it as a raster data URL, or null when it
// can't be used (SVG, non-image, oversized, fetch failure). Model providers
// fetch URL references themselves and choke on the CDN's binary/octet-stream
// content type — inlining bytes sidesteps that entirely.
export async function fetchImageAsDataUrl(url: string, maxBytes = 5_000_000): Promise<string | null> {
  if (url.startsWith('data:')) {
    return /^data:image\/(png|jpe?g|webp|gif)[;,]/i.test(url) ? url : null;
  }
  try {
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 10_000);
    try {
      const response = await fetch(url, { signal: ctl.signal });
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > maxBytes) return null;
      const mime = sniffImageMime(bytes);
      if (!mime) return null;
      return `data:${mime};base64,${bytesToBase64(bytes)}`;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

// Inline a list of reference-image URLs as data URLs, in order, dropping any
// that fail and stopping before the total payload outgrows the request-size
// headroom of the chat/image APIs.
export async function inlineReferenceImages(
  urls: readonly string[],
  opts: { maxImages?: number; maxTotalBytes?: number } = {},
): Promise<string[]> {
  const { maxImages = 6, maxTotalBytes = 10_000_000 } = opts;
  const fetched = await Promise.all(
    urls.filter(Boolean).slice(0, maxImages).map((url) => fetchImageAsDataUrl(url)),
  );
  const inlined: string[] = [];
  let total = 0;
  for (const dataUrl of fetched) {
    if (!dataUrl) continue;
    // ~3/4 of the base64 length is the byte size; close enough for a budget.
    const approxBytes = Math.floor(dataUrl.length * 0.75);
    if (total + approxBytes > maxTotalBytes) break;
    total += approxBytes;
    inlined.push(dataUrl);
  }
  return inlined;
}

export async function inlineImageReferences(
  references: readonly TypedImageReference[],
  opts: {
    maxImages?: number;
    maxCandidates?: number;
    maxTotalBytes?: number;
    ordering?: 'source' | 'painter';
  } = {},
): Promise<TypedImageReference[]> {
  const {
    maxImages = 6,
    maxCandidates = 12,
    maxTotalBytes = 12_000_000,
    ordering = 'source',
  } = opts;
  const order = ordering === 'painter'
    ? orderPainterImageReferences
    : orderImageReferences;
  const candidates = order(references, maxCandidates);
  const fetched = await Promise.all(candidates.map(async (reference) => ({
    reference,
    dataUrl: await fetchImageAsDataUrl(reference.url),
  })));
  const valid: TypedImageReference[] = [];
  let total = 0;
  for (const item of fetched) {
    if (!item.dataUrl) continue;
    const approxBytes = Math.floor(item.dataUrl.length * 0.75);
    if (total + approxBytes > maxTotalBytes) continue;
    total += approxBytes;
    valid.push({ ...item.reference, url: item.dataUrl });
  }
  return order(valid, maxImages);
}

async function upstreamFailure(provider: string, response: Response): Promise<UpstreamError> {
  const body = (await response.text().catch(() => '')).slice(0, 500);
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  return new UpstreamError(
    `${provider}_http_error`,
    `${provider} request failed (${response.status})${body ? `: ${body}` : ''}`,
    response.status,
    retryable,
  );
}

export async function aiChat(
  messages: Array<{ role: string; content: string | unknown[] }>,
  opts: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<string> {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        Authorization: `Bearer ${env('OPENROUTER_API_KEY')}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://posterlytics.app',
        'X-Title': 'Posterlytics',
      },
      body: JSON.stringify({
        model: Deno.env.get('OPENROUTER_CHAT_MODEL') ?? 'openai/gpt-4o',
        messages,
        max_completion_tokens: opts.maxTokens ?? 1200,
      }),
    });
    if (!response.ok) throw await upstreamFailure('openrouter_chat', response);
    const result = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      throw new UpstreamError('openrouter_chat_empty', 'OpenRouter returned no text content.', 502, true);
    }
    return content;
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new UpstreamError('openrouter_chat_timeout', 'OpenRouter chat request timed out.', 504, true);
    }
    throw new UpstreamError(
      'openrouter_chat_network',
      error instanceof Error ? error.message : String(error),
      0,
      true,
    );
  } finally {
    clearTimeout(timeout);
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
export type VisualDensity = 'sparse' | 'balanced' | 'dense';

export interface WeightedPaletteColor {
  color: string;
  proportion: number;
}

export interface NormalizedStyleProfile {
  palette: {
    primary: string;
    bg: string;
    text: string;
    accent: string;
    secondary?: string;
    supporting?: string[];
    proportions?: WeightedPaletteColor[];
  };
  fonts: { heading: string; body: string };
  tone: string;
  layout_hint?: string;
  imagery?: string;
  typography_treatment?: string;
  lighting?: string;
  texture?: string;
  motifs?: string[];
  composition?: string;
  density?: VisualDensity;
}

export function normalizeStyleProfile(
  raw: unknown,
  defaults: Partial<NormalizedStyleProfile> = {},
): NormalizedStyleProfile {
  const profile = (raw ?? {}) as Record<string, unknown>;
  const palette = (profile.palette ?? {}) as Record<string, unknown>;
  const defaultPalette = defaults.palette ?? {
    primary: '#1f2937',
    bg: '#ffffff',
    text: '#111827',
    accent: '#10b981',
  };
  const fonts = (profile.fonts ?? {}) as Record<string, unknown>;
  const stringValue = (value: unknown, fallback = '', max = 240) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
  const optional = (value: unknown, fallback: string | undefined, max = 240) => {
    const result = stringValue(value, fallback ?? '', max);
    return result || undefined;
  };
  const density = ['sparse', 'balanced', 'dense'].includes(profile.density as string)
    ? (profile.density as VisualDensity)
    : defaults.density;
  const motifs = boundedStringList(profile.motifs ?? defaults.motifs, 6, 100);
  const supporting = boundedColors(palette.supporting ?? defaultPalette.supporting, 6);
  const proportions = normalizeWeightedPalette(
    palette.proportions ?? palette.usage_proportions ?? defaultPalette.proportions,
  );
  const secondary = normalizeColorValue(palette.secondary) ??
    normalizeColorValue(defaultPalette.secondary);

  return {
    palette: {
      primary: normalizeColorValue(palette.primary) ?? defaultPalette.primary ?? '#1f2937',
      bg: normalizeColorValue(palette.bg) ?? defaultPalette.bg ?? '#ffffff',
      text: normalizeColorValue(palette.text) ?? defaultPalette.text ?? '#111827',
      accent: normalizeColorValue(palette.accent) ?? defaultPalette.accent ?? '#10b981',
      ...(secondary ? { secondary } : {}),
      ...(supporting.length ? { supporting } : {}),
      ...(proportions.length ? { proportions } : {}),
    },
    fonts: {
      heading: stringValue(fonts.heading, defaults.fonts?.heading ?? 'system-ui, sans-serif', 180),
      body: stringValue(fonts.body, defaults.fonts?.body ?? 'system-ui, sans-serif', 180),
    },
    tone: stringValue(profile.tone, defaults.tone ?? 'modern', 120),
    ...(optional(profile.layout_hint, defaults.layout_hint, 240)
      ? { layout_hint: optional(profile.layout_hint, defaults.layout_hint, 240) }
      : {}),
    ...(optional(profile.imagery, defaults.imagery)
      ? { imagery: optional(profile.imagery, defaults.imagery) }
      : {}),
    ...(optional(profile.typography_treatment, defaults.typography_treatment)
      ? { typography_treatment: optional(profile.typography_treatment, defaults.typography_treatment) }
      : {}),
    ...(optional(profile.lighting, defaults.lighting)
      ? { lighting: optional(profile.lighting, defaults.lighting) }
      : {}),
    ...(optional(profile.texture, defaults.texture)
      ? { texture: optional(profile.texture, defaults.texture) }
      : {}),
    ...(motifs.length ? { motifs } : {}),
    ...(optional(profile.composition, defaults.composition)
      ? { composition: optional(profile.composition, defaults.composition) }
      : {}),
    ...(density ? { density } : {}),
  };
}

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
  imagery?: string;
  typography_treatment?: string;
  lighting?: string;
  texture?: string;
  motifs?: string[];
  density?: VisualDensity;
  palette_roles: {
    bg: string;
    surface?: string;
    text: string;
    primary: string;
    accent: string;
    secondary?: string;
    supporting?: string[];
    proportions?: WeightedPaletteColor[];
  };
  zones: PosterLayoutZone[]; // top→lower; the artwork fills the full 2:3 frame (QR footer is outside it)
}

const LAYOUT_BANDS: LayoutBand[] = ['top', 'upper', 'mid', 'lower'];

// Bound + repair an LLM-produced layout into a safe PosterLayout. Pulls palette
// defaults from the campaign style_profile when the model omits them. Pure.
export function normalizePosterLayout(
  raw: unknown,
  palette: {
    bg?: string;
    text?: string;
    primary?: string;
    accent?: string;
    secondary?: string;
    supporting?: string[];
    proportions?: WeightedPaletteColor[];
  } = {},
  direction: Partial<NormalizedStyleProfile> = {},
): PosterLayout {
  const o = (raw ?? {}) as Record<string, unknown>;
  const pr = (o.palette_roles ?? {}) as Record<string, unknown>;
  const str = (v: unknown, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

  const zonesRaw = Array.isArray(o.zones) ? o.zones : [];
  const zones: PosterLayoutZone[] = zonesRaw
    .slice(0, 7)
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
  const density = ['sparse', 'balanced', 'dense'].includes(o.density as string)
    ? (o.density as VisualDensity)
    : direction.density ?? 'balanced';
  const motifs = boundedStringList(o.motifs ?? direction.motifs, 6, 100);
  const imagery = str(o.imagery, direction.imagery ?? '').slice(0, 240);
  const typographyTreatment = str(
    o.typography_treatment,
    direction.typography_treatment ?? '',
  ).slice(0, 240);
  const lighting = str(o.lighting, direction.lighting ?? '').slice(0, 200);
  const texture = str(o.texture, direction.texture ?? '').slice(0, 200);
  const supporting = boundedColors(
    palette.supporting?.length ? palette.supporting : pr.supporting,
    6,
  );
  const proportions = normalizeWeightedPalette(
    palette.proportions?.length ? palette.proportions : pr.proportions,
  );
  const secondary = str(palette.secondary, str(pr.secondary));

  return {
    composition: str(o.composition, 'balanced vertical flow, clear hierarchy top to bottom').slice(0, 240),
    mood: str(o.mood, 'modern, clean, professional').slice(0, 120),
    art_style: str(o.art_style, 'modern editorial graphic design, crisp vector shapes, soft shadows').slice(0, 200),
    ...(imagery ? { imagery } : {}),
    ...(typographyTreatment ? { typography_treatment: typographyTreatment } : {}),
    ...(lighting ? { lighting } : {}),
    ...(texture ? { texture } : {}),
    ...(motifs.length ? { motifs } : {}),
    density,
    palette_roles: {
      bg: str(pr.bg, palette.bg || '#ffffff'),
      ...(str(pr.surface) ? { surface: str(pr.surface) } : {}),
      text: str(pr.text, palette.text || '#111827'),
      primary: str(pr.primary, palette.primary || '#1f2937'),
      accent: str(pr.accent, palette.accent || '#10b981'),
      ...(secondary ? { secondary } : {}),
      ...(supporting.length ? { supporting } : {}),
      ...(proportions.length ? { proportions } : {}),
    },
    zones,
  };
}

export function ensurePosterLayoutZones(
  layout: PosterLayout,
  fallbackZones: readonly PosterLayoutZone[],
  minimum = 3,
): PosterLayout {
  if (layout.zones.length >= minimum) return layout;
  const zones = [...layout.zones];
  const keys = new Set(zones.map((zone) => `${zone.role}\u0000${zone.content}`));
  for (const fallback of fallbackZones) {
    if (zones.length >= minimum || zones.length >= 7) break;
    const key = `${fallback.role}\u0000${fallback.content}`;
    if (keys.has(key) || (!fallback.role && !fallback.content)) continue;
    zones.push({ ...fallback });
    keys.add(key);
  }
  return { ...layout, zones };
}

function boundedStringList(value: unknown, limit: number, maxLength: number): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [...new Set(
    values
      .map((item) => typeof item === 'string' ? item.trim().slice(0, maxLength) : '')
      .filter(Boolean),
  )].slice(0, limit);
}

function boundedColors(value: unknown, limit: number): string[] {
  return [...new Set(
    boundedStringList(value, limit * 2, 32)
      .map((color) => normalizeColorValue(color))
      .filter((color): color is string => !!color),
  )].slice(0, limit);
}

function normalizeWeightedPalette(value: unknown): WeightedPaletteColor[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: WeightedPaletteColor[] = [];
  for (const item of value) {
    const entry = (item ?? {}) as Record<string, unknown>;
    const color = normalizeColorValue(entry.color);
    let proportion = Number(entry.proportion);
    if (!color || !Number.isFinite(proportion) || proportion <= 0 || seen.has(color)) continue;
    if (proportion > 1) proportion /= 100;
    seen.add(color);
    normalized.push({
      color,
      proportion: Math.round(Math.min(1, proportion) * 10_000) / 10_000,
    });
    if (normalized.length >= 10) break;
  }
  return normalized;
}

function normalizeColorValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const rgb = parseColor(value);
  return rgb ? toHex(rgb) : null;
}

export function buildParentContextPrompt(args: {
  instruction: string | null | undefined;
  parentLayout: PosterLayout | null;
  hasPreviousPoster: boolean;
  refreshWebsite?: boolean;
}): string {
  const instruction = args.instruction?.trim().slice(0, 4000) ||
    'Create a refined next version without introducing gratuitous changes.';

  if (!args.parentLayout && !args.hasPreviousPoster) {
    return [
      'VERSION CONTEXT: This is the first poster version.',
      `USER REQUEST: ${instruction}`,
      args.refreshWebsite
        ? 'Use the freshly captured website evidence as the visual source of truth.'
        : '',
    ].filter(Boolean).join('\n');
  }

  const layout = args.parentLayout
    ? JSON.stringify(args.parentLayout).slice(0, 6000)
    : '(parent layout unavailable)';
  return [
    'ITERATION CONTRACT: Edit the current poster into its next version; do not redesign it from scratch.',
    args.hasPreviousPoster
      ? 'The PREVIOUS-POSTER reference is the primary composition and image-editing source.'
      : 'The previous image is unavailable, so use the parent layout as the primary composition source.',
    `USER REQUEST: ${instruction}`,
    'PRESERVATION RULE: Keep every element, word, hierarchy choice, crop, color role, type treatment, texture, motif, spacing relationship, and composition decision that the user did not explicitly ask to change.',
    args.refreshWebsite
      ? 'WEBSITE REFRESH: Reconcile newly captured brand evidence only where it conflicts with stale brand facts; the requested delta and preservation rule still govern the edit.'
      : 'BRAND SNAPSHOT: Reuse the current version brand analysis; do not reinterpret the website or invent a new direction.',
    `PARENT LAYOUT JSON: ${layout}`,
  ].join('\n');
}

// Compile a PosterLayout into a text-to-image prompt. PURE + deterministic — the
// testable seam between the agentic layout and the image model. Reuses hero.ts's
// proven conventions: 2:3 framing, brand-honoring, "render only these exact
// quoted strings", and an Avoid list. The artwork fills the complete frame —
// the SPA composites the QR footer OUTSIDE the artwork on the A4 sheet.
export function compileLayoutPrompt(
  layout: PosterLayout,
  ctx: { product: string; essence: string; hasLogo?: boolean; hasStyleBoard?: boolean },
): string {
  const p = layout.palette_roles;
  const bandLabel: Record<LayoutBand, string> = {
    top: 'TOP strip (0-12% down)',
    upper: 'UPPER area (12-42% down)',
    mid: 'MIDDLE area (42-72% down)',
    lower: 'LOWER area (72-100% down)',
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
    : '\nNo authentic logo image is attached. If the layout calls for a brand identifier, render only the product name already supplied in its quoted zone, as plain text. Do not invent or render any logo, icon, emblem, monogram, mascot, or brand symbol.\n';
  const sourceEvidence = ctx.hasStyleBoard
    ? 'The first attached image is a multi-frame STYLE BOARD captured from the real source page. Treat it as the primary visual evidence.'
    : 'No source style board is attached; rely on the source-derived direction and palette below.';
  const proportions = p.proportions?.length
    ? p.proportions
        .map((entry) => `${entry.color} about ${Math.round(entry.proportion * 100)}%`)
        .join(', ')
    : '';
  const supporting = [p.secondary, ...(p.supporting ?? [])].filter(Boolean).join(', ');
  const visualDirection = [
    layout.imagery ? `Imagery: ${layout.imagery}` : '',
    layout.typography_treatment ? `Typography treatment: ${layout.typography_treatment}` : '',
    layout.lighting ? `Lighting: ${layout.lighting}` : '',
    layout.texture ? `Texture/material finish: ${layout.texture}` : '',
    layout.motifs?.length ? `Motifs: ${layout.motifs.join(', ')}` : '',
  ].filter(Boolean).join('\n');
  const density = layout.density ?? 'balanced';
  const densityInstruction: Record<VisualDensity, string> = {
    sparse:
      'Preserve the source page\'s SPARSE rhythm: use only the supplied zones, keep generous intentional negative space, and resist adding filler details.',
    balanced:
      'Preserve a BALANCED rhythm: maintain clear hierarchy and measured supporting detail without crowding or artificial emptiness.',
    dense:
      'Preserve the source page\'s DENSE rhythm: layer the supplied zones and supporting visual detail while keeping every element legible.',
  };

  return `Create a single PORTRAIT 2:3 product-promotion poster. Custom art-directed layout (NOT a generic template).
Composition: ${layout.composition}. Overall mood: ${layout.mood}. Visual treatment: ${layout.art_style}.
${visualDirection ? `${visualDirection}\n` : ''}${sourceEvidence}

Translate the observed visual language into a poster-specific composition. Do not copy navigation bars, menus, browser chrome, app screens, cards, buttons, tabs, form controls, or other website UI. Do not impose category stereotypes or substitute a trendy medium that is not evidenced by the source. Any REFERENCE PURPOSE labels attached after this prompt are instructions only and must never appear as poster text.

This is a PRINTED POSTER IMAGE, not a web page or app screen: do NOT draw buttons, pills, tabs, or clickable controls. The scannable QR footer bar (printed separately below the artwork) IS the call-to-action, so do NOT render any "Get started" / "Sign up" / "Join now" CTA line or button anywhere — it would be redundant.

${densityInstruction[density]}
${logoLine}
Color roles — use these exact colors: background ${p.bg}; primary brand color ${p.primary}; accent ${p.accent}; ${p.surface ? `surface ${p.surface}; ` : ''}body text ${p.text}.${supporting ? ` Supporting source colors: ${supporting}.` : ''} Stay within this palette plus source neutrals — no rogue colors.
${proportions ? `Preserve the source page's approximate COLOR AREA PROPORTIONS across the finished poster: ${proportions}. Dominant source colors must remain dominant; accents must remain restrained when they were restrained in the source.` : ''}

Honor this brand — infuse its palette, typography, imagery, observed motifs, and vibe; reproduce a logo only when an authentic logo reference is attached:
${ctx.essence || ctx.product}

CRITICAL: the ONLY words rendered anywhere on the poster are the exact quoted strings listed below, and they must all be in ENGLISH. Do NOT print any of the layout/section descriptions, role names, position words, or instruction words as visible text — those are directions, not content.

Arrange the poster top to bottom using these zones — together they fill the complete frame:
${zoneLines || '- TOP strip: plain-text product name.\n- UPPER area: a bold hero headline.\n- MIDDLE area: supporting product detail.'}

All rendered text must be crisp, correctly spelled, legible, ENGLISH only, and limited to the quoted strings above. High quality, sharp, 8k, intentional professional graphic-design composition.
Avoid: garbled or misspelled text, copied navigation or web controls, painted buttons / pills / clickable UI controls, invented logos or symbols when no authentic logo reference is attached, any "Get started"/"Sign up" CTA line (the QR footer bar is the call-to-action), any QR code or barcode drawn by you, more than the quoted strings, non-English text, and watermarks.`;
}

export async function aiImage(
  prompt: string,
  aspectRatio = '4:5',
  referenceImages: Array<TypedImageReference | string> = [],
): Promise<string> {
  const content = imageGenerationContent(prompt, referenceImages, 6, 'painter');

  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 90_000);
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        Authorization: `Bearer ${env('OPENROUTER_API_KEY')}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://posterlytics.app',
        'X-Title': 'Posterlytics',
      },
      body: JSON.stringify({
        model: Deno.env.get('OPENROUTER_IMAGE_MODEL') ?? 'google/gemini-2.5-flash-image',
        modalities: ['image', 'text'],
        messages: [{ role: 'user', content }],
        image_config: { aspect_ratio: aspectRatio },
      }),
    });
    if (!response.ok) throw await upstreamFailure('openrouter_image', response);
    const result = await response.json() as {
      choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
    };
    const url = result.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url) {
      throw new UpstreamError('openrouter_image_empty', 'OpenRouter returned no generated image.', 502, true);
    }
    return url;
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new UpstreamError('openrouter_image_timeout', 'OpenRouter image request timed out.', 504, true);
    }
    throw new UpstreamError(
      'openrouter_image_network',
      error instanceof Error ? error.message : String(error),
      0,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
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

export async function imageSourceToBlob(source: string): Promise<Blob> {
  if (source.startsWith('data:')) return dataUrlToBlob(source);

  const ctl = new AbortController();
  // The service warms Chromium before opening its port. Leave enough room for
  // a cold compute boot plus the service's bounded 12-second page capture.
  const timeout = setTimeout(() => ctl.abort(), 60_000);
  try {
    const response = await fetch(source, { signal: ctl.signal });
    if (!response.ok) throw await upstreamFailure('generated_image_download', response);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/') || blob.size === 0 || blob.size > 20_000_000) {
      throw new UpstreamError(
        'generated_image_invalid',
        'Generated image payload was empty, too large, or not an image.',
        502,
        true,
      );
    }
    return blob;
  } finally {
    clearTimeout(timeout);
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export function logPipelineEvent(entry: {
  source: 'analyze' | 'designer' | 'hero' | 'capture';
  campaignId: string;
  generationId?: string;
  status: 'failed' | 'degraded';
  code: string;
  detail: string;
  error?: unknown;
  durationMs?: number;
}): void {
  const error = entry.error === undefined ? undefined : errorDetails(entry.error);
  const line = JSON.stringify({
    event: 'poster_generation',
    timestamp: new Date().toISOString(),
    source: entry.source,
    campaign_id: entry.campaignId,
    generation_id: entry.generationId,
    severity: entry.status === 'failed' ? 'error' : 'warning',
    status: entry.status,
    code: entry.code,
    detail: entry.detail,
    retryable: error?.retryable ?? false,
    upstream_status: error?.upstream_status,
    duration_ms: entry.durationMs,
  });
  if (entry.status === 'failed') console.error(line);
  else console.warn(line);
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

// Host allowlist for legacy event regeneration (SSRF guard): luma.com / lu.ma
// and their subdomains only. Case-insensitive.
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

export type RGB = [number, number, number];

export interface DesignTokens {
  typography: { headingFamily: string; bodyFamily: string; scale: number[]; weights: number[] };
  colors: {
    bg: string;
    text: string;
    primary: string;
    accent: string;
    palette: string[];
    visualPalette?: WeightedPaletteColor[];
    theme?: 'light' | 'dark' | 'mixed';
  };
  radii: number[];
  shadows: string[];
  spacing: number[];
  button: { bg: string; color: string; radius: number; paddingX: number; paddingY: number; weight: number; shadow?: string } | null;
  fontLinks: string[];
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

export interface CaptureResult {
  tokens: DesignTokens | null;
  styleBoardDataUrl: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
}

export type CaptureColorScheme = 'light' | 'dark';

export function normalizeCaptureColorScheme(value: unknown): CaptureColorScheme | null {
  if (value === undefined || value === null) return 'light';
  return value === 'light' || value === 'dark' ? value : null;
}

export async function captureSite(
  url: string,
  colorScheme: CaptureColorScheme = 'light',
): Promise<CaptureResult> {
  const serviceUrl = Deno.env.get('CAPTURE_SERVICE_URL');
  const token = Deno.env.get('CAPTURE_TOKEN');
  if (!serviceUrl || !token) {
    return {
      tokens: null,
      styleBoardDataUrl: null,
      error: { code: 'capture_unconfigured', message: 'Capture service is not configured.', retryable: false },
    };
  }

  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 15_000);
  try {
    const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/capture`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, color_scheme: colorScheme }),
    });
    const result = await response.json().catch(() => ({})) as {
      tokens?: DesignTokens | null;
      screenshot_b64?: string | null;
      error?: { code?: string; message?: string; retryable?: boolean };
    };
    if (!response.ok) {
      return {
        tokens: null,
        styleBoardDataUrl: null,
        error: {
          code: result.error?.code ?? 'capture_http_error',
          message: result.error?.message ?? `Capture service failed (${response.status}).`,
          retryable: result.error?.retryable ?? response.status >= 500,
        },
      };
    }
    return {
      tokens: result.tokens ?? null,
      styleBoardDataUrl: result.screenshot_b64 ? `data:image/jpeg;base64,${result.screenshot_b64}` : null,
      error: null,
    };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    return {
      tokens: null,
      styleBoardDataUrl: null,
      error: {
        code: timedOut ? 'capture_timeout' : 'capture_network_error',
        message: timedOut ? 'Capture request timed out.' : (error instanceof Error ? error.message : String(error)),
        retryable: true,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
