import {
  CORS,
  aiImage,
  buildParentContextPrompt,
  errorDetails,
  imageSourceToBlob,
  inlineImageReferences,
  jsonResponse,
  createUserClient,
  compileLayoutPrompt,
  logPipelineEvent,
  markGenerationFailed,
  type PosterLayout,
  type TypedImageReference,
} from './_shared.ts';

// `hero` renders the poster (2:3) as a single AI image. Products compile the
// LLM-designed poster_layout (produced by the `designer` agent) into the prompt
// via the pure compileLayoutPrompt(); events use their own bespoke event prompt.
// The image model gets a compiled prompt plus bounded visual references. The
// artwork fills its complete 2:3 frame — the SPA shows it uncropped on an A4
// sheet with the QR footer composited OUTSIDE the artwork. Stored in the public
// assets bucket.
export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResponse({ error: 'method' }, 405);

  const client = createUserClient(req);

  const { data: userData } = await client.auth.getCurrentUser();
  if (!userData?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: { campaignId?: string; generationId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad json' }, 400);
  }
  if (!body.campaignId || !body.generationId) {
    return jsonResponse({ error: 'missing campaignId or generationId' }, 400);
  }

  const { data: campaign, error: cErr } = await client.database
    .from('campaigns')
    .select('id, product_name, tagline')
    .eq('id', body.campaignId)
    .maybeSingle();
  if (cErr || !campaign) return jsonResponse({ error: 'campaign not found' }, 404);

  const { data: generation, error: generationError } = await client.database
    .from('poster_generations')
    .select('id, campaign_id, parent_generation_id, generation_mode, instruction, reference_images, style_profile, poster_spec, poster_content, poster_copy, brand_essence, poster_layout, brand_assets, scenario, event_details, screenshot_url, design_status')
    .eq('id', body.generationId)
    .eq('campaign_id', campaign.id)
    .maybeSingle();
  if (generationError || !generation) {
    return jsonResponse({ error: 'poster generation not found' }, 404);
  }

  const parentId = String((generation as Record<string, unknown>).parent_generation_id ?? '');
  const { data: parent } = parentId
    ? await client.database
        .from('poster_generations')
        .select('id, poster_layout, hero_image_url')
        .eq('id', parentId)
        .eq('campaign_id', campaign.id)
        .eq('status', 'ready')
        .maybeSingle()
    : { data: null };

  const { error: stageError } = await client.database
    .from('poster_generations')
    .update({ status: 'painting' })
    .eq('id', generation.id);
  if (stageError) {
    await markGenerationFailed(client, generation.id, 'hero', stageError, 'stage_transition_failed');
    return jsonResponse({ error: stageError.message }, 409);
  }

  const generationSnapshot = {
    ...(generation as Record<string, unknown>),
    ...(campaign as Record<string, unknown>),
  };

  // Event campaigns get their own promo-poster prompt; every product campaign
  // paints the designer layout (the fixed template modes were removed).
  const isEvent = generationSnapshot.scenario === 'event';
  const style = isEvent ? 'event' : 'designer';

  // The real brand logo (if any) is passed to the image model as a reference so
  // it can paint the actual logo into the poster's brand row. References are
  // inlined as raster data URLs: the provider fetches plain URLs itself and
  // rejects our CDN's binary/octet-stream content type (and SVG logos outright),
  // which 400s the whole generation.
  const assets = (generationSnapshot.brand_assets ?? {}) as {
    logo_url?: string;
    primary_image_url?: string;
    images?: Array<{ url?: string }>;
  };
  const userReferences = Array.isArray(generationSnapshot.reference_images)
    ? (generationSnapshot.reference_images as Array<Record<string, unknown>>)
        .map((image) => typeof image.url === 'string' ? image.url : '')
        .filter(Boolean)
        .slice(0, 5)
    : [];
  const previousPosterUrl = typeof (parent as Record<string, unknown> | null)?.hero_image_url === 'string'
    ? String((parent as Record<string, unknown>).hero_image_url)
    : '';
  const screenshotUrl = typeof generationSnapshot.screenshot_url === 'string'
    ? String(generationSnapshot.screenshot_url)
    : '';
  const productUrls = isEvent
    ? []
    : [
        assets.primary_image_url,
        ...(assets.images ?? []).map((image) => image.url),
      ].filter((url): url is string => !!url);
  const candidates: TypedImageReference[] = [
    ...(previousPosterUrl
      ? [{
          kind: 'previous-poster' as const,
          url: previousPosterUrl,
          purpose: 'Primary edit source: keep every visual choice that the user did not explicitly ask to change.',
        }]
      : []),
    ...userReferences.map((url, index) => ({
      kind: 'user-reference' as const,
      url,
      purpose: `New supporting image ${index + 1}; use it only for the requested change while preserving the parent poster.`,
    })),
    ...(assets.logo_url
      ? [{
          kind: 'logo' as const,
          url: assets.logo_url,
          purpose: 'Authentic brand logo; reproduce faithfully only if this reference remains attached.',
        }]
      : []),
    ...productUrls.map((url, index) => ({
      kind: 'product' as const,
      url,
      purpose: `Authentic product or brand image ${index + 1}; preserve its real subject and visual details.`,
    })),
    ...(!isEvent && screenshotUrl
      ? [{
          kind: 'style-board' as const,
          url: screenshotUrl,
          purpose: 'Supporting source evidence for palette, typography, imagery treatment, lighting, texture, motifs, and density.',
        }]
      : []),
  ];
  const referenceImages = await inlineImageReferences(candidates, {
    maxImages: 6,
    maxCandidates: 14,
    maxTotalBytes: 12_000_000,
    ordering: 'painter',
  });
  const hasLogo = referenceImages.some((reference) => reference.kind === 'logo');
  const hasStyleBoard = referenceImages.some((reference) => reference.kind === 'style-board');

  const attachedUsers = referenceImages.filter((reference) => reference.kind === 'user-reference').length;
  if (attachedUsers < userReferences.length) {
    logPipelineEvent({
      source: 'hero',
      campaignId: campaign.id,
      generationId: generation.id,
      status: 'degraded',
      code: 'reference_image_skipped',
      detail: `${userReferences.length - attachedUsers} of ${userReferences.length} new reference image(s) could not be attached; painting with the ordered remainder.`,
    });
  }
  if (assets.logo_url && !hasLogo) {
    logPipelineEvent({
      source: 'hero',
      campaignId: campaign.id,
      generationId: generation.id,
      status: 'degraded',
      code: 'logo_reference_skipped',
      detail: 'The authentic logo could not be attached or no capacity remained; the prompt forbids an invented symbol.',
    });
  }
  if (!isEvent && screenshotUrl && !hasStyleBoard) {
    logPipelineEvent({
      source: 'hero',
      campaignId: campaign.id,
      generationId: generation.id,
      status: 'degraded',
      code: 'style_board_reference_skipped',
      detail: 'The style board could not be attached or fell beyond the six-image painter limit.',
    });
  }
  const prompt = buildPosterPrompt(
    generationSnapshot,
    style,
    hasLogo,
    hasStyleBoard,
    ((parent as Record<string, unknown> | null)?.poster_layout ?? null) as PosterLayout | null,
    !!previousPosterUrl,
  );

  // Request 2:3 explicitly — aspect ratio only, never provider pixel dimensions
  // (AiPoster shows the full image uncropped above the external QR footer).
  let imageSource: string;
  try {
    imageSource = await aiImage(prompt, '2:3', referenceImages);
  } catch (e) {
    await markGenerationFailed(client, generation.id, 'hero', e, 'image_generation_failed');
    logPipelineEvent({
      source: 'hero',
      campaignId: campaign.id,
      generationId: generation.id,
      status: 'failed',
      code: 'image_generation_failed',
      detail: 'AI image generation failed',
      error: e,
    });
    const details = errorDetails(e);
    return jsonResponse({ error: details.message, code: details.code, retryable: details.retryable }, 502);
  }

  let url: string;
  let key: string;
  try {
    const blob = await imageSourceToBlob(imageSource);
    const { data, error } = await client.storage
      .from('assets')
      .upload(`poster/${campaign.id}/${generation.id}/${crypto.randomUUID()}.png`, blob);
    if (error || !data) {
      await markGenerationFailed(
        client,
        generation.id,
        'hero',
        error?.message ?? 'upload failed',
        'poster_upload_failed',
      );
      logPipelineEvent({
        source: 'hero',
        campaignId: campaign.id,
        generationId: generation.id,
        status: 'failed',
        code: 'poster_upload_failed',
        detail: 'poster image upload failed',
        error: error?.message ?? 'upload failed',
      });
      return jsonResponse({ error: error?.message ?? 'upload failed' }, 500);
    }
    url = data.url;
    key = data.key;
  } catch (e) {
    await markGenerationFailed(client, generation.id, 'hero', e, 'poster_upload_failed');
    logPipelineEvent({
      source: 'hero',
      campaignId: campaign.id,
      generationId: generation.id,
      status: 'failed',
      code: 'poster_upload_failed',
      detail: 'poster image upload threw',
      error: e,
    });
    return jsonResponse({ error: String(e) }, 500);
  }

  const { data: completedGeneration, error: completeError } = await client.database
    .rpc('complete_poster_generation', {
      p_generation_id: generation.id,
      p_hero_image_url: url,
      p_hero_image_key: key,
    });
  if (completeError) {
    await client.storage.from('assets').remove(key).catch(() => {});
    await markGenerationFailed(
      client,
      generation.id,
      'complete',
      completeError,
      'generation_completion_failed',
    );
    logPipelineEvent({
      source: 'hero',
      campaignId: campaign.id,
      generationId: generation.id,
      status: 'failed',
      code: 'generation_completion_failed',
      detail: 'atomic generation completion failed after image generation',
      error: completeError,
    });
    return jsonResponse({ error: completeError.message }, 500);
  }

  // Return the compiled text-to-image prompt for the generation loading UI.
  return jsonResponse({
    poster_image_url: url,
    generation: completedGeneration,
    prompt: { image: prompt },
  });
}

