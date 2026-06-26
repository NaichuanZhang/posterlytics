import {
  CORS,
  env,
  aiChat,
  extractJson,
  jsonResponse,
  createUserClient,
  sanitizeLandingHtml,
  CTA_PLACEHOLDER,
  BEACON_PLACEHOLDER,
  type DesignTokens,
} from './_shared.ts';

// `landing` is the landing-page AGENT. Authenticated. For a campaign it:
//   1. PLAN    — gpt-4o outlines sections + maps design tokens to roles (JSON)
//   2. DRAFT   — gpt-4o writes full, on-brand standalone HTML (no JS of its own)
//   3. CRITIQUE— gpt-4o VISION compares the design intent vs the site screenshot
//   4. REFINE  — one revision from the critique (loop capped at 2 rounds)
//   5. PERSIST — sanitize (strip scripts, guarantee CTA/beacon placeholders) and
//                store landing_html + landing_status.
//
// Clear separation: the model AUTHORS design/copy (agentic); sanitize + the
// per-request CTA/beacon injection in view.ts are PROGRAMMATIC. The model can
// never break tracking — the tracked CTA href and geo-beacon are server-injected.
const MAX_REFINE_ROUNDS = 2;

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

  const { data: campaign, error: cErr } = await client.database
    .from('campaigns')
    .select(
      'id, product_name, tagline, cta_text, product_url, design_tokens, screenshot_url, style_profile, landing_content, brand_assets, brand_essence',
    )
    .eq('id', body.campaignId)
    .maybeSingle();
  if (cErr || !campaign) return jsonResponse({ error: 'campaign not found' }, 404);

  const c = campaign as Record<string, unknown>;

  // The brief is the dynamic part of the landing prompt; rebuild it here (pure)
  // so the success response can surface it in the generation loading UI.
  const briefForUi = buildBrief(c, (c.design_tokens ?? null) as DesignTokens | null);

  // Mark in-flight so the UI can show a spinner; best-effort.
  await client.database.from('campaigns').update({ landing_status: 'generating' }).eq('id', c.id);

  let html: string | null = null;
  try {
    html = await runAgent(baseUrl, apiKey, c);
  } catch {
    html = null;
  }

  if (!html) {
    await client.database.from('campaigns').update({ landing_status: 'failed' }).eq('id', c.id);
    return jsonResponse({ error: 'landing generation failed' }, 502);
  }

  // Persist. Any failure here resets landing_status to 'failed' so the UI never
  // gets stuck showing 'generating' forever (the row was marked in-flight above).
  try {
    const safe = sanitizeLandingHtml(html);
    const { error: upErr } = await client.database
      .from('campaigns')
      .update({ landing_html: safe, landing_status: 'ready' })
      .eq('id', c.id);
    if (upErr) throw new Error(upErr.message);
    return jsonResponse({
      landing_status: 'ready',
      length: safe.length,
      prompt: { system: DRAFT_SYS, user: briefForUi },
    });
  } catch (e) {
    await client.database.from('campaigns').update({ landing_status: 'failed' }).eq('id', c.id).catch(() => {});
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

// --- agent pipeline ------------------------------------------------------

async function runAgent(baseUrl: string, apiKey: string, c: Record<string, unknown>): Promise<string | null> {
  const tokens = (c.design_tokens ?? null) as DesignTokens | null;
  const screenshotUrl = (c.screenshot_url ?? null) as string | null;
  const brief = buildBrief(c, tokens);

  // 1. PLAN — outline + token-role mapping. Best-effort; a failed plan is fine.
  let plan = '';
  try {
    const planRaw = await aiChat(
      baseUrl,
      apiKey,
      [
        { role: 'system', content: PLAN_SYS },
        { role: 'user', content: brief },
      ],
      { maxTokens: 700 },
    );
    plan = compactPlan(planRaw);
  } catch {
    plan = '';
  }

  // 2. DRAFT — full HTML.
  let html: string;
  try {
    html = stripToHtml(
      await aiChat(
        baseUrl,
        apiKey,
        [
          { role: 'system', content: DRAFT_SYS },
          { role: 'user', content: `${brief}\n\nPLAN (follow it):\n${plan || '(no plan — use your judgment)'}` },
        ],
        { maxTokens: 4000 },
      ),
    );
  } catch {
    return null;
  }
  if (!looksLikeHtml(html)) return null;

  // 3/4. CRITIQUE (vision) → REFINE, capped. Each round is best-effort and keeps
  // the last good HTML. Skipped entirely when there's no screenshot to compare to.
  if (screenshotUrl) {
    for (let round = 0; round < MAX_REFINE_ROUNDS; round++) {
      let critique: { ok?: boolean; fixes?: string[] } | null = null;
      try {
        const raw = await aiChat(
          baseUrl,
          apiKey,
          [
            { role: 'system', content: CRITIQUE_SYS },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    `This SCREENSHOT is the real product site. Below is the HTML of a landing page meant to ` +
                    `match its brand (colors, type, feel). List concrete fixes to make the landing feel more ` +
                    `on-brand vs the screenshot. Respond ONLY minified JSON: {"ok":<bool>,"fixes":[".."]}. ` +
                    `ok=true means it's already a strong brand match.\n\nLANDING HTML:\n${truncate(html, 6000)}`,
                },
                { type: 'image_url', image_url: { url: screenshotUrl } },
              ],
            },
          ],
          { maxTokens: 500 },
        );
        critique = extractJson(raw) as { ok?: boolean; fixes?: string[] };
      } catch {
        break; // vision unavailable → stop refining, keep current HTML
      }

      const fixes = Array.isArray(critique?.fixes) ? critique!.fixes!.filter(Boolean) : [];
      if (critique?.ok || fixes.length === 0) break;

      try {
        const revised = stripToHtml(
          await aiChat(
            baseUrl,
            apiKey,
            [
              { role: 'system', content: DRAFT_SYS },
              {
                role: 'user',
                content:
                  `${brief}\n\nRevise THIS landing HTML to address the fixes below. Keep the ` +
                  `${CTA_PLACEHOLDER} and ${BEACON_PLACEHOLDER} placeholders. Return the full HTML only.\n\n` +
                  `FIXES:\n${fixes.map((f) => `- ${f}`).join('\n')}\n\nCURRENT HTML:\n${truncate(html, 6000)}`,
              },
            ],
            { maxTokens: 4000 },
          ),
        );
        if (looksLikeHtml(revised)) html = revised;
      } catch {
        break; // refine failed → keep last good HTML
      }
    }
  }

  return html;
}

