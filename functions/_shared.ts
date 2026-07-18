// Shared helpers for Posterlytics edge functions (Deno Subhosting).
import { createAdminClient, createClient } from 'npm:@insforge/sdk';
import {
  DEFAULT_POSTER_SIZE,
  getPosterFrameLabel,
  getPosterSize,
  type PosterSize,
} from '../src/lib/posterSize.ts';

export {
  DEFAULT_POSTER_SIZE,
  getPosterFrameLabel,
  getPosterSize,
  type PosterSize,
};

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

// Project-admin client used only by scheduled server-side workers. Every stage
// runner still scopes campaign, generation, and trace reads to an explicit
// owner id so admin access never turns an omitted filter into cross-user work.
export function createAdminGenerationClient() {
  return createAdminClient({
    baseUrl: env('INSFORGE_BASE_URL'),
    apiKey: env('API_KEY'),
  });
}

export type BackendClient = ReturnType<typeof createClient>;

export interface GenerationStageRunContext {
  client: BackendClient;
  userId: string;
  campaignId: string;
  generationId: string;
  finalizeFailure: boolean;
  serverOwned: boolean;
}

export async function stageAlreadySucceeded(
  context: Pick<GenerationStageRunContext, 'client' | 'userId' | 'campaignId' | 'generationId'>,
  stage: 'analyze' | 'assets' | 'designer' | 'hero',
): Promise<boolean> {
  const { data, error } = await context.client.database
    .from('generation_stage_traces')
    .select('status')
    .eq('generation_id', context.generationId)
    .eq('campaign_id', context.campaignId)
    .eq('user_id', context.userId)
    .eq('stage', stage)
    .maybeSingle();
  return !error && (data as { status?: unknown } | null)?.status === 'succeeded';
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

export interface CoarseGeo {
  country: string | null;
  city: string | null;
}

export const GEO_LOOKUP_TIMEOUT_MS = 800;

type GeoFetcher = (input: string, init?: RequestInit) => Promise<Response>;

const GEO_HEADER_PAIRS = [
  { country: 'cf-ipcountry', city: 'cf-ipcity' },
  { country: 'x-vercel-ip-country', city: 'x-vercel-ip-city' },
  { country: 'cloudfront-viewer-country', city: 'cloudfront-viewer-city' },
  { country: 'x-geo-country', city: 'x-geo-city' },
] as const;

function normalizeCountry(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const country = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) && country !== 'XX' && country !== 'ZZ'
    ? country
    : null;
}

function normalizeCity(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep an unescaped header value as-is.
  }
  const city = decoded.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return city ? city.slice(0, 120) : null;
}

export function geoFromHeaders(headers: Headers): CoarseGeo | null {
  for (const pair of GEO_HEADER_PAIRS) {
    const country = normalizeCountry(headers.get(pair.country));
    if (country) {
      return {
        country,
        city: normalizeCity(headers.get(pair.city)),
      };
    }
  }
  return null;
}

function normalizeForwardedIp(value: string | null): string | null {
  let candidate = value?.trim() ?? '';
  if (!candidate || candidate.length > 64) return null;

  const bracketed = /^\[([0-9a-f:.]+)\](?::\d{1,5})?$/i.exec(candidate);
  if (bracketed) candidate = bracketed[1];

  const ipv4 = /^(\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?$/.exec(candidate);
  if (ipv4) {
    const octets = ipv4[1].split('.').map(Number);
    return octets.every((octet) => octet <= 255) ? ipv4[1] : null;
  }

  return candidate.includes(':') && /^[0-9a-f:.]+$/i.test(candidate)
    ? candidate.toLowerCase()
    : null;
}

export function forwardedClientIp(headers: Headers): string | null {
  const candidates = [
    headers.get('cf-connecting-ip'),
    headers.get('x-real-ip'),
    headers.get('x-forwarded-for')?.split(',', 1)[0] ?? null,
  ];
  for (const candidate of candidates) {
    const ip = normalizeForwardedIp(candidate);
    if (ip) return ip;
  }
  return null;
}

export function geoFromProviderPayload(payload: unknown): CoarseGeo | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (record.success !== true) return null;
  const country = normalizeCountry(record.country_code);
  if (!country) return null;
  return {
    country,
    city: normalizeCity(record.city),
  };
}

