import {
  CORS,
  jsonResponse,
  extractEventDetails,
  formatEventLines,
  isLumaHost,
  fetchLumaHtml,
} from './_shared.ts';

// `event-preview` — a tiny ANON helper for the campaign wizard. Given a Luma
// event URL it fetches the (public, server-rendered) page and returns the
// deterministically-parsed event name + logistics lines, so the wizard can
// PRE-FILL "Event name" and surface the detected date/time/location for
// confirmation BEFORE the campaign row is created. This closes the gap where the
// event fields are marked source:'scrape' but nothing populated them until the
// later `analyze` run (see src/scenarios/event.ts).
//
// It reuses the SAME pure parsers as `analyze` (extractEventDetails +
// formatEventLines from _shared.ts) so the preview and the real analyze agree.
// No DB access, no auth needed — it's a read-only parse of a public page.
//
// SECURITY (SSRF): the function fetches a caller-supplied URL server-side, so it
// STRICTLY allowlists Luma hosts only. Any other host is rejected — never a
// blind proxy for arbitrary URLs.
export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResponse({ error: 'method' }, 405);

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad json' }, 400);
  }
  const raw = (body.url ?? '').trim();
  if (!raw) return jsonResponse({ error: 'missing url' }, 400);

  // Parse + SSRF-guard the URL: only https Luma hosts are ever fetched.
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return jsonResponse({ error: 'invalid url' }, 400);
  }
  if (target.protocol !== 'https:' || !isLumaHost(target.hostname)) {
    return jsonResponse({ error: 'unsupported host' }, 422);
  }

  // Fetch the event page (SSRF-safe, bounded — see fetchLumaHtml). Any failure
  // yields '' → an empty preview, and the client silently falls back to manual
  // entry — never a hard error.
  const html = await fetchLumaHtml(target);

  const ev = extractEventDetails(html);
  const lines = formatEventLines(ev);

  // `found` = we parsed at least a name (so the client knows whether to pre-fill).
  return jsonResponse({
    found: !!ev.event_name,
    event_name: ev.event_name ?? '',
    date_line: lines.date_line,
    time_line: lines.time_line,
    location_line: lines.location_line,
    host_line: lines.host_line,
    price_label: ev.price_label ?? '',
  });
}
