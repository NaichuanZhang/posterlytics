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

  // 3. gpt-4o → landing_content + style_profile + brand_essence + poster_spec.
  // The poster is a fully AI-illustrated cozy-scrapbook image; poster_spec fills
  // the gamified template zones, brand_essence is a word-portrait that lets the
  // image model (which gets text only) infuse the real brand.
  const visibleText = stripToText(scrapeHtml).slice(0, 8000);
  const sys =
    'You are a senior product marketer, brand designer, and gamification copywriter. Given a product website and ' +
    'its GTM inputs, produce a faithful style profile, landing copy, a brand word-portrait, and a structured spec ' +
    'for a cozy gamified watercolor poster. Output STRICT JSON only — no prose, no code fences.\n' +
    'Schema: {' +
    '"style_profile":{"palette":{"primary":"#hex","bg":"#hex","text":"#hex","accent":"#hex"},' +
    '"fonts":{"heading":"CSS font family","body":"CSS font family"},"tone":"2-4 words","layout_hint":"one phrase"},' +
    '"landing_content":{"headline":"compelling headline","what_it_does":"1-2 sentences","how_it_works":["3-4 short steps"],' +
    '"why_use_it":["3 short reasons"],"features":["4-6 concise feature lines"],"cta":"button text"},' +
    '"brand_essence":"one vivid sentence describing the brand\'s visual identity for an illustrator: logo motif/shape, ' +
    'UI vibe, signature colors (name the hex), and overall feel",' +
    '"poster_spec":{' +
    '"hook_line1":"<=5 words, the foil, e.g. \'Others ship updates.\'",' +
    '"hook_line2":"<=5 words, the payoff, e.g. \'You ship attention.\'",' +
    '"subtitle":"PRODUCT · one-line positioning",' +
    '"level_badge":"a short level tag, e.g. \'Lv.26\'","xp":"e.g. \'94 / 100 XP\'",' +
    '"mascot":"a cute chibi creature that literally EMBODIES this product (what object/animal it should be, its expression, what it holds)",' +
    '"stat_nodes":[{"icon":"one-word icon idea","label":"<=2 words","stars":4}, ... exactly 5, stars 0-5],' +
    '"quest_cards":[{"icon":"one-word icon idea","title":"<=3 words","desc":"<=5 words"}, ... exactly 3],' +
    '"conv_left":{"heading":"e.g. Why <Product>","lines":["3 short benefit lines"]},' +
    '"conv_right":{"heading":"e.g. Start in 3 Steps","steps":["3 short numbered steps"]},' +
    '"qr_label":"<=4 words, e.g. Scan to Start",' +
    '"footer_formula":"A × B × C (three core value words)",' +
    '"urls":"primary url, optional secondary"}}\n' +
    'Make the hook a punchy \'Others <do X>. / You <do Y>.\' contrast specific to this product. Keep all poster text ' +
    'SHORT and legible. Match the brand\'s real palette/fonts/tone when discernible; otherwise infer tasteful defaults. ' +
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
    ], { maxTokens: 2200 });
    parsed = normalize(extractJson(raw), campaign as Record<string, string>);
  } catch {
    // One repair retry with a terse reminder.
    try {
      const raw2 = await aiChat(baseUrl, apiKey, [
        { role: 'system', content: sys + ' Return ONLY valid minified JSON.' },
        { role: 'user', content: user },
      ], { maxTokens: 2200 });
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
      brand_essence: parsed.brand_essence,
      poster_spec: parsed.poster_spec,
      brand_assets,
      status: 'draft',
    })
    .eq('id', campaign.id);
  if (upErr) return jsonResponse({ error: upErr.message }, 500);

  return jsonResponse({
    style_profile: parsed.style_profile,
    poster_copy: parsed.poster_copy,
    landing_content: parsed.landing_content,
    brand_essence: parsed.brand_essence,
    poster_spec: parsed.poster_spec,
    brand_assets,
  });
}

