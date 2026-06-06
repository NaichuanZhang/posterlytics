import {
  CORS,
  env,
  parseUA,
  visitorHash,
  readCookie,
  createAnonClient,
} from './_shared.ts';

// `view` is the QR target. It:
//   1. resolves the placement by ?code=
//   2. ensures a first-party visitor cookie (plv)
//   3. logs the scan (device/os from UA, salted visitor hash) via log_scan RPC
//   4. returns the rich, on-brand landing HTML (the full product story)
// The CTA links to /convert?code=... ; a tiny inline script fires a browser-side
// geo beacon to /scan-geo (the browser sees its own IP; the edge strips it).
export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) return html(notFoundHtml(), 400);

  const baseUrl = env('INSFORGE_BASE_URL');
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

  // Log the scan (published-check inside the RPC). Returns { scan_id, is_unique }.
  let scanId: string | null = null;
  try {
    const { data, error } = await client.database.rpc('log_scan', {
      p_code: code,
      p_device: device,
      p_os: os,
      p_visitor_hash: vhash,
    });
    if (error || !data) return html(notFoundHtml(), 404);
    scanId = (data as { scan_id?: string }).scan_id ?? null;
  } catch {
    return html(notFoundHtml(), 404);
  }

  // Fetch the campaign content for this code (anon RLS: published only).
  const { data: row, error: selErr } = await client.database
    .from('placements')
    .select(
      'code, campaigns(product_name, tagline, cta_text, style_profile, poster_copy, landing_content, brand_assets, hero_image_url)',
    )
    .eq('code', code)
    .maybeSingle();

  if (selErr || !row || !(row as Record<string, unknown>).campaigns) {
    return html(notFoundHtml(), 404);
  }

  const campaign = (row as { campaigns: CampaignContent }).campaigns;
  const body = landingHtml(campaign, code, scanId, baseUrl);
  return html(body, 200, setCookie);
}

interface CampaignContent {
  product_name: string;
  tagline: string | null;
  cta_text: string;
  style_profile: StyleProfile | null;
  poster_copy: unknown;
  landing_content: LandingContent | null;
  brand_assets: BrandAssets | null;
  hero_image_url: string | null;
}
interface StyleProfile {
  palette?: { primary?: string; bg?: string; text?: string; accent?: string };
  fonts?: { heading?: string; body?: string };
  tone?: string;
}
interface LandingContent {
  headline?: string;
  what_it_does?: string;
  how_it_works?: string[];
  why_use_it?: string[];
  features?: string[];
  cta?: string;
}
interface BrandAssets {
  logo_url?: string;
  images?: Array<{ url: string }>;
  primary_image_url?: string;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function notFoundHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title></head><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#444"><div style="text-align:center"><h1 style="font-size:3rem;margin:0">404</h1><p>This link isn't active.</p></div></body></html>`;
}

