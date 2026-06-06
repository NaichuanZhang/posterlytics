import {
  CORS,
  env,
  aiChat,
  extractJson,
  jsonResponse,
  createUserClient,
} from './_shared.ts';

// `analyze` is the Poster Agent core. Authenticated. For a campaign it:
//   1. scrapes the product site (HTML)
//   2. extracts REAL brand assets — logo, og:image, product images, theme color
//      — and re-hosts them in the public `assets` bucket (CORS-clean, durable)
//   3. asks gpt-4o for poster_copy (scannable) + landing_content (full story) +
//      style_profile (palette/fonts/tone), as strict JSON
//   4. writes it all back to the campaign row
export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResponse({ error: 'method' }, 405);

  const baseUrl = env('INSFORGE_BASE_URL');
  const apiKey = env('API_KEY');
  const client = createUserClient(req);

  const { data: userData } = await client.auth.getCurrentUser();
  if (!userData?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: { campaignId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad json' }, 400);
  }
  if (!body.campaignId) return jsonResponse({ error: 'missing campaignId' }, 400);

  // Load the campaign (owner RLS guarantees it's the caller's).
  const { data: campaign, error: cErr } = await client.database
    .from('campaigns')
    .select('id, product_url, product_name, tagline, cta_text')
    .eq('id', body.campaignId)
    .maybeSingle();
  if (cErr || !campaign) return jsonResponse({ error: 'campaign not found' }, 404);

  await client.database.from('campaigns').update({ status: 'analyzing' }).eq('id', campaign.id);

  const productUrl: string = (campaign as Record<string, string>).product_url;

  // 1. Scrape the site (5s budget).
  let scrapeHtml = '';
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(productUrl, {
      signal: ctl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      },
    });
    clearTimeout(to);
    if (r.ok) scrapeHtml = await r.text();
  } catch {
    scrapeHtml = '';
  }

  // 2. Extract real assets + meta from the HTML.
  const assets = extractAssets(scrapeHtml, productUrl);

  // Re-host logo + up to 2 product images into the public assets bucket so the
  // poster/landing never hot-link the origin (CORS-clean export, survives churn).
  const brand_assets: {
    logo_url?: string;
    logo_key?: string;
    images: Array<{ url: string; key: string }>;
    primary_image_url?: string;
    theme_color?: string;
  } = { images: [] };

  if (assets.logo) {
    const up = await rehost(client, assets.logo, `brand/${campaign.id}/logo`);
    if (up) {
      brand_assets.logo_url = up.url;
      brand_assets.logo_key = up.key;
    }
  }
  for (const imgUrl of assets.images.slice(0, 2)) {
    const up = await rehost(client, imgUrl, `brand/${campaign.id}/img-${crypto.randomUUID().slice(0, 8)}`);
    if (up) brand_assets.images.push({ url: up.url, key: up.key });
  }
  brand_assets.primary_image_url = brand_assets.images[0]?.url;
  brand_assets.theme_color = assets.themeColor;

  // 3. gpt-4o → poster_copy + landing_content + style_profile (strict JSON).
  const visibleText = stripToText(scrapeHtml).slice(0, 8000);
  const sys =
    'You are a senior product marketer and brand designer. Given a product website and its GTM inputs, ' +
    'produce advertising copy and a faithful style profile. Output STRICT JSON only — no prose, no code fences. ' +
    'Schema: {"style_profile":{"palette":{"primary":"#hex","bg":"#hex","text":"#hex","accent":"#hex"},' +
    '"fonts":{"heading":"CSS font family","body":"CSS font family"},"tone":"2-4 words","layout_hint":"one phrase"},' +
    '"poster_copy":{"hook":"<=6 word punchy headline","what_it_does":"one sentence","features":["3 short benefit phrases"],"cta":"<=3 words"},' +
    '"landing_content":{"headline":"compelling headline","what_it_does":"1-2 sentences","how_it_works":["3-4 short steps"],' +
    '"why_use_it":["3 short reasons"],"features":["4-6 concise feature lines"],"cta":"button text"}}. ' +
    'Match the brand\'s real palette/fonts/tone when discernible from the page; otherwise infer tasteful defaults. ' +
    `If a theme color was detected, prefer it as the primary: ${assets.themeColor || 'none'}.`;
  const user =
    `PRODUCT NAME: ${campaign.product_name}\n` +
    `TAGLINE (optional): ${(campaign as Record<string, string>).tagline ?? ''}\n` +
    `CTA HINT: ${(campaign as Record<string, string>).cta_text ?? ''}\n` +
    `PRODUCT URL: ${productUrl}\n\n` +
    `WEBSITE TEXT (truncated):\n${visibleText || '(scrape failed — rely on the inputs above)'}`;

  let parsed: ParsedContent;
  try {
    const raw = await aiChat(baseUrl, apiKey, [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ], { maxTokens: 1400 });
    parsed = normalize(extractJson(raw), campaign as Record<string, string>);
  } catch {
    // One repair retry with a terse reminder.
    try {
      const raw2 = await aiChat(baseUrl, apiKey, [
        { role: 'system', content: sys + ' Return ONLY valid minified JSON.' },
        { role: 'user', content: user },
      ], { maxTokens: 1400 });
      parsed = normalize(extractJson(raw2), campaign as Record<string, string>);
    } catch {
      parsed = fallbackContent(campaign as Record<string, string>);
    }
  }

  // 4. Persist.
  const { error: upErr } = await client.database
    .from('campaigns')
    .update({
      style_profile: parsed.style_profile,
      poster_copy: parsed.poster_copy,
      landing_content: parsed.landing_content,
      brand_assets,
      status: 'draft',
    })
    .eq('id', campaign.id);
  if (upErr) return jsonResponse({ error: upErr.message }, 500);

  return jsonResponse({
    style_profile: parsed.style_profile,
    poster_copy: parsed.poster_copy,
    landing_content: parsed.landing_content,
    brand_assets,
    needs_hero: brand_assets.images.length === 0,
  });
}