// Prefer location metadata already supplied by the hosting CDN. When it is
// absent, briefly resolve the forwarded address and discard it immediately.
// All failures return null geo fields; none are logged or allowed to escape.
export async function resolveRequestGeo(
  headers: Headers,
  fetcher: GeoFetcher = fetch,
  timeoutMs = GEO_LOOKUP_TIMEOUT_MS,
): Promise<CoarseGeo> {
  const headerGeo = geoFromHeaders(headers);
  if (headerGeo) return headerGeo;

  const clientIp = forwardedClientIp(headers);
  if (!clientIp) return { country: null, city: null };

  const controller = new AbortController();
  const boundedTimeout = Math.min(Math.max(timeoutMs, 1), 2000);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, boundedTimeout);
  });
  const lookup = fetcher(
    `https://ipwho.is/${encodeURIComponent(clientIp)}?fields=success,country_code,city`,
    {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    },
  )
    .then(async (response) => {
      if (!response.ok) return null;
      return geoFromProviderPayload(await response.json());
    })
    .catch(() => null);

  try {
    return (await Promise.race([lookup, timeout])) ?? { country: null, city: null };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
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

export interface RedirectAttribution {
  campaign: string;
  placementCode: string;
}

// Add customer-visible attribution without overriding campaign-owner choices.
// URL parsing and serialization also place the query before any fragment.
export function decorateDestinationUrl(
  destinationUrl: string,
  attribution: RedirectAttribution,
): string {
  try {
    const url = new URL(destinationUrl);
    const parameters = [
      ['utm_source', 'posterlytics'],
      ['utm_medium', 'qr'],
      ['utm_campaign', attribution.campaign],
      ['utm_content', attribution.placementCode],
    ] as const;

    for (const [key, value] of parameters) {
      if (!url.searchParams.has(key)) url.searchParams.append(key, value);
    }
    return url.toString();
  } catch {
    return destinationUrl;
  }
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
  client: BackendClient,
  generationId: string,
  stage: 'analyze' | 'assets' | 'designer' | 'hero' | 'complete',
  error: unknown,
  code?: string,
  userId?: string,
): Promise<void> {
  const details = errorDetails(error);
  let query = client.database
    .from('poster_generations')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      failure_stage: stage,
      failure_code: code ?? details.code,
      failure_message: details.message.slice(0, 2000),
    })
    .eq('id', generationId);
  if (userId) query = query.eq('user_id', userId);
  await query.catch(() => {});
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
  assetId?: string;
  kind: ImageReferenceKind;
  url: string;
  purpose: string;
  key?: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  storageSource?: string;
}

export type TraceImageSkipReason =
  | 'missing_url'
  | 'duplicate'
  | 'candidate_limit'
  | 'fetch_failed'
  | 'unsupported_format'
  | 'empty_image'
  | 'image_too_large'
  | 'byte_budget'
  | 'image_limit';

export interface TraceImageAsset {
  asset_id?: string;
  source: ImageReferenceKind;
  purpose: string;
  url: string | null;
  key: string | null;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  storage_source: string;
  candidate_position: number;
  model_position: number | null;
}

export interface TraceImageSkip {
  asset: TraceImageAsset;
  reason: TraceImageSkipReason;
  detail: string;
}

export interface PreparedImageReferences {
  providerReferences: TypedImageReference[];
  candidateImages: TraceImageAsset[];
  attachedImages: TraceImageAsset[];
  skippedImages: TraceImageSkip[];
}

interface FrozenGenerationAssetRow {
  id: string;
  source: ImageReferenceKind;
  url: string;
  object_key: string | null;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  storage_source: string;
  purpose: string;
  selection_rank: number;
}

export async function loadFrozenGenerationImageReferences(
  context: Pick<GenerationStageRunContext, 'client' | 'userId' | 'campaignId' | 'generationId'>,
): Promise<TypedImageReference[]> {
  const { data, error } = await context.client.database
    .from('generation_assets')
    .select('id, source, url, object_key, filename, mime_type, size_bytes, storage_source, purpose, selection_rank')
    .eq('generation_id', context.generationId)
    .eq('campaign_id', context.campaignId)
    .eq('user_id', context.userId)
    .eq('included', true)
    .order('selection_rank', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as FrozenGenerationAssetRow[]).map((asset) => ({
    assetId: asset.id,
    kind: asset.source,
    url: asset.url,
    key: asset.object_key ?? undefined,
    filename: asset.filename ?? undefined,
    mimeType: asset.mime_type ?? undefined,
    sizeBytes: asset.size_bytes ?? undefined,
    storageSource: asset.storage_source,
    purpose: asset.purpose,
  }));
}

export async function recordGenerationAssetProviderSkips(
  context: Pick<GenerationStageRunContext, 'client' | 'userId' | 'generationId'>,
  stage: 'designer' | 'hero',
  skips: readonly TraceImageSkip[],
): Promise<void> {
  const auditable = skips.filter((skip) => !!skip.asset.asset_id);
  if (auditable.length === 0) return;
  const { error } = await context.client.database.rpc(
    'record_generation_asset_provider_skips',
    {
      p_generation_id: context.generationId,
      p_stage: stage,
      p_skips: auditable,
      p_user_id: context.userId,
    },
  );
  if (error) throw new Error(error.message);
}

export interface TraceContentManifestEntry {
  position: number;
  role: string;
  type: 'text' | 'image';
  text?: string;
  image?: TraceImageAsset;
}

export interface ModelCallTrace {
  attempt: number;
  operation: 'chat' | 'image';
  provider: 'openrouter';
  model_id: string;
  status: 'running' | 'succeeded' | 'failed';
  started_at: string;
  completed_at: string | null;
  prompt: { system?: string; user?: string; image?: string };
  provider_settings: Record<string, unknown>;
  content_manifest: TraceContentManifestEntry[];
  failure: ReturnType<typeof errorDetails> | null;
}

