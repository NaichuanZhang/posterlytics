import {
  CORS,
  decorateDestinationUrl,
  env,
  logRequestGeoEvent,
  parseUA,
  resolveRequestGeoDetailed,
  visitorHash,
  readCookie,
  createAnonClient,
  type RedirectAttribution,
} from './_shared.ts';

export type ViewLocale = 'en-US' | 'zh-CN';
export type LinkKind = 'invalid' | 'missing' | 'unpublished';

interface StatusPageCopy {
  title: string;
  heading: string;
  message: string;
}

interface ViewMessages {
  byline: string;
  recovery: string;
  invalid: StatusPageCopy;
  missing: StatusPageCopy;
  unpublished: StatusPageCopy;
}

const DEFAULT_VIEW_LOCALE: ViewLocale = 'en-US';
const VIEW_MESSAGES: Record<ViewLocale, ViewMessages> = {
  'en-US': {
    byline: 'via Posterlytics',
    recovery: 'Visit Posterlytics',
    invalid: {
      title: 'Invalid tracked link',
      heading: '400',
      message: 'This tracked link is missing its code.',
    },
    missing: {
      title: 'Link not found',
      heading: '404',
      message: "This link isn't active.",
    },
    unpublished: {
      title: "Poster isn't live yet",
      heading: 'Not live yet',
      message:
        "This poster's campaign hasn't been published. Once the owner publishes it, this link will work.",
    },
  },
  'zh-CN': {
    byline: '由 Posterlytics 提供',
    recovery: '前往 Posterlytics',
    invalid: {
      title: '追踪链接无效',
      heading: '400',
      message: '此追踪链接缺少识别码。',
    },
    missing: {
      title: '链接不存在',
      heading: '404',
      message: '此链接当前不可用。',
    },
    unpublished: {
      title: '海报尚未发布',
      heading: '尚未发布',
      message: '此海报所属的推广活动尚未发布。发布后，该链接即可访问。',
    },
  },
};

interface LanguagePreference {
  range: string;
  quality: number;
  index: number;
}

export function resolveViewLocale(acceptLanguage: string | null): ViewLocale {
  if (!acceptLanguage) return DEFAULT_VIEW_LOCALE;

  const preferences = acceptLanguage
    .split(',')
    .flatMap((part, index): LanguagePreference[] => {
      const [rawRange, ...parameters] = part.split(';');
      const range = rawRange.trim().toLowerCase();
      if (
        !range
        || !/^(?:\*|[a-z]{1,8}(?:-[a-z0-9]{1,8})*)$/.test(range)
      ) {
        return [];
      }

      let quality = 1;
      let qualitySeen = false;
      for (const rawParameter of parameters) {
        const parameter = rawParameter.trim();
        const qualityMatch = /^q\s*=\s*(.+)$/i.exec(parameter);
        if (!qualityMatch) {
          if (/^q\b/i.test(parameter)) return [];
          continue;
        }
        if (qualitySeen) return [];
        qualitySeen = true;
        const parsedQuality = parseLanguageQuality(qualityMatch[1]);
        if (parsedQuality === null) return [];
        quality = parsedQuality;
      }

      return quality > 0 ? [{ range, quality, index }] : [];
    })
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const preference of preferences) {
    if (
      preference.range === 'zh'
      || preference.range.startsWith('zh-')
    ) {
      return 'zh-CN';
    }
    if (
      preference.range === '*'
      || preference.range === 'en'
      || preference.range.startsWith('en-')
    ) {
      return 'en-US';
    }
  }
  return DEFAULT_VIEW_LOCALE;
}