function landingHtml(
  c: CampaignContent,
  code: string,
  scanId: string | null,
  baseUrl: string,
): string {
  const sp = c.style_profile ?? {};
  const lc = c.landing_content ?? {};
  const ba = c.brand_assets ?? {};
  const primary = sp.palette?.primary || '#4f46e5';
  const bg = sp.palette?.bg || '#ffffff';
  const text = sp.palette?.text || '#111827';
  const accent = sp.palette?.accent || primary;
  const headingFont = sp.fonts?.heading || 'system-ui, sans-serif';
  const bodyFont = sp.fonts?.body || 'system-ui, sans-serif';
  const hero = ba.primary_image_url || ba.images?.[0]?.url || c.hero_image_url || '';
  const logo = ba.logo_url || '';
  const headline = lc.headline || c.product_name;
  const what = lc.what_it_does || c.tagline || '';
  const ctaText = lc.cta || c.cta_text || 'Learn more';
  // convert/scan-geo are sibling functions on the same functions host
  const fnHost = `https://${new URL(baseUrl).host.split('.')[0]}.functions.insforge.app`;

  const features = (lc.features ?? []).map((f) => `<li>${esc(f)}</li>`).join('');
  const how = (lc.how_it_works ?? [])
    .map((s, i) => `<li><span class="step">${i + 1}</span><span>${esc(s)}</span></li>`)
    .join('');
  const why = (lc.why_use_it ?? []).map((w) => `<li>${esc(w)}</li>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.product_name)}</title>
<style>
  :root{--primary:${esc(primary)};--bg:${esc(bg)};--text:${esc(text)};--accent:${esc(accent)};}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:${esc(bodyFont)};color:var(--text);background:var(--bg);line-height:1.5}
  .wrap{max-width:680px;margin:0 auto;padding:0 20px 80px}
  header{display:flex;align-items:center;gap:10px;padding:20px 0}
  header img{height:34px;width:auto;border-radius:6px}
  header .name{font-weight:700;font-family:${esc(headingFont)}}
  .hero{width:100%;aspect-ratio:4/5;max-height:520px;object-fit:cover;border-radius:18px;background:#f1f1f1;margin-top:6px}
  h1{font-family:${esc(headingFont)};font-size:2rem;line-height:1.15;margin:28px 0 10px}
  .lede{font-size:1.15rem;color:var(--text);opacity:.85;margin-bottom:8px}
  section{margin-top:36px}
  section h2{font-family:${esc(headingFont)};font-size:1.1rem;text-transform:uppercase;letter-spacing:.04em;color:var(--primary);margin-bottom:14px}
  ul{list-style:none}
  .features li,.why li{padding:10px 0 10px 28px;position:relative;border-bottom:1px solid rgba(0,0,0,.06)}
  .features li::before,.why li::before{content:"✓";position:absolute;left:0;color:var(--accent);font-weight:700}
  .how li{display:flex;gap:12px;align-items:flex-start;padding:10px 0}
  .how .step{flex:0 0 26px;height:26px;border-radius:50%;background:var(--primary);color:#fff;display:grid;place-items:center;font-size:.85rem;font-weight:700}
  .cta-bar{margin-top:44px;padding-top:8px}
  .cta{display:block;text-align:center;background:var(--primary);color:#fff;text-decoration:none;font-weight:700;font-family:${esc(headingFont)};padding:16px;border-radius:14px;font-size:1.1rem;box-shadow:0 8px 24px rgba(0,0,0,.16)}
  .cta-sticky{position:sticky;bottom:14px;margin-top:44px;z-index:5}
  .pl{font-size:.78rem;color:var(--text);opacity:.4;text-align:center;margin-top:10px}
</style>
</head>
<body>
<div class="wrap">
  <header>
    ${logo ? `<img src="${esc(logo)}" alt="${esc(c.product_name)} logo" crossorigin="anonymous">` : ''}
    <span class="name">${esc(c.product_name)}</span>
  </header>

  ${hero ? `<img class="hero" src="${esc(hero)}" alt="${esc(c.product_name)}" crossorigin="anonymous">` : ''}

  <h1>${esc(headline)}</h1>
  ${what ? `<p class="lede">${esc(what)}</p>` : ''}

  ${features ? `<section><h2>Features</h2><ul class="features">${features}</ul></section>` : ''}
  ${how ? `<section><h2>How it works</h2><ul class="how">${how}</ul></section>` : ''}
  ${why ? `<section><h2>Why use it</h2><ul class="why">${why}</ul></section>` : ''}

  <div class="cta-bar">
    <a class="cta" href="${fnHost}/convert?code=${encodeURIComponent(code)}">${esc(ctaText)}</a>
    <div class="pl">via Posterlytics</div>
  </div>
</div>
<script>
(function(){
  ${scanId ? `var scanId=${JSON.stringify(scanId)};` : 'var scanId=null;'}
  if(!scanId) return;
  // Browser-side geo beacon: the browser sees its real IP; the edge does not.
  fetch('https://ipapi.co/json/').then(function(r){return r.json()}).then(function(g){
    if(!g||!g.country) return;
    fetch(${JSON.stringify(fnHost)}+'/scan-geo',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({scan_id:scanId,country:g.country_name||g.country,city:g.city||null})
    }).catch(function(){});
  }).catch(function(){});
})();
</script>
</body>
</html>`;
}