interface ParsedContent {
  style_profile: unknown;
  poster_copy: unknown;
  landing_content: unknown;
}

// --- helpers -------------------------------------------------------------

function abs(url: string, base: string): string | null {
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

function extractAssets(htmlText: string, base: string): {
  logo: string | null;
  images: string[];
  themeColor: string | null;
} {
  if (!htmlText) return { logo: null, images: [], themeColor: null };
  const images: string[] = [];

  const og =
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(htmlText)?.[1] ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(htmlText)?.[1];
  if (og) {
    const a = abs(og, base);
    if (a) images.push(a);
  }

  const twitter = /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i.exec(htmlText)?.[1];
  if (twitter) {
    const a = abs(twitter, base);
    if (a && !images.includes(a)) images.push(a);
  }

  // A few <img> sources that look like product/hero shots.
  const imgRe = /<img[^>]+src=["']([^"']+\.(?:png|jpe?g|webp)(?:\?[^"']*)?)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(htmlText)) && images.length < 6) {
    const a = abs(m[1], base);
    if (a && !/sprite|icon|pixel|tracking|1x1|logo/i.test(a) && !images.includes(a)) images.push(a);
  }

  // Logo: explicit logo-ish img, else apple-touch-icon, else favicon.
  let logo: string | null = null;
  const logoImg = /<img[^>]+(?:class|alt|src)=["'][^"']*logo[^"']*["'][^>]*>/i.exec(htmlText)?.[0];
  if (logoImg) {
    const src = /src=["']([^"']+)["']/i.exec(logoImg)?.[1];
    if (src) logo = abs(src, base);
  }
  if (!logo) {
    const touch = /<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i.exec(htmlText)?.[1];
    if (touch) logo = abs(touch, base);
  }
  if (!logo) {
    const icon = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i.exec(htmlText)?.[1];
    if (icon) logo = abs(icon, base);
  }

  const themeColor =
    /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i.exec(htmlText)?.[1] || null;

  return { logo, images, themeColor };
}

function stripToText(htmlText: string): string {
  return htmlText
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function rehost(
  client: ReturnType<typeof createUserClient>,
  srcUrl: string,
  keyBase: string,
): Promise<{ url: string; key: string } | null> {
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(srcUrl, { signal: ctl.signal });
    clearTimeout(to);
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!/image\//.test(ct)) return null;
    const blob = await r.blob();
    if (blob.size === 0 || blob.size > 5_000_000) return null;
    const ext = ct.includes('png') ? 'png' : ct.includes('svg') ? 'svg' : ct.includes('webp') ? 'webp' : 'jpg';
    const { data, error } = await client.storage.from('assets').upload(`${keyBase}.${ext}`, blob);
    if (error || !data) return null;
    return { url: data.url, key: data.key };
  } catch {
    return null;
  }
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v];
  return [];
}

function normalize(raw: unknown, c: Record<string, string>): ParsedContent {
  const o = (raw ?? {}) as Record<string, Record<string, unknown>>;
  const sp = o.style_profile ?? {};
  const pc = o.poster_copy ?? {};
  const lc = o.landing_content ?? {};
  return {
    style_profile: {
      palette: {
        primary: (sp.palette as Record<string, string>)?.primary ?? '#4f46e5',
        bg: (sp.palette as Record<string, string>)?.bg ?? '#ffffff',
        text: (sp.palette as Record<string, string>)?.text ?? '#111827',
        accent: (sp.palette as Record<string, string>)?.accent ?? '#4f46e5',
      },
      fonts: {
        heading: (sp.fonts as Record<string, string>)?.heading ?? 'system-ui, sans-serif',
        body: (sp.fonts as Record<string, string>)?.body ?? 'system-ui, sans-serif',
      },
      tone: (sp.tone as string) ?? 'modern',
      layout_hint: (sp.layout_hint as string) ?? '',
    },
    poster_copy: {
      hook: (pc.hook as string) || c.product_name,
      what_it_does: (pc.what_it_does as string) || c.tagline || '',
      features: asArray(pc.features).slice(0, 3),
      cta: (pc.cta as string) || c.cta_text || 'Learn more',
    },
    landing_content: {
      headline: (lc.headline as string) || c.product_name,
      what_it_does: (lc.what_it_does as string) || c.tagline || '',
      how_it_works: asArray(lc.how_it_works).slice(0, 4),
      why_use_it: asArray(lc.why_use_it).slice(0, 4),
      features: asArray(lc.features).slice(0, 6),
      cta: (lc.cta as string) || c.cta_text || 'Learn more',
    },
  };
}

function fallbackContent(c: Record<string, string>): ParsedContent {
  return normalize(
    {
      style_profile: {},
      poster_copy: { hook: c.product_name, what_it_does: c.tagline ?? '', features: [], cta: c.cta_text },
      landing_content: {
        headline: c.product_name,
        what_it_does: c.tagline ?? '',
        how_it_works: [],
        why_use_it: [],
        features: [],
        cta: c.cta_text,
      },
    },
    c,
  );
}