function parseLanguageQuality(value: string): number | null {
  const normalized = value.trim();
  if (!/^(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/.test(normalized)) {
    return null;
  }
  return Number(normalized);
}

// `view` is the QR target — a pure tracked redirect. It:
//   1. resolves the placement by ?code=
//   2. ensures a first-party visitor cookie (plv)
//   3. logs one visit through the attributed visit RPC
//   4. adds non-destructive UTM attribution and 302s to the real destination
// A null result means the code is unknown OR the campaign isn't published;
// distinguish the two via link_status so we can explain rather than 404 blindly.
const ALLOWED_VIEW_METHODS = 'GET, HEAD, OPTIONS';

// The shared CORS block advertises POST for the JSON functions; this endpoint
// only reads, so narrow the advertised methods to match what it now accepts.
const VIEW_CORS = { ...CORS, 'Access-Control-Allow-Methods': ALLOWED_VIEW_METHODS };

interface ViewRuntime {
  createClient: typeof createAnonClient;
  getVisitorSalt: () => string;
  hashVisitor: typeof visitorHash;
  resolveGeo: typeof resolveRequestGeoDetailed;
  logGeo: typeof logRequestGeoEvent;
}

const VIEW_RUNTIME: ViewRuntime = {
  createClient: createAnonClient,
  getVisitorSalt: () => env('VISITOR_SALT'),
  hashVisitor: visitorHash,
  resolveGeo: resolveRequestGeoDetailed,
  logGeo: logRequestGeoEvent,
};

export default function (req: Request): Promise<Response> {
  return handleViewRequest(req, VIEW_RUNTIME);
}

export async function handleViewRequest(
  req: Request,
  runtime: ViewRuntime,
): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: VIEW_CORS });

  const url = new URL(req.url);
  const locale = resolveViewLocale(req.headers.get('accept-language'));

  // Only GET represents a person following a tracked link. HEAD is what link
  // checkers, chat-app unfurlers and security scanners issue against a pasted
  // URL — resolving it through log_visit counted those probes as real visits
  // (and, uncookied, inflated unique visitors). HEAD is answered from the
  // non-mutating link_status RPC; anything else is refused outright.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return methodNotAllowedResponse();
  }

  const code = url.searchParams.get('code');
  if (!code) return statusPageResponse('invalid', locale, 400);

  const client = runtime.createClient();

  if (req.method === 'HEAD') {
    return await headResponse(client, code, locale);
  }

  // First-party visitor identity (cookie). New cookie => set it on the response.
  let visitorId = readCookie(req, 'plv');
  let setCookie: string | null = null;
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    setCookie = `plv=${visitorId}; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly`;
  }
  const { device, os } = parseUA(req.headers.get('user-agent') ?? '');
  const [vhash, geoResolution] = await Promise.all([
    runtime.hashVisitor(runtime.getVisitorSalt(), visitorId),
    runtime.resolveGeo(req.headers),
  ]);
  const geo = geoResolution.geo;

  // Log the visit and get the destination plus attribution in one round-trip.
  // The published-check lives inside the RPC; a null/missing result means the
  // code is unknown or the campaign isn't live.
  let destination: string | null = null;
  let attribution: RedirectAttribution | null = null;
  try {
    const baseParams = {
      p_code: code,
      p_device: device,
      p_os: os,
      p_visitor_hash: vhash,
    };
    const geoParams = {
      ...baseParams,
      p_country: geo.country,
      p_city: geo.city,
    };
    let result = await client.database.rpc('log_visit_attributed', geoParams);
    // If the view deploy wins either migration rollout race, retry the current
    // text RPC with geo and then its original four-argument contract. Applying
    // the migration first is safe because that text contract remains available.
    if (result.error) {
      result = await client.database.rpc('log_visit', geoParams);
      if (result.error) result = await client.database.rpc('log_visit', baseParams);
    }
    if (!result.error) {
      const details = visitDetails(result.data);
      destination = details?.destination ?? null;
      attribution = details?.attribution ?? null;
    }
  } catch {
    destination = null;
  }

  if (!destination) return await statusResponse(client, code, locale, setCookie);

  try {
    runtime.logGeo({
      status: geo.country ? 'resolved' : 'unavailable',
      source: geoResolution.source,
      outcome: geoResolution.outcome,
      durationMs: geoResolution.durationMs,
      upstreamStatus: geoResolution.upstreamStatus,
    });
  } catch {
    // Observability is best-effort and must not block the redirect.
  }

  const location = attribution
    ? decorateDestinationUrl(destination, attribution)
    : destination;
  return redirect(location, setCookie);
}

