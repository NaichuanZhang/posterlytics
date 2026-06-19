import {
  CORS,
  env,
  aiChat,
  extractJson,
  jsonResponse,
  createUserClient,
  captureSite,
  dataUrlToBlob,
  parseColor,
  toHex,
  type DesignTokens,
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

  let body: { campaignId?: string; posterStyle?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad json' }, 400);
  }
  if (!body.campaignId) return jsonResponse({ error: 'missing campaignId' }, 400);

  // Optional forced template. 'auto' (or absent) lets the model pick; otherwise
  // we honor the explicit choice and override the model's pick in normalize().
  const forcedStyle =
    body.posterStyle === 'saas_glassmorphism' || body.posterStyle === 'cozy_scrapbook'
      ? body.posterStyle
      : null;

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
  // Mine the site's REAL vivid colors from raw CSS (cheap fallback seed).
  const regexColors = extractColors(scrapeHtml);

  // 2b. Programmatic style capture via the headless-browser service: real
  // computed fonts/colors/radii/shadows/spacing + a screenshot. Best-effort —
  // null when the service is unconfigured/unreachable, in which case we fall
  // back to the regex-mined colors below. (Capture happens here so its palette
  // can seed the model and its tokens are persisted.)
  const capture = await captureSite(productUrl);
  const design_tokens: DesignTokens | null = capture?.tokens ?? null;
  // Prefer the programmatic palette (computed, role-aware) over regex mining;
  // fall back to regex colors when capture is unavailable.
  const siteColors = design_tokens
    ? dedupeColors([
        design_tokens.colors.accent,
        design_tokens.colors.primary,
        ...design_tokens.colors.palette,
        ...regexColors,
      ])
    : regexColors;

  // Re-host logo + up to 2 product images into the public assets bucket so the
  // poster/landing never hot-link the origin (CORS-clean export, survives churn).
  const brand_assets: {
    logo_url?: string;
    logo_key?: string;
    images: Array<{ url: string; key: string }>;
    primary_image_url?: string;
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

  // Upload the captured screenshot (a JPEG data URL) to the public assets bucket
  // so the landing agent's vision step can reference it by URL.
  let screenshot_url: string | null = null;
  let screenshot_key: string | null = null;
  if (capture?.screenshotDataUrl) {
    try {
      const blob = dataUrlToBlob(capture.screenshotDataUrl);
      const { data } = await client.storage
        .from('assets')
        .upload(`screenshot/${campaign.id}/${crypto.randomUUID().slice(0, 8)}.jpg`, blob);
      if (data) {
        screenshot_url = data.url;
        screenshot_key = data.key;
      }
    } catch {
      screenshot_url = null;
    }
  }

  // 3. gpt-4o → landing_content + style_profile + brand_essence + poster_spec.
  // The poster is a fully AI-illustrated cozy-scrapbook image; poster_spec fills
  // the gamified template zones, brand_essence is a word-portrait that lets the
  // image model (which gets text only) infuse the real brand.
  const visibleText = stripToText(scrapeHtml).slice(0, 8000);
  const sys =
    'You are a senior product marketer, brand designer, and gamification copywriter. Given a product website and ' +
    'its GTM inputs, produce a faithful style profile, landing copy, a brand word-portrait, choose the best poster ' +
    'template for this brand, and fill that template\'s structured spec. Output STRICT JSON only — no prose, no code fences.\n' +
    '"poster_style" MUST be one of: "saas_glassmorphism" (premium split light/dark product-launch poster with a 3D ' +
    'device mockup — pick for developer tools, B2B/SaaS, data, fintech, infra, "serious/premium tech" brands), or ' +
    '"cozy_scrapbook" (warm hand-drawn gamified watercolor — pick for playful, consumer, lifestyle, creative, social, ' +
    'or otherwise warm/friendly brands). Decide from the brand\'s tone and palette.\n' +
    'Common schema: {' +
    '"poster_style":"saas_glassmorphism" | "cozy_scrapbook",' +
    '"style_profile":{"palette":{"primary":"#hex","bg":"#hex","text":"#hex","accent":"#hex"},' +
    '"fonts":{"heading":"CSS font family","body":"CSS font family"},"tone":"2-4 words","layout_hint":"one phrase"},' +
    '"landing_content":{"headline":"compelling headline","what_it_does":"1-2 sentences","how_it_works":["3-4 short steps"],' +
    '"why_use_it":["3 short reasons"],"features":["4-6 concise feature lines"],"cta":"button text"},' +
    '"brand_essence":"one vivid sentence describing the brand\'s visual identity for an illustrator: logo motif/shape, ' +
    'UI vibe, signature colors (name the hex), and overall feel",' +
    '"poster_spec":{ ...shape depends on poster_style... }}\n' +
    'IF poster_style == "cozy_scrapbook", poster_spec = {' +
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
    '"urls":"primary url, optional secondary"}.\n' +
    'Make the cozy hook a punchy \'Others <do X>. / You <do Y>.\' contrast specific to this product.\n' +
    'IF poster_style == "saas_glassmorphism", poster_spec = {' +
    '"headline":"<=4 words, the product/brand name as the hero, split-friendly",' +
    '"sub_name":"<=6 words, a positioning sub-name or category",' +
    '"slogan":"one punchy line, the core promise",' +
    '"product_intro":"2-3 short lines: who it is for + what it does + the problem it solves",' +
    '"device_context":"what the 3D device screen shows — a realistic, specific product UI (name the key panels/numbers)",' +
    '"hero_metric":"one bold credible metric shown on the device, e.g. \'+164%\' or \'2.3s\'",' +
    '"float_cards":[{"icon":"one-word icon idea","title":"<=2 words","desc":"<=6 words"}, ... exactly 3],' +
    '"feature_matrix":[{"icon":"one-word icon idea","title":"<=2 words feature name","desc":"<=8 words"}, ... exactly 6],' +
    '"reasons":[{"icon":"one-word icon idea","title":"<=3 words","desc":"<=8 words"}, ... exactly 4 — these go in the dark zone],' +
    '"cta_main":"a decisive CTA headline",' +
    '"cta_sub":"one supporting line under the CTA",' +
    '"qr_label":"<=4 words, e.g. Scan to Start",' +
    '"footer_slogan":"a short ALL-CAPS letter-spaced tagline",' +
    '"urls":"primary url, optional secondary"}.\n' +
    'Keep all poster text SHORT and legible. CRITICAL — the style_profile.palette MUST reflect the brand\'s REAL ' +
    'colors. You are given the actual hex colors mined from the site\'s own CSS (most-used first); use the most ' +
    'prominent vivid one as the "accent" and the brand\'s dominant dark/brand tone as "primary". Do NOT substitute a ' +
    'generic SaaS blue or any color that is not on the site. Only fall back to tasteful defaults if no site colors ' +
    `are provided. Detected theme-color (if any): ${assets.themeColor || 'none'}.`;
  const user =
    `PRODUCT NAME: ${campaign.product_name}\n` +
    `TAGLINE (optional): ${(campaign as Record<string, string>).tagline ?? ''}\n` +
    `CTA HINT: ${(campaign as Record<string, string>).cta_text ?? ''}\n` +
    `PRODUCT URL: ${productUrl}\n` +
    `REAL BRAND COLORS mined from the site CSS (most-used first, use these for the palette): ${siteColors.length ? siteColors.join(', ') : '(none found — infer tasteful defaults)'}\n\n` +
    `WEBSITE TEXT (truncated):\n${visibleText || '(scrape failed — rely on the inputs above)'}`;

  let parsed: ParsedContent;
  try {
    const raw = await aiChat(baseUrl, apiKey, [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ], { maxTokens: 2200 });
    parsed = normalize(extractJson(raw), campaign as Record<string, string>, siteColors, forcedStyle, design_tokens);
  } catch {
    // One repair retry with a terse reminder.
    try {
      const raw2 = await aiChat(baseUrl, apiKey, [
        { role: 'system', content: sys + ' Return ONLY valid minified JSON.' },
        { role: 'user', content: user },
      ], { maxTokens: 2200 });
      parsed = normalize(extractJson(raw2), campaign as Record<string, string>, siteColors, forcedStyle, design_tokens);
    } catch {
      parsed = fallbackContent(campaign as Record<string, string>, siteColors, forcedStyle, design_tokens);
    }
  }

  // 4. Persist. design_tokens/screenshot are written even when the AI step used a
  // fallback. landing_html is intentionally NOT touched here — the landing agent
  // owns it (a stale landing for the old style is cleared by re-running landing).
  const { error: upErr } = await client.database
    .from('campaigns')
    .update({
      poster_style: parsed.poster_style,
      style_profile: parsed.style_profile,
      poster_copy: parsed.poster_copy,
      landing_content: parsed.landing_content,
      brand_essence: parsed.brand_essence,
      poster_spec: parsed.poster_spec,
      brand_assets,
      design_tokens,
      screenshot_url,
      screenshot_key,
      status: 'draft',
    })
    .eq('id', campaign.id);
  if (upErr) return jsonResponse({ error: upErr.message }, 500);

  return jsonResponse({
    poster_style: parsed.poster_style,
    style_profile: parsed.style_profile,
    poster_copy: parsed.poster_copy,
    landing_content: parsed.landing_content,
    brand_essence: parsed.brand_essence,
    poster_spec: parsed.poster_spec,
    brand_assets,
    design_tokens,
    screenshot_url,
  });
}

// Dedupe a list of color strings (any format), preserving order, dropping blanks
// and exact-rgb duplicates. Used to merge the captured palette with regex colors.
function dedupeColors(colors: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of colors) {
    const rgb = parseColor(c);
    if (!rgb) continue;
    const hex = toHex(rgb);
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push(hex);
  }
  return out.slice(0, 8);
}