export interface GenerationTraceArtifact {
  kind: 'style-board' | 'layout' | 'poster' | 'analysis';
  url?: string | null;
  key?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  snapshot?: unknown;
  metadata?: Record<string, unknown>;
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

function preserveImageReferenceOrder(
  references: readonly TypedImageReference[],
  maxImages: number,
): TypedImageReference[] {
  const seen = new Set<string>();
  return references
    .filter((reference) => {
      if (!reference.url || seen.has(reference.url)) return false;
      seen.add(reference.url);
      return true;
    })
    .slice(0, Math.max(0, maxImages));
}

export function userContentWithImageReferences(
  text: string,
  references: readonly TypedImageReference[],
  maxImages = 6,
  ordering: 'source' | 'painter' | 'preserve' = 'source',
): string | unknown[] {
  const selected = ordering === 'preserve'
    ? preserveImageReferenceOrder(references, maxImages)
    : ordering === 'painter'
      ? orderPainterImageReferences(references, maxImages)
      : orderImageReferences(references, maxImages);
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
  ordering: 'source' | 'painter' | 'preserve' = 'source',
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
  const ordered = ordering === 'preserve'
    ? preserveImageReferenceOrder(typed, maxImages)
    : ordering === 'painter'
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

export const MAX_REFERENCE_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_REFERENCE_IMPORT_REDIRECTS = 3;
export const REFERENCE_IMPORT_TIMEOUT_MS = 10_000;

const REFERENCE_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HOST_SUFFIXES = [
  '.internal',
  '.invalid',
  '.local',
  '.localhost',
  '.test',
  '.home.arpa',
];
const BLOCKED_IPV4_CIDRS: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
const BLOCKED_IPV6_CIDRS: Array<[string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

export class ReferenceImportError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ReferenceImportError';
    this.code = code;
    this.status = status;
  }
}

export type ReferenceDnsResolver = (hostname: string) => Promise<string[]>;

export interface PublicReferenceImage {
  bytes: Uint8Array;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  finalUrl: URL;
}

export async function assertPublicHttpsUrl(
  value: string | URL,
  resolveHostname: ReferenceDnsResolver = resolveReferenceHostname,
): Promise<URL> {
  let url: URL;
  try {
    if ((value instanceof URL ? value.href : value).length > 2048) {
      throw new Error('too long');
    }
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    throw new ReferenceImportError('invalid_url', 'Image URL is invalid.', 400);
  }

  if (url.protocol !== 'https:') {
    throw new ReferenceImportError('https_required', 'Image URL must use HTTPS.', 400);
  }
  if (url.username || url.password) {
    throw new ReferenceImportError(
      'credentials_not_allowed',
      'Image URL cannot include a username or password.',
      400,
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (
    !hostname
    || hostname === 'localhost'
    || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new ReferenceImportError(
      'unsafe_target',
      'Image URL must use a public network host.',
      400,
    );
  }

  const literal = parseIpAddress(hostname);
  let addresses: string[];
  if (literal) {
    addresses = [hostname];
  } else {
    try {
      addresses = await resolveHostname(hostname);
    } catch (error) {
      if (
        (error instanceof DOMException && error.name === 'AbortError')
        || (error instanceof Error && error.name === 'AbortError')
      ) {
        throw error;
      }
      throw new ReferenceImportError(
        'dns_failed',
        'Image URL host could not be resolved.',
        422,
      );
    }
  }

  if (addresses.length === 0) {
    throw new ReferenceImportError(
      'dns_failed',
      'Image URL host could not be resolved.',
      422,
    );
  }
  if (addresses.some(isPrivateOrReservedAddress)) {
    throw new ReferenceImportError(
      'unsafe_target',
      'Image URL resolves to a private or reserved network.',
      400,
    );
  }

  return url;
}

export function isPrivateOrReservedAddress(address: string): boolean {
  const parsed = parseIpAddress(address);
  if (!parsed) return true;
  const cidrs = parsed.length === 4 ? BLOCKED_IPV4_CIDRS : BLOCKED_IPV6_CIDRS;
  return cidrs.some(([network, prefix]) => {
    const parsedNetwork = parseIpAddress(network);
    return !!parsedNetwork && matchesAddressPrefix(parsed, parsedNetwork, prefix);
  });
}

export async function fetchPublicReferenceImage(
  value: string,
  options: {
    fetchImpl?: typeof fetch;
    resolveHostname?: ReferenceDnsResolver;
    maxBytes?: number;
    maxRedirects?: number;
    timeoutMs?: number;
  } = {},
): Promise<PublicReferenceImage> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveHostname = options.resolveHostname ?? resolveReferenceHostname;
  const maxBytes = options.maxBytes ?? MAX_REFERENCE_IMPORT_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REFERENCE_IMPORT_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? REFERENCE_IMPORT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const resolveWithDeadline: ReferenceDnsResolver = (hostname) =>
    abortable(resolveHostname(hostname), controller.signal);

  try {
    let currentUrl = await assertPublicHttpsUrl(value, resolveWithDeadline);
    let redirectCount = 0;

    while (true) {
      const response = await fetchImpl(currentUrl.href, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          Accept: 'image/avif,image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.1',
          'User-Agent': 'Posterlytics-Reference-Importer/1.0',
        },
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirectCount >= maxRedirects) {
          throw new ReferenceImportError(
            'too_many_redirects',
            `Image URL exceeded the ${maxRedirects}-redirect limit.`,
            422,
          );
        }
        await response.body?.cancel().catch(() => {});
        const location = response.headers.get('location');
        if (!location) {
          throw new ReferenceImportError(
            'invalid_redirect',
            'Image server returned a redirect without a destination.',
            422,
          );
        }
        currentUrl = await assertPublicHttpsUrl(new URL(location, currentUrl), resolveWithDeadline);
        redirectCount += 1;
        continue;
      }

      if (!response.ok) {
        throw new ReferenceImportError(
          'download_failed',
          `Image server returned HTTP ${response.status}.`,
          422,
        );
      }

      const bytes = await readBoundedResponse(response, maxBytes);
      const mimeType = sniffImageMime(bytes);
      if (!mimeType || !REFERENCE_IMAGE_MIMES.has(mimeType)) {
        throw new ReferenceImportError(
          'unsupported_image',
          'Image URL must return a JPEG, PNG, or WebP image.',
          415,
        );
      }

      return {
        bytes,
        mimeType: mimeType as PublicReferenceImage['mimeType'],
        finalUrl: currentUrl,
      };
    }
  } catch (error) {
    if (error instanceof ReferenceImportError) throw error;
    if (
      (error instanceof DOMException && error.name === 'AbortError')
      || (error instanceof Error && error.name === 'AbortError')
    ) {
      throw new ReferenceImportError(
        'download_timeout',
        'Image download exceeded the 10-second limit.',
        504,
      );
    }
    throw new ReferenceImportError(
      'download_failed',
      error instanceof Error ? error.message : 'Image download failed.',
      422,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function importedReferenceFilename(
  url: URL,
  mimeType: PublicReferenceImage['mimeType'],
): string {
  const extension = mimeType === 'image/jpeg'
    ? 'jpg'
    : mimeType === 'image/png'
      ? 'png'
      : 'webp';
  const pathParts = url.pathname.split('/').filter(Boolean);
  const encodedName = url.pathname.endsWith('/') ? '' : pathParts[pathParts.length - 1] ?? '';
  let decodedName = encodedName;
  try {
    decodedName = decodeURIComponent(encodedName);
  } catch {
    // Keep malformed escapes encoded.
  }
  const stem = decodedName
    .normalize('NFKD')
    .replace(/\.(?:jpe?g|png|webp)$/i, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 70) || 'reference-image';
  return `${stem}.${extension}`;
}

async function resolveReferenceHostname(hostname: string): Promise<string[]> {
  const results = await Promise.allSettled([
    Deno.resolveDns(hostname, 'A'),
    Deno.resolveDns(hostname, 'AAAA'),
  ]);
  return results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    signal.addEventListener('abort', handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', handleAbort);
        reject(error);
      },
    );
  });
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ReferenceImportError(
      'image_too_large',
      'Image exceeds the 10 MB limit.',
      413,
    );
  }
  if (!response.body) {
    throw new ReferenceImportError('empty_image', 'Image response was empty.', 422);
  }

  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ReferenceImportError(
        'image_too_large',
        'Image exceeds the 10 MB limit.',
        413,
      );
    }
    chunks.push(value);
  }
  if (total === 0) {
    throw new ReferenceImportError('empty_image', 'Image response was empty.', 422);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseIpAddress(address: string): number[] | null {
  const value = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (value.includes('%')) return null;
  return value.includes(':') ? parseIpv6(value) : parseIpv4(value);
}

function parseIpv4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => /^\d{1,3}$/.test(part) ? Number(part) : -1);
  return bytes.every((part) => part >= 0 && part <= 255) ? bytes : null;
}

