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
  logTrace,
  extractEventDetails,
  formatEventLines,
  type DesignTokens,
  type EventDetails,
} from './_shared.ts';

// `analyze` is the Poster Agent core. Authenticated. For a campaign it:
//   1. scrapes the product site (HTML)
//   2. extracts REAL brand assets — logo, og:image, product images, theme color
//      — and re-hosts them in the public `assets` bucket (CORS-clean, durable)
//   3. asks gpt-4o for poster_copy (scannable) + poster_content (full story) +
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
  const userId = userData.user.id;

  // posterStyle is accepted-but-ignored for backward compat: every product
  // campaign now uses the designer path (the fixed template modes were removed).
  let body: { campaignId?: string; posterStyle?: string; scenario?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad json' }, 400);
  }
  if (!body.campaignId) return jsonResponse({ error: 'missing campaignId' }, 400);

  // Load the campaign (owner RLS guarantees it's the caller's).
  const { data: campaign, error: cErr } = await client.database
    .from('campaigns')
    .select('id, product_url, product_name, tagline, cta_text, destination_url, scenario')
    .eq('id', body.campaignId)
    .maybeSingle();
  if (cErr || !campaign) return jsonResponse({ error: 'campaign not found' }, 404);

  // Which scenario this campaign promotes. 'event' branches the extraction +
  // prompt + spec; anything else is the original product flow. An explicit
  // body.scenario wins (the wizard sends it on the first analyze); otherwise we
  // read the PERSISTED scenario so that a re-analyze/regenerate of an existing
  // event campaign — which sends only { campaignId } — never silently reverts to
  // the product path. Brand-new/product campaigns fall back to 'product'.
  const persistedScenario = (campaign as { scenario?: string | null }).scenario;
  const scenario =
    body.scenario === 'event' || body.scenario === 'product'
      ? body.scenario
      : persistedScenario === 'event'
        ? 'event'
        : 'product';

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

  // 1b. For the event scenario, parse the Luma page's schema.org/Event JSON-LD
  // into structured event_details (deterministic — no LLM). Date/time/location
  // here are AUTHORITATIVE; the poster renders them as real text, never AI-painted.
  const event_details: EventDetails | null =
    scenario === 'event' ? extractEventDetails(scrapeHtml) : null;

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
  if (!capture) {
    // Silent degrade: the capture-service was unconfigured/unreachable/slow, so we
    // lose real computed tokens + the screenshot and fall back to regex colors.
    await logTrace(client, {
      campaignId: campaign.id,
      userId,
      step: 'capture',
      status: 'degraded',
      detail: 'capture-service returned null — fell back to regex-mined colors, no design_tokens/screenshot',
      request: { url: productUrl },
    });
  }
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
  // poster never hot-links the origin (CORS-clean export, survives churn).
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
  // so it's URL-addressable (generation loading UI, future vision passes).
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

  // 3. gpt-4o → poster_content + style_profile + brand_essence. The `designer`
  // agent then designs the bespoke layout from these and `hero` paints it;
  // brand_essence is a word-portrait that lets the image model (which gets text
  // only) infuse the real brand.
  const visibleText = stripToText(scrapeHtml).slice(0, 8000);

  // The event scenario uses its own prompt + spec normalizer (poster_spec becomes
  // an EventPosterSpec). Everything else — capture tokens, palette override,
  // asset re-hosting, persistence — is shared with the product path.
  if (scenario === 'event') {
    const parsedEv = await analyzeEvent({
      baseUrl, apiKey, campaign: campaign as Record<string, string>,
      eventDetails: event_details ?? {}, siteColors, tokens: design_tokens,
      visibleText, client, userId,
    });
    const { error: upErrEv } = await client.database
      .from('campaigns')
      .update({
        scenario: 'event',
        event_details,
        poster_style: 'designer', // one mode for all campaigns; events paint a bespoke event prompt
        style_profile: parsedEv.style_profile,
        poster_copy: parsedEv.poster_copy,
        poster_content: parsedEv.poster_content,
        brand_essence: parsedEv.brand_essence,
        poster_spec: parsedEv.poster_spec,
        brand_assets,
        design_tokens,
        screenshot_url,
        screenshot_key,
        status: 'draft',
      })
      .eq('id', campaign.id);
    if (upErrEv) {
      await logTrace(client, {
        campaignId: campaign.id, userId, step: 'analyze', status: 'failed',
        detail: 'campaign persist failed after event analyze',
        response: { error: upErrEv.message },
      });
      return jsonResponse({ error: upErrEv.message }, 500);
    }
    return jsonResponse({
      scenario: 'event',
      event_details,
      poster_style: 'designer',
      style_profile: parsedEv.style_profile,
      poster_copy: parsedEv.poster_copy,
      poster_content: parsedEv.poster_content,
      brand_essence: parsedEv.brand_essence,
      poster_spec: parsedEv.poster_spec,
      brand_assets,
      design_tokens,
      screenshot_url,
      prompt: parsedEv.prompt,
    });
  }

  // Every product poster is designed by the layout agent (`designer`) and painted
  // by `hero` — analyze only produces faithful brand context + structured copy.
  // (The fixed cozy/saas template modes were removed; designer is the one path.)
  const sys =
    'You are a senior product marketer and brand designer. Given a product website and its GTM inputs, produce a ' +
    'faithful style profile, structured product copy, and a brand word-portrait — a separate agent designs the ' +
    'poster layout from them. Output STRICT JSON only — no prose, no code fences.\n' +
    'Schema: {' +
    '"style_profile":{"palette":{"primary":"#hex","bg":"#hex","text":"#hex","accent":"#hex"},' +
    '"fonts":{"heading":"CSS font family","body":"CSS font family"},"tone":"2-4 words","layout_hint":"one phrase"},' +
    '"poster_content":{"headline":"compelling headline","what_it_does":"1-2 sentences","how_it_works":["3-4 short steps"],' +
    '"why_use_it":["3 short reasons"],"features":["4-6 concise feature lines"],"cta":"button text"},' +
    '"brand_essence":"one vivid sentence describing the brand\'s visual identity for an illustrator: logo motif/shape, ' +
    'UI vibe, signature colors (name the hex), and overall feel",' +
    '"qr_label":"<=4 words for the scan caption, e.g. Scan to Start"}\n' +
    'Keep all copy SHORT and legible. CRITICAL — the style_profile.palette MUST reflect the brand\'s REAL ' +
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
    parsed = normalize(extractJson(raw), campaign as Record<string, string>, siteColors, design_tokens);
  } catch {
    // One repair retry with a terse reminder.
    try {
      const raw2 = await aiChat(baseUrl, apiKey, [
        { role: 'system', content: sys + ' Return ONLY valid minified JSON.' },
        { role: 'user', content: user },
      ], { maxTokens: 2200 });
      parsed = normalize(extractJson(raw2), campaign as Record<string, string>, siteColors, design_tokens);
    } catch (e) {
      // Both AI-chat attempts failed → hardcoded fallback content. The poster still
      // renders, but it's off-brand; record why so it's not invisible.
      await logTrace(client, {
        campaignId: campaign.id,
        userId,
        step: 'analyze',
        status: 'degraded',
        detail: 'AI chat failed twice — used hardcoded fallback content',
        request: { model: Deno.env.get('OPENROUTER_CHAT_MODEL') ?? 'openai/gpt-4o', system: sys, user },
        response: { error: e instanceof Error ? e.message : String(e) },
      });
      parsed = fallbackContent(campaign as Record<string, string>, siteColors, design_tokens);
    }
  }

  // 4. Persist. design_tokens/screenshot are written even when the AI step used a
  // fallback. poster_content feeds the poster copy (designer.ts); the QR itself
  // resolves to a pure tracked redirect, so there's no hosted landing page.
  const { error: upErr } = await client.database
    .from('campaigns')
    .update({
      scenario: 'product',
      event_details: null, // clear any stale event data if a campaign switched to product
      poster_style: parsed.poster_style,
      style_profile: parsed.style_profile,
      poster_copy: parsed.poster_copy,
      poster_content: parsed.poster_content,
      brand_essence: parsed.brand_essence,
      poster_spec: parsed.poster_spec,
      brand_assets,
      design_tokens,
      screenshot_url,
      screenshot_key,
      status: 'draft',
    })
    .eq('id', campaign.id);
  if (upErr) {
    await logTrace(client, {
      campaignId: campaign.id,
      userId,
      step: 'analyze',
      status: 'failed',
      detail: 'campaign persist failed after analyze',
      response: { error: upErr.message },
    });
    return jsonResponse({ error: upErr.message }, 500);
  }

  return jsonResponse({
    poster_style: parsed.poster_style,
    style_profile: parsed.style_profile,
    poster_copy: parsed.poster_copy,
    poster_content: parsed.poster_content,
    brand_essence: parsed.brand_essence,
    poster_spec: parsed.poster_spec,
    brand_assets,
    design_tokens,
    screenshot_url,
    // The real prompt sent to the model — surfaced in the generation loading UI.
    prompt: { system: sys, user },
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
  poster_content: unknown;
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

  // Logo: try several signals in priority order (first hit wins). Real sites tag
  // logos in many ways, so cast a wide net before falling back to icons.
  let logo: string | null = null;
  // 1. schema.org JSON-LD "logo": "url" (very common, points at the canonical mark).
  if (!logo) {
    const ld = /"logo"\s*:\s*"([^"]+\.(?:png|jpe?g|webp|svg)(?:\?[^"]*)?)"/i.exec(htmlText)?.[1];
    if (ld) logo = abs(ld, base);
  }
  // 2. <link rel="...logo..."> or <meta property="og:logo">.
  if (!logo) {
    const linkLogo =
      /<link[^>]+rel=["'][^"']*logo[^"']*["'][^>]+href=["']([^"']+)["']/i.exec(htmlText)?.[1] ||
      /<meta[^>]+property=["']og:logo["'][^>]+content=["']([^"']+)["']/i.exec(htmlText)?.[1];
    if (linkLogo) logo = abs(linkLogo, base);
  }
  // 3. An <img> whose class/id/alt/src mentions "logo" (now incl. id, and .svg).
  if (!logo) {
    const logoImg = /<img[^>]+(?:class|id|alt|src|data-[a-z-]+)=["'][^"']*logo[^"']*["'][^>]*>/i.exec(htmlText)?.[0];
    if (logoImg) {
      const src = /\bsrc=["']([^"']+)["']/i.exec(logoImg)?.[1];
      if (src) logo = abs(src, base);
    }
  }
  // 4. The first <img> inside the <header> (the masthead brand mark).
  if (!logo) {
    const header = /<header\b[\s\S]*?<\/header>/i.exec(htmlText)?.[0];
    const headerImg = header ? /<img[^>]+\bsrc=["']([^"']+\.(?:png|jpe?g|webp|svg)(?:\?[^"']*)?)["']/i.exec(header)?.[1] : null;
    if (headerImg) logo = abs(headerImg, base);
  }
  // 5. apple-touch-icon, then favicon.
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
  tokens: DesignTokens | null = null,
): ParsedContent {
  const o = (raw ?? {}) as Record<string, Record<string, unknown>>;
  const sp = o.style_profile ?? {};
  const lc = o.poster_content ?? {};
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

  // The layout itself is designed later by the `designer` function; the product
  // poster_spec carries only what the SPA band reads (qr_label) + the urls line.
  const qrLabel = String((o.qr_label as unknown) ?? '').slice(0, 40) || 'Scan to start';
  const poster_spec = { qr_label: qrLabel, urls: c.product_url || '' };

  const contentHeadline = (lc.headline as string) || product;
  const contentWhat = (lc.what_it_does as string) || tagline;
  const contentFeatures = asArray(lc.features).slice(0, 6);
  const contentCta = (lc.cta as string) || c.cta_text || 'Learn more';

  // poster_copy kept for backward-compat (editor fallbacks); derived straight
  // from the structured content now that the template specs are gone.
  const posterCopy = {
    hook: contentHeadline,
    what_it_does: contentWhat,
    features: contentFeatures.slice(0, 3),
    cta: contentCta,
  };

  return {
    poster_style: 'designer',
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
    poster_content: {
      headline: contentHeadline,
      what_it_does: contentWhat,
      how_it_works: asArray(lc.how_it_works).slice(0, 4),
      why_use_it: asArray(lc.why_use_it).slice(0, 4),
      features: contentFeatures,
      cta: contentCta,
    },
    brand_essence: String(o.brand_essence ?? `${product}: clean modern product, friendly approachable feel`).slice(0, 400),
    poster_spec,
  };
}

function fallbackContent(
  c: Record<string, string>,
  siteColors: string[] = [],
  tokens: DesignTokens | null = null,
): ParsedContent {
  return normalize({}, c, siteColors, tokens);
}

// =====================================================================
// Event scenario: analyze a Luma event into an EventPosterSpec + event copy.
// Logistics (date/time/location/host) are DETERMINISTIC from event_details
// (formatEventLines) — the model only writes the promo hook/blurb/RSVP label, so
// the poster can never show a wrong date. Palette/fonts reuse the shared capture.
// =====================================================================
async function analyzeEvent(args: {
  baseUrl: string;
  apiKey: string;
  campaign: Record<string, string>;
  eventDetails: EventDetails;
  siteColors: string[];
  tokens: DesignTokens | null;
  visibleText: string;
  // deno-lint-ignore no-explicit-any
  client: any;
  userId: string;
}): Promise<ParsedContent & { prompt: { system: string; user: string } }> {
  const { baseUrl, apiKey, campaign, eventDetails, siteColors, tokens, visibleText, client, userId } = args;
  const lines = formatEventLines(eventDetails);
  const title = eventDetails.event_name || campaign.product_name || 'the event';
  const rsvpUrl = campaign.destination_url || campaign.product_url || '';

  const sys =
    'You are a senior event marketer and brand designer. Given a Luma event page and its ' +
    'already-extracted logistics, write concise, compelling promo copy and a faithful style profile. ' +
    'Output STRICT JSON only — no prose, no code fences.\n' +
    'CRITICAL: the event date, time, and location are provided to you and are AUTHORITATIVE — do NOT ' +
    'invent, alter, or restate them differently; the poster renders those provided strings directly.\n' +
    'JSON shape: {' +
    '"style_profile":{"palette":{"primary":"#hex","bg":"#hex","text":"#hex","accent":"#hex"},' +
    '"fonts":{"heading":"CSS font family","body":"CSS font family"},"tone":"2-4 words","layout_hint":"one phrase"},' +
    '"brand_essence":"one vivid sentence describing the event\'s visual identity for an illustrator: mood, ' +
    'motif, signature colors (name the hex), and overall feel",' +
    '"poster_content":{"headline":"compelling event headline","what_it_does":"1-2 sentence event pitch",' +
    '"how_it_works":["3-4 what-to-expect / agenda bullets"],"why_use_it":["3 reasons to attend"],' +
    '"features":["3-5 highlights: speakers, activities, perks"],"cta":"RSVP button text"},' +
    '"poster_spec":{"hook":"<=6 words, a punchy reason to attend","blurb":"one short line: who it\'s for + the draw",' +
    '"rsvp_label":"<=4 words, e.g. Scan to RSVP"}}\n' +
    'Use the REAL brand colors mined from the page for the palette. Keep all copy SHORT and legible.';
  const user =
    `EVENT TITLE: ${title}\n` +
    `DATE (authoritative): ${lines.date_line || '(unknown)'}\n` +
    `TIME (authoritative): ${lines.time_line || '(unknown)'}\n` +
    `LOCATION (authoritative): ${lines.location_line || '(unknown)'}\n` +
    `HOST: ${lines.host_line || eventDetails.host_name || '(unknown)'}\n` +
    `PRICE: ${eventDetails.price_label ?? '(unknown)'}\n` +
    `CTA HINT: ${campaign.cta_text ?? 'Scan to RSVP'}\n` +
    `REAL BRAND COLORS mined from the page (use for palette): ${siteColors.length ? siteColors.join(', ') : '(none — infer tasteful defaults)'}\n\n` +
    `EVENT PAGE TEXT (truncated):\n${visibleText || '(scrape failed — rely on the fields above)'}`;

  let ev: Record<string, unknown> = {};
  try {
    const raw = await aiChat(baseUrl, apiKey, [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ], { maxTokens: 1600 });
    ev = extractJson(raw) as Record<string, unknown>;
  } catch (e) {
    await logTrace(client, {
      campaignId: campaign.id, userId, step: 'analyze', status: 'degraded',
      detail: 'event AI chat failed — used deterministic logistics + minimal fallback copy',
      request: { system: sys, user },
      response: { error: e instanceof Error ? e.message : String(e) },
    });
    ev = {};
  }

  return normalizeEvent(ev, campaign, eventDetails, lines, siteColors, tokens, rsvpUrl, { system: sys, user });
}

// Assemble an EventPosterSpec + event copy from the model output, forcing the
// deterministic logistics lines in and defaulting everything the model omitted.
function normalizeEvent(
  raw: Record<string, unknown>,
  c: Record<string, string>,
  ev: EventDetails,
  lines: { date_line: string; time_line: string; location_line: string; host_line: string },
  siteColors: string[],
  tokens: DesignTokens | null,
  rsvpUrl: string,
  prompt: { system: string; user: string },
): ParsedContent & { prompt: { system: string; user: string } } {
  const sp = (raw.style_profile ?? {}) as Record<string, unknown>;
  const lc = (raw.poster_content ?? {}) as Record<string, unknown>;
  const ps = (raw.poster_spec ?? {}) as Record<string, unknown>;
  const title = ev.event_name || c.product_name || 'Event';

  const modelPalette = (sp.palette ?? {}) as Record<string, string>;
  const topSiteColor = siteColors.find(isVivid);
  const accent =
    (isVivid(tokens?.colors.accent) ? tokens!.colors.accent : null) ??
    topSiteColor ??
    (isVivid(modelPalette.accent) ? modelPalette.accent : '#e8633a');
  const primary = tokens?.colors.primary || modelPalette.primary || '#1f2937';

  const rsvpLabel = (ps.rsvp_label as string) || c.cta_text || 'Scan to RSVP';
  const poster_spec = {
    title,
    date_line: lines.date_line,
    time_line: lines.time_line,
    location_line: lines.location_line,
    host_line: lines.host_line,
    rsvp_label: rsvpLabel,
    ...(ev.price_label ? { price_line: ev.price_label } : {}),
    urls: rsvpUrl,
  };

  const hook = (ps.hook as string) || (lc.headline as string) || `You're invited: ${title}`;

  return {
    poster_style: 'designer',
    style_profile: {
      palette: {
        primary,
        bg: tokens?.colors.bg || modelPalette.bg || '#ffffff',
        text: tokens?.colors.text || modelPalette.text || '#111827',
        accent,
      },
      fonts: {
        heading: fontStack(tokens?.typography.headingFamily) ?? (sp.fonts as Record<string, string>)?.heading ?? 'system-ui, sans-serif',
        body: fontStack(tokens?.typography.bodyFamily) ?? (sp.fonts as Record<string, string>)?.body ?? 'system-ui, sans-serif',
      },
      tone: (sp.tone as string) ?? 'inviting',
      layout_hint: (sp.layout_hint as string) ?? '',
    },
    poster_copy: {
      hook,
      what_it_does: (ps.blurb as string) || (lc.what_it_does as string) || '',
      features: asArray(lc.features).slice(0, 3),
      cta: rsvpLabel,
    },
    poster_content: {
      headline: (lc.headline as string) || title,
      what_it_does: (lc.what_it_does as string) || (ps.blurb as string) || '',
      how_it_works: asArray(lc.how_it_works).slice(0, 4),
      why_use_it: asArray(lc.why_use_it).slice(0, 4),
      features: asArray(lc.features).slice(0, 6),
      cta: (lc.cta as string) || rsvpLabel,
    },
    brand_essence: String(raw.brand_essence ?? `${title}: a warm, inviting event`).slice(0, 400),
    poster_spec: poster_spec as unknown,
    prompt,
  };
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