interface ParsedContent {
  poster_style: string;
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

// Mine the most-used VIVID (non-grayscale, mid-luminance) hex colors from the raw
// HTML+CSS. The model otherwise only sees text (styles are stripped) and guesses a
// generic SaaS palette — feeding it the site's REAL colors keeps the poster on-brand.
function extractColors(htmlText: string): string[] {
  if (!htmlText) return [];
  const counts = new Map<string, number>();
  const re = /#([0-9a-fA-F]{6})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(htmlText))) {
    const hex = '#' + m[1].toLowerCase();
    const r = parseInt(m[1].slice(0, 2), 16);
    const g = parseInt(m[1].slice(2, 4), 16);
    const b = parseInt(m[1].slice(4, 6), 16);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    // Keep only colorful, usable accents (drop near-gray, near-black, near-white).
    if (sat < 0.25 || lum < 0.12 || lum > 0.93) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h).slice(0, 6);
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

function cards(
  raw: unknown,
  count: number,
  iconDefault: string,
  titleMax: number,
  descMax: number,
): Array<{ icon: string; title: string; desc: string }> {
  return (Array.isArray(raw) ? raw : [])
    .slice(0, count)
    .map((n) => {
      const x = (n ?? {}) as Record<string, unknown>;
      return {
        icon: String(x.icon ?? iconDefault),
        title: String(x.title ?? x.name ?? '').slice(0, titleMax),
        desc: String(x.desc ?? '').slice(0, descMax),
      };
    })
    .filter((q) => q.title);
}

function normalizeCozySpec(ps: Record<string, unknown>, product: string, tagline: string) {
  const statNodes = (Array.isArray(ps.stat_nodes) ? ps.stat_nodes : [])
    .slice(0, 5)
    .map((n) => {
      const x = (n ?? {}) as Record<string, unknown>;
      const stars = Math.max(0, Math.min(5, Math.round(Number(x.stars) || 4)));
      return { icon: String(x.icon ?? 'star'), label: String(x.label ?? '').slice(0, 24), stars };
    })
    .filter((n) => n.label);
  const questCards = cards(ps.quest_cards, 3, 'spark', 30, 60);
  const convLeft = (ps.conv_left ?? {}) as Record<string, unknown>;
  const convRight = (ps.conv_right ?? {}) as Record<string, unknown>;
  return {
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
  };
}

function normalizeSaasSpec(ps: Record<string, unknown>, product: string, tagline: string) {
  const featureMatrix = cards(ps.feature_matrix, 6, 'bolt', 24, 80);
  const floatCards = cards(ps.float_cards, 3, 'spark', 24, 60);
  const reasons = cards(ps.reasons, 4, 'check', 30, 80);
  return {
    headline: (ps.headline as string) || product,
    sub_name: (ps.sub_name as string) || tagline,
    slogan: (ps.slogan as string) || tagline || `Meet ${product}`,
    product_intro: (ps.product_intro as string) || tagline,
    device_context: (ps.device_context as string) || `the ${product} dashboard with clean charts and key metrics`,
    hero_metric: (ps.hero_metric as string) || '',
    float_cards: floatCards.length ? floatCards : [
      { icon: 'bolt', title: 'Fast', desc: 'Ships in minutes' },
      { icon: 'lock', title: 'Secure', desc: 'Enterprise-grade' },
      { icon: 'spark', title: 'Simple', desc: 'No setup needed' },
    ],
    feature_matrix: featureMatrix.length ? featureMatrix : [
      { icon: 'bolt', title: 'Fast', desc: 'Built for speed' },
      { icon: 'chart', title: 'Insightful', desc: 'Clear analytics' },
    ],
    reasons: reasons.length ? reasons : [
      { icon: 'check', title: 'Trusted', desc: 'By modern teams' },
      { icon: 'star', title: 'Loved', desc: 'High ratings' },
    ],
    cta_main: (ps.cta_main as string) || `Try ${product} today`,
    cta_sub: (ps.cta_sub as string) || 'Scan to get started in seconds',
    qr_label: (ps.qr_label as string) || 'Scan to Start',
    footer_slogan: (ps.footer_slogan as string) || '',
    urls: (ps.urls as string) || '',
  };
}

// True if a hex is "vivid" (colorful enough to be an intentional accent).
function isVivid(hex: string | undefined): boolean {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return false;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return sat >= 0.25 && lum >= 0.12 && lum <= 0.93;
}

function normalize(
  raw: unknown,
  c: Record<string, string>,
  siteColors: string[] = [],
  forcedStyle: 'saas_glassmorphism' | 'cozy_scrapbook' | null = null,
  tokens: DesignTokens | null = null,
): ParsedContent {
  const o = (raw ?? {}) as Record<string, Record<string, unknown>>;
  const sp = o.style_profile ?? {};
  const lc = o.landing_content ?? {};
  const ps = (o.poster_spec ?? {}) as Record<string, unknown>;
  const product = c.product_name;
  const tagline = c.tagline || '';

  // Accent correction: the poster's whole color identity is the accent. If the
  // model returned an accent that ISN'T a real site color but the site has vivid
  // colors, snap to the most-used mined color so the poster stays on-brand.
  const modelPalette = (sp.palette ?? {}) as Record<string, string>;
  // The most-used vivid color mined from the site IS the brand accent, by
  // definition — prefer it over the model's guess (the model often picks a lesser
  // on-page color or a generic blue). Only fall back to the model/default when the
  // site yielded no usable colors. The programmatic capture (when present) is the
  // strongest signal of all, so its computed accent/primary win outright.
  const topSiteColor = siteColors.find(isVivid);
  const modelAccent = modelPalette.accent;
  const accent =
    (isVivid(tokens?.colors.accent) ? tokens!.colors.accent : null) ??
    topSiteColor ??
    (isVivid(modelAccent) ? modelAccent : '#10b981');
  // Primary: captured computed color wins, then model's, else a dark default.
  const primary = tokens?.colors.primary || modelPalette.primary || '#1f2937';

  // Honor an explicit user choice; otherwise use the model's auto-pick.
  const poster_style = forcedStyle
    ?? ((o.poster_style as unknown) === 'saas_glassmorphism' ? 'saas_glassmorphism' : 'cozy_scrapbook');

  const poster_spec = poster_style === 'saas_glassmorphism'
    ? normalizeSaasSpec(ps, product, tagline)
    : normalizeCozySpec(ps, product, tagline);

  // poster_copy kept for backward-compat (landing page, optimizer agent, editor
  // fallbacks). Map from whichever spec shape we produced.
  const posterCopy = poster_style === 'saas_glassmorphism'
    ? {
        hook: (poster_spec as ReturnType<typeof normalizeSaasSpec>).slogan,
        what_it_does: (poster_spec as ReturnType<typeof normalizeSaasSpec>).product_intro,
        features: (poster_spec as ReturnType<typeof normalizeSaasSpec>).feature_matrix.map((f) => f.title).slice(0, 3),
        cta: (poster_spec as ReturnType<typeof normalizeSaasSpec>).cta_main,
      }
    : {
        hook: (poster_spec as ReturnType<typeof normalizeCozySpec>).hook_line1,
        what_it_does: (poster_spec as ReturnType<typeof normalizeCozySpec>).subtitle,
        features: (poster_spec as ReturnType<typeof normalizeCozySpec>).quest_cards.map((q) => q.title).slice(0, 3),
        cta: (poster_spec as ReturnType<typeof normalizeCozySpec>).qr_label,
      };

  return {
    poster_style,
    style_profile: {
      palette: {
        primary,
        bg: tokens?.colors.bg || modelPalette.bg || '#ffffff',
        text: tokens?.colors.text || modelPalette.text || '#111827',
        accent,
      },
      fonts: {
        // Captured computed font families win; the model is the fallback.
        heading: fontStack(tokens?.typography.headingFamily) ?? (sp.fonts as Record<string, string>)?.heading ?? 'system-ui, sans-serif',
        body: fontStack(tokens?.typography.bodyFamily) ?? (sp.fonts as Record<string, string>)?.body ?? 'system-ui, sans-serif',
      },
      tone: (sp.tone as string) ?? 'modern',
      layout_hint: (sp.layout_hint as string) ?? '',
    },
    poster_copy: posterCopy,
    landing_content: {
      headline: (lc.headline as string) || product,
      what_it_does: (lc.what_it_does as string) || tagline,
      how_it_works: asArray(lc.how_it_works).slice(0, 4),
      why_use_it: asArray(lc.why_use_it).slice(0, 4),
      features: asArray(lc.features).slice(0, 6),
      cta: (lc.cta as string) || c.cta_text || 'Learn more',
    },
    brand_essence: String(o.brand_essence ?? `${product}: clean modern product, friendly approachable feel`).slice(0, 400),
    poster_spec,
  };
}

function fallbackContent(
  c: Record<string, string>,
  siteColors: string[] = [],
  forcedStyle: 'saas_glassmorphism' | 'cozy_scrapbook' | null = null,
  tokens: DesignTokens | null = null,
): ParsedContent {
  return normalize({}, c, siteColors, forcedStyle, tokens);
}

// Turn a bare captured family ("Inter") into a CSS stack with a sane generic
// fallback. Returns null for an empty/whitespace family so callers can fall back.
function fontStack(family: string | undefined): string | null {
  const f = (family ?? '').trim();
  if (!f) return null;
  // Already a stack (has a comma) — pass through.
  if (f.includes(',')) return f;
  const lower = f.toLowerCase();
  if (lower === 'system-ui' || lower === '-apple-system') return 'system-ui, sans-serif';
  const generic = /serif|times|georgia|playfair|merriweather|lora/.test(lower) && !/sans/.test(lower)
    ? 'serif'
    : /mono|code|consol/.test(lower)
      ? 'monospace'
      : 'sans-serif';
  return `"${f}", ${generic}`;
}
