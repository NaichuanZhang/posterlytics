import {
  CORS,
  env,
  parseUA,
  visitorHash,
  readCookie,
  createAnonClient,
} from './_shared.ts';

// `view` is the QR target — a pure tracked redirect. It:
//   1. resolves the placement by ?code=
//   2. ensures a first-party visitor cookie (plv)
//   3. logs one visit through the log_visit RPC
//   4. 302s straight to the campaign's real destination URL
// A null result means the code is unknown OR the campaign isn't published;
// distinguish the two via link_status so we can explain rather than 404 blindly.
export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) return html(statusHtml('missing'), 400);

  const client = createAnonClient();

  // First-party visitor identity (cookie). New cookie => set it on the response.
  let visitorId = readCookie(req, 'plv');
  let setCookie: string | null = null;
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    setCookie = `plv=${visitorId}; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly`;
  }
  const vhash = await visitorHash(env('VISITOR_SALT'), visitorId);
  const { device, os } = parseUA(req.headers.get('user-agent') ?? '');

  // Log the visit and get the destination in one round-trip. The
  // published-check lives inside the RPC; a null/missing result means the code is
  // unknown or the campaign isn't live.
  let destination: string | null = null;
  try {
    const { data, error } = await client.database.rpc('log_visit', {
      p_code: code,
      p_device: device,
      p_os: os,
      p_visitor_hash: vhash,
    });
    if (!error && typeof data === 'string') destination = data;
  } catch {
    destination = null;
  }

  if (!destination) return await statusResponse(client, code, setCookie);

  return redirect(destination, setCookie);
}

function redirect(location: string, setCookie?: string | null): Response {
  const headers = new Headers({ ...CORS, Location: location, 'Cache-Control': 'no-store' });
  if (setCookie) headers.append('Set-Cookie', setCookie);
  return new Response(null, { status: 302, headers });
}

function html(body: string, status = 200, setCookie?: string | null): Response {
  const headers = new Headers({
    ...CORS,
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  if (setCookie) headers.append('Set-Cookie', setCookie);
  return new Response(body, { status, headers });
}

type LinkKind = 'missing' | 'unpublished';

// Resolve whether a code is unknown ('missing') or just not published yet
// ('unpublished') and return the matching page. 'unpublished' is a real,
// owned link that simply isn't live — explain it (200) rather than 404.
async function statusResponse(
  client: ReturnType<typeof createAnonClient>,
  code: string,
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
  return html(statusHtml(kind), kind === 'missing' ? 404 : 200, setCookie);
}

function statusHtml(kind: LinkKind): string {
  const title = kind === 'unpublished' ? "Poster isn't live yet" : 'Link not found';
  const heading = kind === 'unpublished' ? 'Not live yet' : '404';
  const message =
    kind === 'unpublished'
      ? "This poster's campaign hasn't been published. Once the owner publishes it, this link will work."
      : "This link isn't active.";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#444;background:#faf7f1"><div style="text-align:center;max-width:340px;padding:24px"><h1 style="font-size:2.4rem;margin:0 0 8px">${heading}</h1><p style="line-height:1.5">${message}</p><p style="font-size:.78rem;opacity:.4;margin-top:18px">via Posterlytics</p></div></body></html>`;
}
