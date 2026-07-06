import {
  CORS,
  jsonResponse,
  extractEventDetails,
  formatEventLines,
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

  // Fetch the event page (5s budget). Any failure degrades to an empty preview
  // so the client silently falls back to manual entry — never a hard error.
  //
  // SSRF hardening: we handle redirects MANUALLY rather than 'follow', because a
  // Luma open-redirect (or any 3xx) could otherwise bounce the server-side fetch
  // to an internal/arbitrary host after the initial allowlist check passed. We
  // re-validate every hop's Location against the same Luma allowlist and cap the
  // number of hops.
  let html = '';
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 5000);
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
      // A redirect: validate the next hop against the allowlist before following.
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location');
        if (!loc) break;
        let next: URL;
        try {
          next = new URL(loc, current);
        } catch {
          break;
        }
        if (next.protocol !== 'https:' || !isLumaHost(next.hostname)) break; // refuse off-allowlist redirect
        current = next;
        hops++;
        continue;
      }
      if (r.ok) html = await readCapped(r, MAX_HTML_BYTES);
      break;
    }
  } catch {
    html = '';
  } finally {
    clearTimeout(to);
  }

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

// Cap the HTML we read so an unexpectedly huge (or hostile) allowed page can't
// exhaust edge memory/time. The event JSON-LD + OG tags live in the <head>, well
// within this bound. 2 MiB is generous for a Luma page.
const MAX_HTML_BYTES = 2_000_000;

// Read a response body up to `maxBytes`, then stop. Skips non-HTML bodies (we
// only parse markup). Returns '' on a non-HTML content-type or read failure.
async function readCapped(r: Response, maxBytes: number): Promise<string> {
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  if (ct && !ct.includes('html') && !ct.includes('text')) return '';
  const reader = r.body?.getReader();
  if (!reader) {
    // No stream — fall back to a bounded text read.
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

// Allowlist: luma.com / lu.ma and their subdomains only. Case-insensitive.
function isLumaHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'luma.com' ||
    h === 'lu.ma' ||
    h.endsWith('.luma.com') ||
    h.endsWith('.lu.ma')
  );
}
