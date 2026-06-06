import { CORS, createAnonClient, jsonResponse } from './_shared.ts';

// `scan-geo` receives the browser-side geo beacon (the browser sees its own real
// IP; the functions edge strips it). It fills country/city on a just-created
// scan via the set_scan_geo RPC (idempotent — only writes when geo is null).
export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResponse({ error: 'method' }, 405);

  let payload: { scan_id?: string; country?: string; city?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'bad json' }, 400);
  }
  if (!payload.scan_id) return jsonResponse({ error: 'missing scan_id' }, 400);

  const client = createAnonClient();
  try {
    const { data, error } = await client.database.rpc('set_scan_geo', {
      p_scan_id: payload.scan_id,
      p_country: payload.country ?? null,
      p_city: payload.city ?? null,
    });
    if (error) return jsonResponse({ ok: false, error: error.message }, 200);
    return jsonResponse({ ok: !!data });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 200);
  }
}
