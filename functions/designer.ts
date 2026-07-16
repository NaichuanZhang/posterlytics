import {
  CORS,
  aiChat,
  errorDetails,
  ensurePosterLayoutZones,
  extractJson,
  inlineImageReferences,
  jsonResponse,
  createUserClient,
  normalizePosterLayout,
  normalizeStyleProfile,
  logPipelineEvent,
  userContentWithImageReferences,
  type DesignTokens,
  type TypedImageReference,
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
    .select('id, product_name, tagline, brand_essence, style_profile, poster_copy, poster_content, design_tokens, brand_assets, screenshot_url, reference_context, reference_images')
    .eq('id', body.campaignId)
    .maybeSingle();
  if (cErr || !campaign) return jsonResponse({ error: 'campaign not found' }, 404);

  await client.database.from('campaigns').update({ design_status: 'generating' }).eq('id', campaign.id);

  const c = campaign as Record<string, unknown>;
  const product = String(c.product_name ?? 'the product');
  const tagline = String(c.tagline ?? '');
  const essence = String(c.brand_essence ?? '');
  const sp = normalizeStyleProfile(c.style_profile);
  const palette = sp.palette;
  const tokens = (c.design_tokens ?? null) as DesignTokens | null;
  const copy = (c.poster_copy ?? {}) as Record<string, unknown>;
  const content = (c.poster_content ?? {}) as Record<string, unknown>;
  const assets = (c.brand_assets ?? {}) as { logo_url?: string; primary_image_url?: string; images?: Array<{ url: string }> };
  const heroImg = assets.primary_image_url || assets.images?.[0]?.url || '';
  const hasLogo = !!assets.logo_url;
  const referenceContext = String(c.reference_context ?? '').trim().slice(0, 4000);
  const referenceUrls = Array.isArray(c.reference_images)
    ? (c.reference_images as Array<Record<string, unknown>>)
        .map((image) => typeof image.url === 'string' ? image.url : '')
        .filter(Boolean)
        .slice(0, 5)
    : [];
  const visualCandidates: TypedImageReference[] = [
    ...(typeof c.screenshot_url === 'string' && c.screenshot_url
      ? [{
          kind: 'style-board' as const,
          url: c.screenshot_url,
          purpose: 'Primary source evidence: merged page viewports for observed palette proportions, typography, imagery, lighting, motifs, composition, and density.',
        }]
      : []),
    ...referenceUrls.map((url, index) => ({
      kind: 'user-reference' as const,
      url,
      purpose: `User-supplied creative reference ${index + 1}; secondary to the source style board.`,
    })),
  ];
  const visualReferences = await inlineImageReferences(visualCandidates, {
    maxImages: 6,
    maxCandidates: 6,
  });
  if (
    visualCandidates.some((reference) => reference.kind === 'style-board') &&
    !visualReferences.some((reference) => reference.kind === 'style-board')
  ) {
    logPipelineEvent({
      source: 'designer',
      campaignId: campaign.id,
      status: 'degraded',
      code: 'style_board_reference_skipped',
      detail: 'Stored style board could not be inlined for the layout designer.',
    });
  }
  const attachedUserReferences = visualReferences.filter(
    (reference) => reference.kind === 'user-reference',
  ).length;
  if (attachedUserReferences < referenceUrls.length) {
    logPipelineEvent({
      source: 'designer',
      campaignId: campaign.id,
      status: 'degraded',
      code: 'reference_image_skipped',
      detail: `${referenceUrls.length - attachedUserReferences} of ${referenceUrls.length} user reference image(s) could not be inlined for the layout designer.`,
    });
  }

  // Analyze already reconciles DOM roles, weighted pixels, and model output into
  // style_profile (including correcting a grayscale DOM "accent" from the pixel
  // palette). Keep raw tokens only as a legacy-row fallback here.
  const palHint = {
    bg: palette.bg || tokens?.colors.bg || '#ffffff',
    text: palette.text || tokens?.colors.text || '#111827',
    primary: palette.primary || tokens?.colors.primary || '#1f2937',
    accent: palette.accent || tokens?.colors.accent || '#10b981',
    secondary: palette.secondary,
    supporting: palette.supporting,
    proportions: tokens?.colors.visualPalette || palette.proportions,
  };

  const features = Array.isArray(content.features) ? (content.features as string[]).slice(0, 6) : [];
  const headline = String(content.headline ?? copy.hook ?? product);
  const whatItDoes = String(content.what_it_does ?? copy.what_it_does ?? tagline);
  const fallbackZones = [
    { band: 'top' as const, role: 'plain-text brand row', content: product, emphasis: 'low' as const },
    { band: 'upper' as const, role: 'hero headline', content: headline, emphasis: 'high' as const },
    {
      band: 'mid' as const,
      role: 'source-derived imagery focal area',
      content: whatItDoes,
      emphasis: 'med' as const,
    },
  ];

  const sys =
    'You are an award-winning poster art director. Design a BESPOKE PORTRAIT 2:3 product poster from observed ' +
    'source evidence, not category assumptions or a generic template. The first attached image, when present, is a ' +
    'multi-frame source STYLE BOARD and is the PRIMARY visual authority. Translate its palette proportions, type ' +
    'character, imagery, lighting, motifs, hierarchy, and density into a poster composition without copying its ' +
    'navigation or controls. Never pick a medium from a category stereotype; for example, a game is not automatically ' +
    'risograph. Output STRICT JSON only (no prose, no code fences) ' +
    'matching this schema:\n' +
    '{"composition":"one phrase describing the overall composition (e.g. asymmetric, oversized hero top-left, diagonal flow)",' +
    '"mood":"2-4 words (e.g. editorial, calm, premium)",' +
    '"art_style":"source-observed visual medium and treatment",' +
    '"imagery":"subject matter, crop, depth and image treatment","typography_treatment":"type character and hierarchy",' +
    '"lighting":"lighting and contrast","texture":"surface/material finish","motifs":["recurring observed motifs"],' +
    '"density":"sparse|balanced|dense",' +
    '"palette_roles":{"bg":"#hex","surface":"#hex optional","text":"#hex","primary":"#hex","accent":"#hex",' +
    '"secondary":"#hex optional","supporting":["#hex"],"proportions":[{"color":"#hex","proportion":0.0}]},' +
    '"zones":[{"band":"top|upper|mid|lower","role":"what this zone is, e.g. brand row / hero headline / product detail",' +
    '"content":"the EXACT short words to render in this zone (English, concise)","emphasis":"low|med|high","align":"left|center|right"}]}\n' +
    'RULES: design 3-7 zones ordered top→lower according to the SOURCE density and hierarchy: sparse sources get 3-4, ' +
    'balanced sources 4-5, and dense sources 5-7. Do not force a feature grid, stats row, icon set, or proof strip. Use ' +
    'those only when the observed source hierarchy and supplied copy support them. Preserve intentional negative space ' +
    'for sparse sources. Use the band labels to place the chosen zones across the full artwork. ' +
    'Keep every content string SHORT and legible. The palette_roles MUST use the real brand colors provided. ' +
    'Preserve color usage proportions: dominant neutrals remain dominant and small accents remain restrained. ' +
    'This is a PRINTED POSTER IMAGE, not an app screen. The four bands together fill the COMPLETE 2:3 frame. ' +
    'CRITICAL: do NOT add a call-to-action / "Get started" / "Sign up" / "Join now" zone anywhere — the tracked QR ' +
    'footer bar (printed separately below the artwork) IS the call-to-action, so a CTA zone would be redundant. ' +
    'Use the "lower" zone for a closing value prop or proof point instead. ' +
    (hasLogo
      ? 'The brand has a real LOGO (a reference image is passed to the painter) — include a "top" brand-row zone whose role mentions the logo. '
      : '');

  const user =
    `PRODUCT: ${product}\n` +
    `TAGLINE: ${tagline || '(none)'}\n` +
    `BRAND ESSENCE (word-portrait for the art director): ${essence || '(none)'}\n` +
    `BRAND COLORS (use these for palette_roles): bg ${palHint.bg}, text ${palHint.text}, primary ${palHint.primary}, accent ${palHint.accent}${palHint.secondary ? `, secondary ${palHint.secondary}` : ''}${palHint.supporting?.length ? `, supporting ${palHint.supporting.join(', ')}` : ''}\n` +
    `WEIGHTED COLOR USAGE: ${palHint.proportions?.length ? palHint.proportions.map((entry) => `${entry.color} ${(entry.proportion * 100).toFixed(1)}%`).join(', ') : '(not available)'}\n` +
    `SOURCE VISUAL OBSERVATIONS:\n` +
    `- Imagery: ${sp.imagery || '(read from the style board)'}\n` +
    `- Typography: ${sp.typography_treatment || `${sp.fonts.heading} headings / ${sp.fonts.body} body`}\n` +
    `- Lighting: ${sp.lighting || '(read from the style board)'}\n` +
    `- Texture: ${sp.texture || '(read from the style board)'}\n` +
    `- Motifs: ${sp.motifs?.join(', ') || '(none observed)'}\n` +
    `- Composition: ${sp.composition || sp.layout_hint || '(read from the style board)'}\n` +
    `- Density: ${sp.density || 'balanced'}\n` +
    `TONE: ${sp.tone || 'modern'}\n` +
    `HEADLINE: ${headline}\n` +
    `WHAT IT DOES: ${whatItDoes}\n` +
    (features.length ? `AVAILABLE SUPPORTING COPY (select only what the hierarchy needs): ${features.join(' · ')}\n` : '') +
    `\nASSETS:\n` +
    (hasLogo ? `LOGO: ${assets.logo_url} (the real logo is passed to the painter — plan a brand row for it)\n` : 'LOGO: (none found — use the product name as the brand mark)\n') +
    (heroImg ? `PRODUCT IMAGE: ${heroImg}\n` : '') +
    `CREATIVE CONTEXT: ${referenceContext || '(none provided)'}\n` +
    `ATTACHED VISUAL EVIDENCE: ${visualReferences.length} image(s); style board first, then user references.\n` +
    `\nDesign the poster layout JSON now (no CTA zone — the QR footer is the action).`;
  const userContent = userContentWithImageReferences(user, visualReferences, 6);

  let layout;
  try {
    const raw = await aiChat([
      { role: 'system', content: sys },
      { role: 'user', content: userContent },
    ], { maxTokens: 1800 });
    layout = ensurePosterLayoutZones(
      normalizePosterLayout(extractJson(raw), palHint, sp),
      fallbackZones,
    );
  } catch {
    // One repair retry with a terse reminder, then give up (design_status=failed).
    try {
      const raw2 = await aiChat([
        { role: 'system', content: sys + ' Return ONLY valid minified JSON.' },
        { role: 'user', content: userContent },
      ], { maxTokens: 1800 });
      layout = ensurePosterLayoutZones(
        normalizePosterLayout(extractJson(raw2), palHint, sp),
        fallbackZones,
      );
    } catch (e) {
      await client.database
        .from('campaigns')
        .update({ design_status: 'failed' })
        .eq('id', campaign.id);
      logPipelineEvent({
        source: 'designer',
        campaignId: campaign.id,
        status: 'failed',
        code: 'layout_ai_failed',
        detail: 'layout design AI chat failed twice',
        error: e,
      });
      const details = errorDetails(e);
      return jsonResponse({ error: details.message, code: details.code, retryable: details.retryable }, 502);
    }
  }

  const { error: upErr } = await client.database
    .from('campaigns')
    .update({ poster_layout: layout, design_status: 'ready' })
    .eq('id', campaign.id);
  if (upErr) {
    await client.database.from('campaigns').update({ design_status: 'failed' }).eq('id', campaign.id);
    logPipelineEvent({
      source: 'designer',
      campaignId: campaign.id,
      status: 'failed',
      code: 'campaign_persist_failed',
      detail: 'campaign persist failed after layout design',
      error: upErr,
    });
    return jsonResponse({ error: upErr.message }, 500);
  }

  // Return the real layout-agent prompt for the generation loading UI.
  return jsonResponse({ poster_layout: layout, prompt: { system: sys, user } });
}