// --- prompt construction -------------------------------------------------

function buildBrief(c: Record<string, unknown>, tokens: DesignTokens | null): string {
  const product = String(c.product_name ?? 'the product');
  const tagline = String(c.tagline ?? '');
  const url = String(c.product_url ?? '');
  const essence = String(c.brand_essence ?? '');
  const lc = (c.landing_content ?? {}) as Record<string, unknown>;
  const ba = (c.brand_assets ?? {}) as { logo_url?: string; primary_image_url?: string; images?: Array<{ url: string }> };
  const sp = (c.style_profile ?? {}) as { palette?: Record<string, string>; fonts?: Record<string, string> };

  const heroImg = ba.primary_image_url || ba.images?.[0]?.url || '';
  const tokenBlock = tokens ? describeTokens(tokens) : describeStyleProfile(sp);

  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => `- ${String(x)}`).join('\n') : '');

  return [
    `PRODUCT: ${product}`,
    tagline ? `TAGLINE: ${tagline}` : '',
    url ? `SITE: ${url}` : '',
    essence ? `BRAND ESSENCE: ${essence}` : '',
    '',
    'DESIGN TOKENS (use these EXACT values — they are the real brand styling):',
    tokenBlock,
    '',
    'COPY (use/refine as needed):',
    lc.headline ? `HEADLINE: ${lc.headline}` : '',
    lc.what_it_does ? `WHAT IT DOES: ${lc.what_it_does}` : '',
    Array.isArray(lc.features) && lc.features.length ? `FEATURES:\n${list(lc.features)}` : '',
    Array.isArray(lc.how_it_works) && lc.how_it_works.length ? `HOW IT WORKS:\n${list(lc.how_it_works)}` : '',
    Array.isArray(lc.why_use_it) && lc.why_use_it.length ? `WHY USE IT:\n${list(lc.why_use_it)}` : '',
    lc.cta ? `CTA TEXT: ${lc.cta}` : `CTA TEXT: ${String(c.cta_text ?? 'Learn more')}`,
    '',
    'ASSETS (reference by URL if useful):',
    ba.logo_url ? `LOGO: ${ba.logo_url}` : '',
    heroImg ? `HERO IMAGE: ${heroImg}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function describeTokens(t: DesignTokens): string {
  const fontLinks = t.fontLinks.length ? `\n  fontLinks (<link> these): ${t.fontLinks.join(', ')}` : '';
  const btn = t.button
    ? `\n  button: bg ${t.button.bg}, text ${t.button.color}, radius ${t.button.radius}px, padding ${t.button.paddingY}/${t.button.paddingX}px, weight ${t.button.weight}${t.button.shadow ? `, shadow ${t.button.shadow}` : ''}`
    : '';
  return [
    `  colors: bg ${t.colors.bg}, text ${t.colors.text}, primary ${t.colors.primary}, accent ${t.colors.accent}`,
    `  palette: ${t.colors.palette.join(', ')}`,
    `  fonts: heading "${t.typography.headingFamily}", body "${t.typography.bodyFamily}"`,
    t.typography.scale.length ? `  type scale (px): ${t.typography.scale.join(', ')}` : '',
    t.radii.length ? `  radii (px): ${t.radii.join(', ')}` : '',
    t.shadows.length ? `  shadows: ${t.shadows.join(' | ')}` : '',
    t.spacing.length ? `  spacing (px): ${t.spacing.join(', ')}` : '',
    btn,
    fontLinks,
  ]
    .filter(Boolean)
    .join('\n');
}

// Fallback when no programmatic capture is available — use the analyzer's palette.
function describeStyleProfile(sp: { palette?: Record<string, string>; fonts?: Record<string, string> }): string {
  const p = sp.palette ?? {};
  const f = sp.fonts ?? {};
  return [
    `  colors: bg ${p.bg ?? '#ffffff'}, text ${p.text ?? '#111827'}, primary ${p.primary ?? '#1f2937'}, accent ${p.accent ?? '#10b981'}`,
    `  fonts: heading "${f.heading ?? 'system-ui, sans-serif'}", body "${f.body ?? 'system-ui, sans-serif'}"`,
  ].join('\n');
}

const PLAN_SYS =
  'You are a senior landing-page designer. Given a product brief and its real design tokens, propose a tight section ' +
  'outline for a single-screen marketing landing page (hero, value props, features, social proof / how-it-works, CTA) ' +
  'and say which token color/font goes where. Respond as a short plan (plain text, <= 12 lines). No HTML yet.';

const DRAFT_SYS =
  'You are an expert front-end developer and brand designer. Output a SINGLE complete, self-contained, responsive HTML ' +
  'document for a product landing page that faithfully matches the provided DESIGN TOKENS (use the exact hex colors, ' +
  'font families, radii, shadows, spacing). Inline all CSS in one <style> block. <link> any provided web-font ' +
  'stylesheets in <head>. You may reference the provided logo/hero image URLs. Make it polished, modern, and clearly ' +
  'on-brand — not generic.\n' +
  'HARD RULES:\n' +
  `• Include the primary call-to-action as an anchor whose href is EXACTLY the literal token ${CTA_PLACEHOLDER} ` +
  '(do not invent a URL). Use it for the main CTA button(s).\n' +
  `• Include the literal token ${BEACON_PLACEHOLDER} once, just before </body>.\n` +
  '• Do NOT write any <script> tags or on* event handlers or javascript: URLs — output pure HTML + CSS only. Any script ' +
  'you add will be stripped.\n' +
  '• Output ONLY the HTML document (start with <!doctype html>). No prose, no code fences, no commentary.';

const CRITIQUE_SYS =
  'You are a meticulous brand-design critic. You compare a rendered landing page against a screenshot of the real ' +
  'product website and judge brand fidelity: palette match, typographic feel, spacing and radius personality, overall ' +
  'vibe. Be specific and actionable. Respond ONLY minified JSON {"ok":<bool>,"fixes":["..."]}, max 5 fixes.';

// --- output hygiene ------------------------------------------------------

// Pull a clean HTML document out of model output (strip fences/prose around it).
function stripToHtml(text: string): string {
  let s = String(text ?? '').trim();
  const fence = /```(?:html)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.search(/<!doctype html|<html\b/i);
  if (start > 0) s = s.slice(start);
  return s.trim();
}

function looksLikeHtml(s: string): boolean {
  return /<html[\s\S]*<\/html>/i.test(s) || /<body[\s\S]*<\/body>/i.test(s);
}

function compactPlan(text: string): string {
  return String(text ?? '').trim().slice(0, 1500);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\n<!-- …truncated… -->' : s;
}