function parseIpv6(value: string): number[] | null {
  let normalized = value;
  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':');
    const ipv4 = parseIpv4(normalized.slice(lastColon + 1));
    if (lastColon < 0 || !ipv4) return null;
    normalized = `${normalized.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (
    [...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))
    || (halves.length === 1 && left.length !== 8)
    || (halves.length === 2 && left.length + right.length >= 8)
  ) {
    return null;
  }

  const groups = [
    ...left,
    ...Array(8 - left.length - right.length).fill('0'),
    ...right,
  ].map((part) => Number.parseInt(part, 16));
  if (groups.length !== 8) return null;
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

function matchesAddressPrefix(address: number[], network: number[], prefix: number): boolean {
  if (address.length !== network.length || prefix < 0 || prefix > address.length * 8) return false;
  const wholeBytes = Math.floor(prefix / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (address[index] !== network[index]) return false;
  }
  const remainingBits = prefix % 8;
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (address[wholeBytes] & mask) === (network[wholeBytes] & mask);
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

export type ModelImageFetchResult =
  | { ok: true; dataUrl: string; mimeType: string; sizeBytes: number }
  | {
      ok: false;
      reason: 'fetch_failed' | 'unsupported_format' | 'empty_image' | 'image_too_large';
      detail: string;
      mimeType?: string;
      sizeBytes?: number;
    };

export type ModelImageFetcher = (
  url: string,
  maxBytes: number,
) => Promise<ModelImageFetchResult>;

// Fetch and validate the same bytes that will be placed in a provider request.
// The returned data URL is request-only; trace metadata always retains the
// durable source URL/key and never persists inline bytes.
export async function fetchImageForModel(
  url: string,
  maxBytes = 5_000_000,
): Promise<ModelImageFetchResult> {
  if (url.startsWith('data:')) {
    const match = /^data:image\/(png|jpe?g|webp|gif)(?:;[^,]*)?,/i.exec(url);
    if (!match) {
      return {
        ok: false,
        reason: 'unsupported_format',
        detail: 'Inline image is not a supported raster format.',
      };
    }
    const payload = url.slice(url.indexOf(',') + 1);
    const sizeBytes = /;base64,/i.test(url)
      ? Math.floor(payload.length * 0.75)
      : new TextEncoder().encode(decodeURIComponent(payload)).length;
    if (sizeBytes <= 0) {
      return { ok: false, reason: 'empty_image', detail: 'Image payload is empty.' };
    }
    if (sizeBytes > maxBytes) {
      return {
        ok: false,
        reason: 'image_too_large',
        detail: `Image exceeds the ${maxBytes.toLocaleString()} byte per-image limit.`,
        sizeBytes,
      };
    }
    const subtype = match[1].toLowerCase();
    const mimeType = subtype === 'jpg' ? 'image/jpeg' : `image/${subtype}`;
    return { ok: true, dataUrl: url, mimeType, sizeBytes };
  }

  try {
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 10_000);
    try {
      const response = await fetch(url, { signal: ctl.signal });
      if (!response.ok) {
        return {
          ok: false,
          reason: 'fetch_failed',
          detail: `Image fetch returned HTTP ${response.status}.`,
        };
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0) {
        return { ok: false, reason: 'empty_image', detail: 'Fetched image was empty.' };
      }
      if (bytes.length > maxBytes) {
        return {
          ok: false,
          reason: 'image_too_large',
          detail: `Image exceeds the ${maxBytes.toLocaleString()} byte per-image limit.`,
          sizeBytes: bytes.length,
        };
      }
      const mimeType = sniffImageMime(bytes);
      if (!mimeType) {
        return {
          ok: false,
          reason: 'unsupported_format',
          detail: 'Fetched content is not a supported raster image.',
          sizeBytes: bytes.length,
        };
      }
      return {
        ok: true,
        dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
        mimeType,
        sizeBytes: bytes.length,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return {
      ok: false,
      reason: 'fetch_failed',
      detail: error instanceof DOMException && error.name === 'AbortError'
        ? 'Image fetch timed out.'
        : 'Image could not be fetched.',
    };
  }
}

export async function fetchImageAsDataUrl(
  url: string,
  maxBytes = 5_000_000,
): Promise<string | null> {
  const result = await fetchImageForModel(url, maxBytes);
  return result.ok ? result.dataUrl : null;
}

export async function prepareImageReferences(
  references: readonly TypedImageReference[],
  opts: {
    maxImages?: number;
    maxCandidates?: number;
    maxImageBytes?: number;
    maxTotalBytes?: number;
    ordering?: 'source' | 'painter' | 'preserve';
    fetcher?: ModelImageFetcher;
  } = {},
): Promise<PreparedImageReferences> {
  const {
    maxImages = 6,
    maxCandidates = 12,
    maxImageBytes = 5_000_000,
    maxTotalBytes = 12_000_000,
    ordering = 'source',
    fetcher = fetchImageForModel,
  } = opts;
  const positioned = references
    .map((reference, index) => ({ reference, candidatePosition: index + 1 }))
    .sort((a, b) => {
      if (ordering === 'preserve') return a.candidatePosition - b.candidatePosition;
      const priority = ordering === 'painter'
        ? PAINTER_REFERENCE_PRIORITY
        : SOURCE_REFERENCE_PRIORITY;
      return priority[a.reference.kind] - priority[b.reference.kind]
        || a.candidatePosition - b.candidatePosition;
    });
  const candidateImages = positioned.map(({ reference, candidatePosition }) =>
    traceImageAsset(reference, candidatePosition)
  );
  const skippedImages: TraceImageSkip[] = [];
  const unique: typeof positioned = [];
  const seen = new Set<string>();

  for (const candidate of positioned) {
    const asset = traceImageAsset(candidate.reference, candidate.candidatePosition);
    if (!candidate.reference.url) {
      skippedImages.push({
        asset,
        reason: 'missing_url',
        detail: 'Candidate did not have an image URL.',
      });
      continue;
    }
    if (seen.has(candidate.reference.url)) {
      skippedImages.push({
        asset,
        reason: 'duplicate',
        detail: 'A higher-priority candidate already uses this image.',
      });
      continue;
    }
    seen.add(candidate.reference.url);
    if (unique.length >= Math.max(0, maxCandidates)) {
      skippedImages.push({
        asset,
        reason: 'candidate_limit',
        detail: `Candidate falls beyond the ${Math.max(0, maxCandidates)}-image fetch limit.`,
      });
      continue;
    }
    unique.push(candidate);
  }

  const fetched = await Promise.all(unique.map(async (candidate) => ({
    candidate,
    result: await fetcher(candidate.reference.url, maxImageBytes),
  })));
  const providerReferences: TypedImageReference[] = [];
  const attachedImages: TraceImageAsset[] = [];
  let totalBytes = 0;

  for (const { candidate, result } of fetched) {
    const baseAsset = traceImageAsset(candidate.reference, candidate.candidatePosition);
    if (!result.ok) {
      skippedImages.push({
        asset: {
          ...baseAsset,
          mime_type: result.mimeType ?? baseAsset.mime_type,
          size_bytes: result.sizeBytes ?? baseAsset.size_bytes,
        },
        reason: result.reason,
        detail: result.detail,
      });
      continue;
    }
    const fetchedAsset = {
      ...baseAsset,
      mime_type: result.mimeType,
      size_bytes: result.sizeBytes,
    };
    if (providerReferences.length >= Math.max(0, maxImages)) {
      skippedImages.push({
        asset: fetchedAsset,
        reason: 'image_limit',
        detail: `Candidate falls beyond the ${Math.max(0, maxImages)}-image model limit.`,
      });
      continue;
    }
    if (totalBytes + result.sizeBytes > Math.max(0, maxTotalBytes)) {
      skippedImages.push({
        asset: fetchedAsset,
        reason: 'byte_budget',
        detail: 'Candidate would exceed the total image byte budget.',
      });
      continue;
    }

    totalBytes += result.sizeBytes;
    const modelPosition = providerReferences.length + 1;
    providerReferences.push({
      ...candidate.reference,
      url: result.dataUrl,
      mimeType: result.mimeType,
      sizeBytes: result.sizeBytes,
    });
    attachedImages.push({ ...fetchedAsset, model_position: modelPosition });
  }

  return { providerReferences, candidateImages, attachedImages, skippedImages };
}

// Compatibility wrappers retained for callers that only need provider payloads.
export async function inlineReferenceImages(
  urls: readonly string[],
  opts: { maxImages?: number; maxTotalBytes?: number } = {},
): Promise<string[]> {
  const prepared = await prepareImageReferences(
    urls.map((url, index) => ({
      kind: 'user-reference' as const,
      url,
      purpose: `Supporting image ${index + 1}`,
    })),
    opts,
  );
  return prepared.providerReferences.map((reference) => reference.url);
}

export async function inlineImageReferences(
  references: readonly TypedImageReference[],
  opts: {
    maxImages?: number;
    maxCandidates?: number;
    maxTotalBytes?: number;
    ordering?: 'source' | 'painter' | 'preserve';
  } = {},
): Promise<TypedImageReference[]> {
  return (await prepareImageReferences(references, opts)).providerReferences;
}

function traceImageAsset(
  reference: TypedImageReference,
  candidatePosition: number,
): TraceImageAsset {
  return {
    asset_id: reference.assetId,
    source: reference.kind,
    purpose: reference.purpose.slice(0, 1000),
    url: durableTraceUrl(reference.url),
    key: reference.key ?? null,
    filename: reference.filename ?? filenameFromImageUrl(reference.url),
    mime_type: reference.mimeType ?? null,
    size_bytes: Number.isFinite(reference.sizeBytes) ? reference.sizeBytes! : null,
    storage_source: reference.storageSource ??
      (reference.key ? 'insforge-storage' : reference.url.startsWith('data:') ? 'runtime-inline' : 'external-url'),
    candidate_position: candidatePosition,
    model_position: null,
  };
}

function durableTraceUrl(value: string): string | null {
  if (!value || value.startsWith('data:')) return null;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function filenameFromImageUrl(value: string): string | null {
  if (!value || value.startsWith('data:')) return null;
  try {
    const filename = decodeURIComponent(new URL(value).pathname.split('/').filter(Boolean).pop() ?? '');
    return filename.slice(0, 240) || null;
  } catch {
    return null;
  }
}

export function buildTraceContentManifest(
  messages: Array<{ role: string; content: string | unknown[] }>,
  attachedImages: readonly TraceImageAsset[],
): TraceContentManifestEntry[] {
  const manifest: TraceContentManifestEntry[] = [];
  let imageIndex = 0;

  for (const message of messages) {
    const parts = typeof message.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : message.content;
    for (const part of parts) {
      const record = part && typeof part === 'object'
        ? part as Record<string, unknown>
        : {};
      if (record.type === 'image_url') {
        const image = attachedImages[imageIndex] ?? {
          source: 'user-reference',
          purpose: 'Image metadata was unavailable.',
          url: null,
          key: null,
          filename: null,
          mime_type: null,
          size_bytes: null,
          storage_source: 'unknown',
          candidate_position: imageIndex + 1,
          model_position: imageIndex + 1,
        } satisfies TraceImageAsset;
        imageIndex += 1;
        manifest.push({
          position: manifest.length + 1,
          role: message.role,
          type: 'image',
          image,
        });
        continue;
      }
      if (record.type === 'text' && typeof record.text === 'string') {
        manifest.push({
          position: manifest.length + 1,
          role: message.role,
          type: 'text',
          text: traceSafeText(record.text),
        });
      }
    }
  }

  return manifest;
}

export function traceSafeText(value: string): string {
  return value
    .replace(/data:image\/[a-z0-9.+-]+(?:;[^,\s]*)?,[^\s"'<>]+/gi, '[inline image omitted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk-or-v1|ik)_[A-Za-z0-9_-]{12,}\b/g, '[credential redacted]');
}

export function resolvedChatModelId(): string {
  return Deno.env.get('OPENROUTER_CHAT_MODEL') ?? 'openai/gpt-4o';
}

export function resolvedImageModelId(): string {
  return Deno.env.get('OPENROUTER_IMAGE_MODEL') ?? 'google/gemini-2.5-flash-image';
}

export interface TracedModelCall {
  operation: 'chat' | 'image';
  modelId: string;
  prompt: { system?: string; user?: string; image?: string };
  providerSettings: Record<string, unknown>;
  contentManifest: TraceContentManifestEntry[];
}

type GenerationTraceStage = 'analyze' | 'assets' | 'designer' | 'hero';
export class StageTraceRecorder {
  private client: BackendClient;
  private generationId: string;
  private campaignId: string;
  private userId: string;
  private stage: GenerationTraceStage;
  private modelCalls: ModelCallTrace[] = [];
  private artifacts: GenerationTraceArtifact[] = [];
  private markedIncomplete = false;

  constructor(
    client: BackendClient,
    context: {
      generationId: string;
      campaignId: string;
      userId: string;
      stage: GenerationTraceStage;
    },
  ) {
    this.client = client;
    this.generationId = context.generationId;
    this.campaignId = context.campaignId;
    this.userId = context.userId;
    this.stage = context.stage;
  }

  async start(): Promise<void> {
    try {
      const { data, error } = await this.client.database
        .from('generation_stage_traces')
        .select('status, started_at, model_calls, artifacts')
        .eq('generation_id', this.generationId)
        .eq('campaign_id', this.campaignId)
        .eq('user_id', this.userId)
        .eq('stage', this.stage)
        .maybeSingle();
      if (error || !data) throw new Error(error?.message ?? 'Stage trace row is unavailable.');
      const row = data as Record<string, unknown>;
      this.modelCalls = Array.isArray(row.model_calls)
        ? row.model_calls as ModelCallTrace[]
        : [];
      this.artifacts = Array.isArray(row.artifacts)
        ? row.artifacts as GenerationTraceArtifact[]
        : [];
      await this.persist({
        status: 'running',
        started_at: typeof row.started_at === 'string' ? row.started_at : new Date().toISOString(),
      });
    } catch (error) {
      await this.markTraceIncomplete(error);
    }
  }

  async setImages(prepared: PreparedImageReferences): Promise<void> {
    await this.persist({
      candidate_images: prepared.candidateImages,
      attached_images: prepared.attachedImages,
      skipped_images: prepared.skippedImages,
    });
  }

  async addArtifact(artifact: GenerationTraceArtifact): Promise<void> {
    const sanitized = sanitizeTraceValue(artifact) as GenerationTraceArtifact;
    const existing = this.artifacts.findIndex((candidate) => candidate.kind === sanitized.kind);
    if (existing === -1) {
      this.artifacts.push(sanitized);
    } else {
      this.artifacts[existing] = sanitized;
    }
    await this.persist({ artifacts: this.artifacts });
  }

  async runModelCall<T>(
    request: TracedModelCall,
    execute: () => Promise<T>,
  ): Promise<T> {
    const attempt = this.modelCalls.reduce(
      (highest, call) => Math.max(highest, call.attempt),
      0,
    ) + 1;
    const call: ModelCallTrace = {
      attempt,
      operation: request.operation,
      provider: 'openrouter',
      model_id: request.modelId,
      status: 'running',
      started_at: new Date().toISOString(),
      completed_at: null,
      prompt: sanitizeTraceValue(request.prompt) as ModelCallTrace['prompt'],
      provider_settings: sanitizeTraceValue(request.providerSettings) as Record<string, unknown>,
      content_manifest: sanitizeTraceValue(request.contentManifest) as TraceContentManifestEntry[],
      failure: null,
    };
    this.modelCalls.push(call);
    await this.persist({ model_calls: this.modelCalls });

    try {
      const result = await execute();
      call.status = 'succeeded';
      call.completed_at = new Date().toISOString();
      await this.persist({ model_calls: this.modelCalls });
      return result;
    } catch (error) {
      call.status = 'failed';
      call.completed_at = new Date().toISOString();
      const details = errorDetails(error);
      call.failure = {
        ...details,
        message: traceSafeText(details.message).slice(0, 2000),
      };
      await this.persist({ model_calls: this.modelCalls });
      throw error;
    }
  }

  async succeed(metadata: Record<string, unknown> = {}): Promise<void> {
    await this.persist({
      status: 'succeeded',
      completed_at: new Date().toISOString(),
      failure_code: null,
      failure_message: null,
      failure_metadata: sanitizeTraceValue(metadata),
    });
  }

  async fail(
    error: unknown,
    code?: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const details = errorDetails(error);
    await this.persist({
      status: 'failed',
      completed_at: new Date().toISOString(),
      failure_code: code ?? details.code,
      failure_message: traceSafeText(details.message).slice(0, 2000),
      failure_metadata: sanitizeTraceValue({
        ...metadata,
        retryable: details.retryable,
        upstream_status: details.upstream_status,
      }),
    });
  }

  private async persist(patch: Record<string, unknown>): Promise<void> {
    try {
      const { error } = await this.client.database
        .from('generation_stage_traces')
        .update(patch)
        .eq('generation_id', this.generationId)
        .eq('campaign_id', this.campaignId)
        .eq('user_id', this.userId)
        .eq('stage', this.stage);
      if (error) throw new Error(error.message);
    } catch (error) {
      await this.markTraceIncomplete(error);
    }
  }

  private async markTraceIncomplete(error: unknown): Promise<void> {
    if (!this.markedIncomplete) {
      this.markedIncomplete = true;
      try {
        await this.client.database
          .from('poster_generations')
          .update({ trace_incomplete: true })
          .eq('id', this.generationId)
          .eq('campaign_id', this.campaignId)
          .eq('user_id', this.userId);
      } catch {
        // Trace capture is explicitly non-fatal to poster generation.
      }
    }
    console.warn(JSON.stringify({
      event: 'generation_trace_write_failed',
      generation_id: this.generationId,
      stage: this.stage,
      message: traceSafeText(error instanceof Error ? error.message : String(error)).slice(0, 500),
    }));
  }
}

function sanitizeTraceValue(value: unknown): unknown {
  if (typeof value === 'string') return traceSafeText(value);
  if (Array.isArray(value)) return value.map(sanitizeTraceValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/authorization|api[-_]?key|access[-_]?token/i.test(key))
      .map(([key, item]) => [key, sanitizeTraceValue(item)]),
  );
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
        model: resolvedChatModelId(),
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
  zones: PosterLayoutZone[]; // top→lower; artwork fills its frame (QR footer is outside it)
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
  posterSize?: PosterSize;
  parentPosterSize?: PosterSize | null;
}): string {
  const instruction = args.instruction?.trim().slice(0, 4000) ||
    'Create a refined next version without introducing gratuitous changes.';
  const posterSize = args.posterSize ?? DEFAULT_POSTER_SIZE;
  const formatChange = args.parentPosterSize &&
      args.parentPosterSize.slug !== posterSize.slug
    ? `FORMAT CHANGE: The target frame is ${getPosterFrameLabel(posterSize)}. Recompose the poster for this frame.`
    : '';

  if (!args.parentLayout && !args.hasPreviousPoster) {
    return [
      'VERSION CONTEXT: This is the first poster version.',
      `USER REQUEST: ${instruction}`,
      formatChange,
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
    formatChange,
    'PRESERVATION RULE: Keep every element, word, hierarchy choice, crop, color role, type treatment, texture, motif, spacing relationship, and composition decision that the user did not explicitly ask to change.',
    args.refreshWebsite
      ? 'WEBSITE REFRESH: Reconcile newly captured brand evidence only where it conflicts with stale brand facts; the requested delta and preservation rule still govern the edit.'
      : 'BRAND SNAPSHOT: Reuse the current version brand analysis; do not reinterpret the website or invent a new direction.',
    `PARENT LAYOUT JSON: ${layout}`,
  ].join('\n');
}

// Compile a PosterLayout into a text-to-image prompt. PURE + deterministic — the
// testable seam between the agentic layout and the image model. Reuses hero.ts's
// proven conventions: registered framing, brand-honoring, "render only these
// exact quoted strings", and an Avoid list. The artwork fills the complete frame
// and the SPA composites the QR footer OUTSIDE it on the output sheet.
export function compileLayoutPrompt(
  layout: PosterLayout,
  ctx: { product: string; essence: string; hasLogo?: boolean; hasStyleBoard?: boolean },
  posterSize: PosterSize = DEFAULT_POSTER_SIZE,
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
    ? 'A labeled STYLE BOARD image captured from the real source page is attached. Treat it as the primary brand-style evidence while preserving the painter priority described by each reference label.'
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

  return `Create a single ${getPosterFrameLabel(posterSize)} product-promotion poster. Custom art-directed layout (NOT a generic template).
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
  aspectRatio = DEFAULT_POSTER_SIZE.providerAspectRatio,
  referenceImages: Array<TypedImageReference | string> = [],
  ordering: 'source' | 'painter' | 'preserve' = 'painter',
): Promise<string> {
  const content = imageGenerationContent(prompt, referenceImages, 6, ordering);

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
        model: resolvedImageModelId(),
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