// Dispatch: events get the event promo prompt; products compile the
// LLM-designed poster_layout. If the layout is missing (designer step failed /
// not yet run), fall back to a minimal generic editorial layout compiled from
// the same brand context, so hero never hard-fails.
function buildPosterPrompt(
  c: Record<string, unknown>,
  style: string,
  hasLogo: boolean,
  hasStyleBoard = false,
  parentLayout: PosterLayout | null = null,
  hasPreviousPoster = false,
): string {
  const instruction = String(c.instruction ?? '').trim().slice(0, 4000);
  const referenceCount = Array.isArray(c.reference_images) ? c.reference_images.length : 0;
  const parentContext = buildParentContextPrompt({
    instruction,
    parentLayout,
    hasPreviousPoster,
    refreshWebsite: c.generation_mode === 'website_refresh',
  });
  const referenceBlock =
    `\n\n${parentContext}` +
    `\n${referenceCount} new supporting image(s) accompany this prompt. Use them only for the requested delta.`;
  if (style === 'event') return buildEventPrompt(c, hasLogo) + referenceBlock;
  const layout = c.poster_layout as PosterLayout | null;
  const ctx = {
    product: String(c.product_name ?? 'the product'),
    essence: String(c.brand_essence ?? ''),
    hasLogo,
    hasStyleBoard,
  };
  if (layout && Array.isArray(layout.zones) && layout.zones.length > 0) {
    return compileLayoutPrompt(layout, ctx) + referenceBlock;
  }
  return compileLayoutPrompt(fallbackLayout(c), ctx) + referenceBlock;
}