function visitDetails(data: unknown): {
  destination: string;
  attribution: RedirectAttribution | null;
} | null {
  if (typeof data === 'string') {
    return { destination: data, attribution: null };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const record = data as Record<string, unknown>;
  if (typeof record.destination_url !== 'string') return null;
  const attribution =
    typeof record.campaign_name === 'string' && typeof record.placement_code === 'string'
      ? { campaign: record.campaign_name, placementCode: record.placement_code }
      : null;
  return { destination: record.destination_url, attribution };
}

function methodNotAllowedResponse(): Response {
  return new Response(null, {
    status: 405,
    headers: new Headers({ ...VIEW_CORS, Allow: ALLOWED_VIEW_METHODS, 'Cache-Control': 'no-store' }),
  });
}

/**
 * Answers HEAD without recording a visit.
 *
 * `link_status` is STABLE and anon-executable, so it reports whether a code is
 * live without touching `scans`. HEAD carries no body by definition, so the
 * status code alone conveys the outcome — and deliberately no `Location`, since
 * emitting one would let an unfurler follow through to the destination and make
 * the probe indistinguishable from a real visit downstream.
 */
async function headResponse(
  client: ReturnType<typeof createAnonClient>,
  code: string,
  locale: ViewLocale,
): Promise<Response> {
  let kind: LinkKind = 'missing';
  try {
    const { data } = await client.database.rpc('link_status', { p_code: code });
    if (data === 'published') kind = 'published';
    else if (data === 'unpublished') kind = 'unpublished';
  } catch {
    kind = 'missing';
  }
  const headers = new Headers({
    ...VIEW_CORS,
    Allow: ALLOWED_VIEW_METHODS,
    'Cache-Control': 'no-store',
    'Content-Language': locale,
  });
  // 200 for a resolvable link (live or not-yet-live), 404 for an unknown code —
  // matching what the equivalent GET would report, minus the visit.
  return new Response(null, { status: kind === 'missing' ? 404 : 200, headers });
}

function redirect(location: string, setCookie?: string | null): Response {
  const headers = new Headers({ ...CORS, Location: location, 'Cache-Control': 'no-store' });
  if (setCookie) headers.append('Set-Cookie', setCookie);
  return new Response(null, { status: 302, headers });
}

function statusPageResponse(
  kind: LinkKind,
  locale: ViewLocale,
  status = 200,
  setCookie?: string | null,
): Response {
  const headers = new Headers({
    ...CORS,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Language': locale,
    'Cache-Control': 'no-store',
    Vary: 'Accept-Language',
  });
  if (setCookie) headers.append('Set-Cookie', setCookie);
  return new Response(statusHtml(kind, locale), { status, headers });
}

// Resolve whether a code is unknown ('missing') or just not published yet
// ('unpublished') and return the matching page. 'unpublished' is a real,
// owned link that simply isn't live — explain it (200) rather than 404.
async function statusResponse(
  client: ReturnType<typeof createAnonClient>,
  code: string,
  locale: ViewLocale,
  setCookie?: string | null,
): Promise<Response> {
  let kind: LinkKind = 'missing';
  try {
    const { data } = await client.database.rpc('link_status', { p_code: code });
    if (data === 'unpublished' || data === 'published') kind = 'unpublished';
  } catch {
    kind = 'missing';
  }
  // 'published' shouldn't reach here (log_visit would have succeeded), but if it
  // does, it's a transient hiccup — treat as not-live rather than not-found.
  return statusPageResponse(
    kind,
    locale,
    kind === 'missing' ? 404 : 200,
    setCookie,
  );
}

export function statusHtml(kind: LinkKind, locale: ViewLocale): string {
  const messages = VIEW_MESSAGES[locale];
  const copy = messages[kind];
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${copy.title}</title></head><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#444;background:#faf7f1"><div style="text-align:center;max-width:340px;padding:24px"><h1 style="font-size:2.4rem;margin:0 0 8px">${copy.heading}</h1><p style="line-height:1.5">${copy.message}</p><a href="https://3f9q2998.insforge.site/" style="display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:11px 16px;box-sizing:border-box;margin-top:12px;color:#3d5f56;font-weight:650">${messages.recovery}</a><p style="font-size:.78rem;color:#5b5b5b;margin-top:18px">${messages.byline}</p></div></body></html>`;
}