interface ParsedContent {
  style_profile: unknown;
  poster_copy: unknown;
  landing_content: unknown;
  brand_essence: string;
  poster_spec: unknown;
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
  const ps = (o.poster_spec ?? {}) as Record<string, unknown>;
  const product = c.product_name;
  const tagline = c.tagline || '';

  // poster_spec: clamp/shape the gamified template zones, with sane fallbacks.
  const statNodes = (Array.isArray(ps.stat_nodes) ? ps.stat_nodes : [])
    .slice(0, 5)
    .map((n) => {
      const x = (n ?? {}) as Record<string, unknown>;
      const stars = Math.max(0, Math.min(5, Math.round(Number(x.stars) || 4)));
      return { icon: String(x.icon ?? 'star'), label: String(x.label ?? '').slice(0, 24), stars };
    })
    .filter((n) => n.label);
  const questCards = (Array.isArray(ps.quest_cards) ? ps.quest_cards : [])
    .slice(0, 3)
    .map((n) => {
      const x = (n ?? {}) as Record<string, unknown>;
      return { icon: String(x.icon ?? 'spark'), title: String(x.title ?? '').slice(0, 30), desc: String(x.desc ?? '').slice(0, 60) };
    })
    .filter((q) => q.title);
  const convLeft = (ps.conv_left ?? {}) as Record<string, unknown>;
  const convRight = (ps.conv_right ?? {}) as Record<string, unknown>;

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
    // poster_copy kept for backward-compat (editor copy card / fallbacks).
    poster_copy: {
      hook: (ps.hook_line1 as string) || product,
      what_it_does: (ps.subtitle as string) || tagline,
      features: questCards.map((q) => q.title).slice(0, 3),
      cta: (ps.qr_label as string) || c.cta_text || 'Learn more',
    },
    landing_content: {
      headline: (lc.headline as string) || product,
      what_it_does: (lc.what_it_does as string) || tagline,
      how_it_works: asArray(lc.how_it_works).slice(0, 4),
      why_use_it: asArray(lc.why_use_it).slice(0, 4),
      features: asArray(lc.features).slice(0, 6),
      cta: (lc.cta as string) || c.cta_text || 'Learn more',
    },
    brand_essence: String(o.brand_essence ?? `${product}: clean modern product, friendly approachable feel`).slice(0, 400),
    poster_spec: {
      hook_line1: (ps.hook_line1 as string) || `Others just use ${product}.`,
      hook_line2: (ps.hook_line2 as string) || `You level up with it.`,
      subtitle: (ps.subtitle as string) || `${product}${tagline ? ' · ' + tagline : ''}`,
      level_badge: (ps.level_badge as string) || 'Lv.1',
      xp: (ps.xp as string) || '0 / 100 XP',
      mascot: (ps.mascot as string) || `a cute chibi mascot embodying ${product}`,
      stat_nodes: statNodes.length ? statNodes : [
        { icon: 'spark', label: 'Easy', stars: 5 },
        { icon: 'bolt', label: 'Fast', stars: 5 },
        { icon: 'heart', label: 'Loved', stars: 4 },
      ],
      quest_cards: questCards.length ? questCards : [
        { icon: 'spark', title: 'Get started', desc: 'in minutes' },
      ],
      conv_left: {
        heading: String(convLeft.heading ?? `Why ${product}`),
        lines: asArray(convLeft.lines).slice(0, 3),
      },
      conv_right: {
        heading: String(convRight.heading ?? 'Start in 3 Steps'),
        steps: asArray(convRight.steps).slice(0, 3),
      },
      qr_label: (ps.qr_label as string) || 'Scan to Start',
      footer_formula: (ps.footer_formula as string) || '',
      urls: (ps.urls as string) || '',
    },
  };
}

function fallbackContent(c: Record<string, string>): ParsedContent {
  return normalize({}, c);
}