// A safe generic layout for when poster_layout is absent (designer failed or
// hasn't run). Same compileLayoutPrompt machinery, seeded from poster_content /
// poster_copy + the style_profile palette, so the poster still ships on-brand.
function fallbackLayout(c: Record<string, unknown>): PosterLayout {
  const product = String(c.product_name ?? 'the product');
  const content = (c.poster_content ?? {}) as Record<string, unknown>;
  const copy = (c.poster_copy ?? {}) as Record<string, unknown>;
  const sp = (c.style_profile ?? {}) as {
    palette?: {
      bg?: string;
      text?: string;
      primary?: string;
      accent?: string;
      secondary?: string;
      supporting?: string[];
      proportions?: Array<{ color: string; proportion: number }>;
    };
    imagery?: string;
    typography_treatment?: string;
    lighting?: string;
    texture?: string;
    motifs?: string[];
    density?: 'sparse' | 'balanced' | 'dense';
  };
  const pal = sp.palette ?? {};
  const headline = String(content.headline ?? copy.hook ?? product);
  const what = String(content.what_it_does ?? copy.what_it_does ?? c.tagline ?? '');
  const features = (Array.isArray(content.features) ? (content.features as string[]) : []).slice(0, 4);
  return {
    composition: 'balanced vertical editorial flow, oversized hero headline, clear hierarchy',
    mood: 'modern, clean, professional',
    art_style: sp.texture || 'source-faithful editorial graphic design',
    ...(sp.imagery ? { imagery: sp.imagery } : {}),
    ...(sp.typography_treatment ? { typography_treatment: sp.typography_treatment } : {}),
    ...(sp.lighting ? { lighting: sp.lighting } : {}),
    ...(sp.texture ? { texture: sp.texture } : {}),
    ...(sp.motifs?.length ? { motifs: sp.motifs } : {}),
    density: sp.density || 'balanced',
    palette_roles: {
      bg: pal.bg || '#ffffff',
      text: pal.text || '#111827',
      primary: pal.primary || '#1f2937',
      accent: pal.accent || '#10b981',
      ...(pal.secondary ? { secondary: pal.secondary } : {}),
      ...(pal.supporting?.length ? { supporting: pal.supporting } : {}),
      ...(pal.proportions?.length ? { proportions: pal.proportions } : {}),
    },
    zones: [
      { band: 'top', role: 'brand row', content: product, emphasis: 'low' },
      { band: 'upper', role: 'hero headline', content: headline, emphasis: 'high' },
      ...(what ? [{ band: 'mid' as const, role: 'supporting product detail', content: what, emphasis: 'med' as const }] : []),
      ...(!what
        ? [{ band: 'mid' as const, role: 'source-derived imagery focal area', content: '', emphasis: 'med' as const }]
        : []),
      ...(features.length
        ? [{ band: 'lower' as const, role: 'feature row', content: features.join(' · '), emphasis: 'low' as const }]
        : []),
    ],
  };
}

