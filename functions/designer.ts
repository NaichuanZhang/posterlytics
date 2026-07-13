import {
  CORS,
  env,
  aiChat,
  extractJson,
  jsonResponse,
  createUserClient,
  normalizePosterLayout,
  logTrace,
  type DesignTokens,
} from './_shared.ts';

// `designer` is the layout-design agent for the `designer` poster style. It runs
// BETWEEN analyze and hero: given the brand context analyze produced
// (brand_essence, style_profile palette, copy, design_tokens), it asks gpt-4o to
// design a BESPOKE poster layout as structured JSON (composition, mood, art
// style, palette roles, top→lower zones) — not one of the two hardcoded
// templates. `hero` then compiles that layout into the text-to-image prompt via
// the pure compileLayoutPrompt(). Persists `poster_layout` + `design_status`.
// Auth-scoped. Best-effort: on failure it records design_status='failed' and
// hero falls back to a template prompt so the pipeline never hard-stops.
export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResponse({ error: 'method' }, 405);

  const baseUrl = env('INSFORGE_BASE_URL');
  const apiKey = env('API_KEY');
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
    .select('id, product_name, tagline, brand_essence, style_profile, poster_copy, poster_content, design_tokens, brand_assets')
    .eq('id', body.campaignId)
    .maybeSingle();
  if (cErr || !campaign) return jsonResponse({ error: 'campaign not found' }, 404);

  await client.database.from('campaigns').update({ design_status: 'generating' }).eq('id', campaign.id);

  const c = campaign as Record<string, unknown>;
  const product = String(c.product_name ?? 'the product');
  const tagline = String(c.tagline ?? '');
  const essence = String(c.brand_essence ?? '');
  const sp = (c.style_profile ?? {}) as { palette?: Record<string, string>; fonts?: Record<string, string>; tone?: string };
  const palette = sp.palette ?? {};
  const tokens = (c.design_tokens ?? null) as DesignTokens | null;
  const copy = (c.poster_copy ?? {}) as Record<string, unknown>;
  const content = (c.poster_content ?? {}) as Record<string, unknown>;
  const assets = (c.brand_assets ?? {}) as { logo_url?: string; primary_image_url?: string; images?: Array<{ url: string }> };
  const heroImg = assets.primary_image_url || assets.images?.[0]?.url || '';
  const hasLogo = !!assets.logo_url;

  // Palette hints: prefer the programmatic computed tokens, fall back to style_profile.
  const palHint = {
    bg: tokens?.colors.bg || palette.bg || '#ffffff',
    text: tokens?.colors.text || palette.text || '#111827',
    primary: tokens?.colors.primary || palette.primary || '#1f2937',
    accent: tokens?.colors.accent || palette.accent || '#10b981',
  };

  const features = Array.isArray(content.features) ? (content.features as string[]).slice(0, 6) : [];

  const sys =
    'You are an award-winning poster art director. Design a BESPOKE layout for a single PORTRAIT 2:3 product poster ' +
    'that fits THIS specific brand — not a generic template. Output STRICT JSON only (no prose, no code fences) ' +
    'matching this schema:\n' +
    '{"composition":"one phrase describing the overall composition (e.g. asymmetric, oversized hero top-left, diagonal flow)",' +
    '"mood":"2-4 words (e.g. editorial, calm, premium)",' +
    '"art_style":"the visual medium/treatment to render in (e.g. flat vector + soft gradients; bold risograph; 3D glass; hand-drawn)",' +
    '"palette_roles":{"bg":"#hex","surface":"#hex (optional card color)","text":"#hex","primary":"#hex","accent":"#hex"},' +
    '"zones":[{"band":"top|upper|mid|lower","role":"what this zone is, e.g. brand row / hero headline / feature grid / CTA",' +
    '"content":"the EXACT short words to render in this zone (English, concise)","emphasis":"low|med|high","align":"left|center|right"}]}\n' +
    'RULES: design 5-7 zones, ordered top→lower, to make the poster INFORMATION-DENSE and editorial — fill the canvas ' +
    'with substance (a brand row, a hero headline, a feature grid, a stats/proof row, product detail) rather than a few ' +
    'sparse elements. Use the band labels to place them: "top" (brand/logo row), "upper" (hero headline + key message), ' +
    '"mid" (features grid, stats, product detail — usually 2-3 zones here), "lower" (a final value prop or proof point). ' +
    'Keep every content string SHORT and legible. The palette_roles MUST use the real brand colors provided. ' +
    'This is a PRINTED POSTER IMAGE, not an app screen. ' +
    'CRITICAL: do NOT add a call-to-action / "Get started" / "Sign up" / "Join now" zone anywhere — the tracked QR ' +
    'footer bar (composited afterward) IS the call-to-action, so a CTA zone would be redundant. Use the "lower" zone ' +
    'for a closing value prop or proof point instead. ' +
    (hasLogo
      ? 'The brand has a real LOGO (a reference image is passed to the painter) — include a "top" brand-row zone whose role mentions the logo. '
      : '') +
    'Leave the BOTTOM ~26% of the poster empty — do NOT place any zone or text below ~74% down; the QR footer bar is ' +
    'composited there. The lowest zone sits around 60-73% down, never below ~74%.';

  const user =
    `PRODUCT: ${product}\n` +
    `TAGLINE: ${tagline || '(none)'}\n` +
    `BRAND ESSENCE (word-portrait for the art director): ${essence || '(none)'}\n` +
    `BRAND COLORS (use these for palette_roles): bg ${palHint.bg}, text ${palHint.text}, primary ${palHint.primary}, accent ${palHint.accent}\n` +
    `TONE: ${sp.tone || 'modern'}\n` +
    `HEADLINE: ${String(content.headline ?? copy.hook ?? product)}\n` +
    `WHAT IT DOES: ${String(content.what_it_does ?? copy.what_it_does ?? tagline)}\n` +
    (features.length ? `FEATURES (use for a feature grid): ${features.join(' · ')}\n` : '') +
    `\nASSETS:\n` +
    (hasLogo ? `LOGO: ${assets.logo_url} (the real logo is passed to the painter — plan a brand row for it)\n` : 'LOGO: (none found — use the product name as the brand mark)\n') +
    (heroImg ? `PRODUCT IMAGE: ${heroImg}\n` : '') +
    `\nDesign the poster layout JSON now (no CTA zone — the QR footer is the action).`;

  let layout;
  try {
    const raw = await aiChat(baseUrl, apiKey, [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ], { maxTokens: 1400 });
    layout = normalizePosterLayout(extractJson(raw), palHint);
  } catch {
    // One repair retry with a terse reminder, then give up (design_status=failed).
    try {
      const raw2 = await aiChat(baseUrl, apiKey, [
        { role: 'system', content: sys + ' Return ONLY valid minified JSON.' },
        { role: 'user', content: user },
      ], { maxTokens: 1400 });
      layout = normalizePosterLayout(extractJson(raw2), palHint);
    } catch (e) {
      await client.database
        .from('campaigns')
        .update({ design_status: 'failed' })
        .eq('id', campaign.id);
      await logTrace(client, {
        campaignId: campaign.id,
        userId,
        step: 'designer',
        status: 'failed',
        detail: 'layout design AI chat failed twice',
        request: { model: Deno.env.get('OPENROUTER_CHAT_MODEL') ?? 'openai/gpt-4o', system: sys, user },
        response: { error: e instanceof Error ? e.message : String(e) },
      });
      return jsonResponse({ error: `layout design failed: ${String(e)}` }, 502);
    }
  }

  const { error: upErr } = await client.database
    .from('campaigns')
    .update({ poster_layout: layout, design_status: 'ready' })
    .eq('id', campaign.id);
  if (upErr) {
    await client.database.from('campaigns').update({ design_status: 'failed' }).eq('id', campaign.id);
    await logTrace(client, {
      campaignId: campaign.id,
      userId,
      step: 'designer',
      status: 'failed',
      detail: 'campaign persist failed after layout design',
      response: { error: upErr.message },
    });
    return jsonResponse({ error: upErr.message }, 500);
  }

  // Return the real layout-agent prompt for the generation loading UI.
  return jsonResponse({ poster_layout: layout, prompt: { system: sys, user } });
}
