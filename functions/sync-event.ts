import {
  CORS,
  jsonResponse,
  createUserClient,
  extractEventDetails,
  formatEventLines,
  isLumaHost,
  fetchLumaHtml,
  logTrace,
  type EventDetails,
} from './_shared.ts';

// `sync-event` — refresh a live Luma event campaign in place. Event managers edit
// a Luma event after the poster is made (title, date/time, location, host); a
// Posterlytics event campaign is otherwise a one-time snapshot (scraped once by
// `analyze` at creation). This re-scrapes the live page and updates the campaign,
// keeping printed/exported posters accurate.
//
// TOKEN-EFFICIENT BY DESIGN — no LLM/image tokens here:
//   • Re-scrape + extractEventDetails/formatEventLines are PURE (zero tokens).
//   • date/time/location/host render as LIVE composited text in AiPoster from the
//     poster_spec logistics lines, so persisting the new lines makes the preview +
//     PNG export reflect changes after the client's reload() — ZERO regeneration.
//   • Only the event TITLE is baked into the hero image (hero.ts buildEventPrompt),
//     so a re-paint is needed ONLY when the title changed — the client re-invokes
//     `hero` in that case (see the returned titleChanged flag).
//
// Persists only the fields that actually changed (minimal mutation). Returns
// { changed: string[], titleChanged: boolean } so the client can report what moved
// and decide whether to re-paint. Auth-scoped (owner RLS via the bearer token).
export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResponse({ error: 'method' }, 405);

  const client = createUserClient(req);
  const { data: userData } = await client.auth.getCurrentUser();
  if (!userData?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401);
  const userId = userData.user.id;

  let body: { campaignId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad json' }, 400);
  }
  if (!body.campaignId) return jsonResponse({ error: 'missing campaignId' }, 400);

  const { data: campaign, error: cErr } = await client.database
    .from('campaigns')
    .select('id, product_url, product_name, scenario, event_details, poster_spec')
    .eq('id', body.campaignId)
    .maybeSingle();
  if (cErr || !campaign) return jsonResponse({ error: 'campaign not found' }, 404);

  const c = campaign as Record<string, unknown>;
  if (c.scenario !== 'event') {
    return jsonResponse({ error: 'not an event campaign' }, 422);
  }

  // SSRF guard: only ever fetch a Luma https URL (the stored product_url should be
  // one, but validate defensively — never a blind server-side fetch).
  const productUrl = String(c.product_url ?? '');
  let target: URL;
  try {
    target = new URL(productUrl);
  } catch {
    return jsonResponse({ error: 'invalid event url' }, 422);
  }
  if (target.protocol !== 'https:' || !isLumaHost(target.hostname)) {
    return jsonResponse({ error: 'unsupported event url' }, 422);
  }

  // Re-fetch the live Luma page (SSRF-safe, bounded — see fetchLumaHtml).
  const html = await fetchLumaHtml(target);

  const fresh = extractEventDetails(html);
  // If the scrape yielded nothing at all (blocked/removed/empty), don't wipe the
  // stored snapshot — report no changes and let the user retry.
  if (!fresh.event_name && !fresh.starts_at && !fresh.location_name && !fresh.location_city && !fresh.host_name) {
    await logTrace(client, {
      campaignId: String(c.id), userId, step: 'analyze', status: 'degraded',
      detail: 'sync-event: re-scrape returned no usable event_details — kept the existing snapshot',
      request: { url: productUrl },
    });
    return jsonResponse({ changed: [], titleChanged: false, note: 'no-scrape' });
  }

  const stored = (c.event_details ?? {}) as EventDetails;
  // Preserve fields the fresh scrape didn't provide (e.g. a cover image re-hosted
  // earlier, or a host logo) by merging fresh over stored — fresh wins per-field.
  const merged: EventDetails = { ...stored, ...pruneUndefined(fresh) };

  const freshLines = formatEventLines(merged);
  const storedSpec = (c.poster_spec ?? {}) as Record<string, unknown>;

  // Diff: which human-facing facts moved? Compare the rendered lines (what the
  // poster actually shows) plus the title.
  const changed: string[] = [];
  const priceLine = merged.price_label ?? '';
  const nextSpec: Record<string, unknown> = { ...storedSpec };

  const title = merged.event_name || String(c.product_name ?? '') || 'Event';
  const titleChanged = String(storedSpec.title ?? '') !== title;
  if (titleChanged) { changed.push('title'); nextSpec.title = title; }

  const lineFields: Array<{ key: keyof typeof freshLines | 'price_line'; label: string; value: string }> = [
    { key: 'date_line', label: 'date', value: freshLines.date_line },
    { key: 'time_line', label: 'time', value: freshLines.time_line },
    { key: 'location_line', label: 'location', value: freshLines.location_line },
    { key: 'host_line', label: 'host', value: freshLines.host_line },
    { key: 'price_line', label: 'price', value: priceLine },
  ];
  for (const f of lineFields) {
    const prev = String(storedSpec[f.key] ?? '');
    if (prev !== f.value) {
      changed.push(f.label);
      // Empty price clears the optional line; the rest are always set.
      if (f.key === 'price_line' && !f.value) delete nextSpec.price_line;
      else nextSpec[f.key] = f.value;
    }
  }

  // Also detect a change in the stored event_details as a whole (so a field that
  // doesn't surface in a line — e.g. tz_offset, register_url — still persists).
  const detailsChanged = JSON.stringify(stored) !== JSON.stringify(merged);

  if (changed.length === 0 && !detailsChanged) {
    return jsonResponse({ changed: [], titleChanged: false });
  }

  // Persist only what moved: refreshed event_details + poster_spec logistics.
  const update: Record<string, unknown> = { event_details: merged };
  if (changed.length > 0) update.poster_spec = nextSpec;

  const { error: upErr } = await client.database
    .from('campaigns')
    .update(update)
    .eq('id', c.id);
  if (upErr) {
    await logTrace(client, {
      campaignId: String(c.id), userId, step: 'analyze', status: 'failed',
      detail: 'sync-event: campaign persist failed',
      response: { error: upErr.message },
    });
    return jsonResponse({ error: upErr.message }, 500);
  }

  return jsonResponse({ changed, titleChanged });
}

// Drop undefined-valued keys so a spread merge doesn't clobber stored values with
// undefined (extractEventDetails leaves absent fields undefined).
function pruneUndefined(o: EventDetails): EventDetails {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) out[k] = v;
  }
  return out as EventDetails;
}