// Compose the text-to-image prompt for an EVENT promo poster (2:3). The exact
// date/time/location are rendered as REAL text by the SPA (AiPoster's footer,
// outside the artwork), NOT by the image model — so this prompt paints only the
// ATMOSPHERE + event title + host, filling the complete 2:3 frame.
function buildEventPrompt(c: Record<string, unknown>, hasLogo = false): string {
  const spec = (c.poster_spec ?? {}) as {
    title?: string; hook?: string; blurb?: string; host_line?: string;
  } & Record<string, unknown>;
  const essence = String(c.brand_essence ?? '');
  const title = String((spec.title as string) || c.product_name || 'the event');
  const hook = String((c.poster_spec as { hook?: string })?.hook ?? '');
  const hostLine = String(spec.host_line ?? '');
  const sp = (c.style_profile ?? {}) as { palette?: Record<string, string> };
  const primary = sp.palette?.primary || '#1f2937';
  const accent = sp.palette?.accent || '#e8633a';
  const logoLine = hasLogo
    ? '\nA reference image of the host/brand LOGO is provided — reproduce it faithfully (exact shape and colors) in the top brand area; do not redraw or distort it.\n'
    : '';

  return `Create a single PORTRAIT 2:3 EVENT PROMOTION poster — an inviting, high-energy real-world event flyer
(the kind pinned to a bulletin board or shared as a story). Bold, editorial, atmospheric. NOT a product/SaaS mockup,
NOT a web UI.

Honor this event's identity — infuse its palette, mood, and motif; do not invent an unrelated corporate look:
${essence || title}
Use ${primary} as the dominant color and ${accent} as the vivid accent (headline emphasis, shapes, glow). Stay within
this palette plus neutrals. If the brand is monochrome, add tasteful ${accent} accents as the only vivid color.
${logoLine}
CRITICAL: the ONLY words rendered anywhere on the poster are the exact quoted strings below, all in ENGLISH. Do NOT
print any layout/section descriptions, position words, or instruction words as visible text.

Arrange it top to bottom:

- Upper area: the EVENT TITLE as an oversized, bold, celebratory display headline reading "${title}" — the dominant
  visual element, with expressive typography and decorative accents around it.
${hook ? `- Just below the title, a short punchy hook line reading "${hook}".` : ''}
${hostLine ? `- A small host/presenter line reading "${hostLine}".` : ''}
- Middle and lower: rich atmospheric illustration evoking the event's theme and energy (people gathering, venue mood,
  motifs from the brand essence), filling the frame all the way to the bottom edge — make it feel exciting and
  specific, not generic clip-art.

Do NOT paint any date, time, address, QR code, or barcode yourself — the real date/time/location and a scannable QR
are printed separately below the artwork as crisp real text.

All rendered text must be crisp, correctly spelled, legible, ENGLISH only, and limited to the quoted strings above.
High quality, sharp, 8k, atmospheric event-poster art direction.
Avoid: product/app UI mockups, painted buttons/pills, any QR/barcode drawn by you, any painted date/time/address,
garbled or misspelled text, non-English text, and watermarks.`;
}
