import { CORS, env, visitorHash, readCookie, createAnonClient } from './_shared.ts';

// `convert` is the CTA handler. It logs a conversion attributed to the placement
// code + visitor cookie, then 302-redirects to the campaign's real destination.
// The conversion is logged BEFORE the redirect, so attribution never depends on
// the destination cooperating.
export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) return new Response('Missing code', { status: 400, headers: CORS });

  const client = createAnonClient();
  const visitorId = readCookie(req, 'plv') ?? '';
  const vhash = visitorId ? await visitorHash(env('VISITOR_SALT'), visitorId) : '';

  let destination: string | null = null;
  try {
    const { data, error } = await client.database.rpc('log_conversion', {
      p_code: code,
      p_visitor_hash: vhash,
    });
    if (!error && typeof data === 'string') destination = data;
  } catch {
    destination = null;
  }

  if (!destination) {
    return new Response('This link is no longer active.', {
      status: 404,
      headers: { ...CORS, 'Content-Type': 'text/plain' },
    });
  }

  return new Response(null, {
    status: 302,
    headers: { ...CORS, Location: destination, 'Cache-Control': 'no-store' },
  });
}
