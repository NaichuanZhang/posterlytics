import {
  CORS,
  aiImage,
  errorDetails,
  fetchImageAsDataUrl,
  imageSourceToBlob,
  inlineImageReferences,
  inlineReferenceImages,
  jsonResponse,
  createUserClient,
  compileLayoutPrompt,
  logPipelineEvent,
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

  let body: { campaignId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad json' }, 400);
  }
  if (!body.campaignId) return jsonResponse({ error: 'missing campaignId' }, 400);

  const { data: campaign, error: cErr } = await client.database
    .from('campaigns')
    .select('id, product_name, tagline, style_profile, poster_spec, poster_content, poster_copy, brand_essence, poster_layout, brand_assets, scenario, event_details, hero_image_key, screenshot_url, reference_context, reference_images')
    .eq('id', body.campaignId)
    .maybeSingle();
  if (cErr || !campaign) return jsonResponse({ error: 'campaign not found' }, 404);

  // Event campaigns get their own promo-poster prompt; every product campaign
  // paints the designer layout (the fixed template modes were removed).
  const isEvent = (campaign as Record<string, unknown>).scenario === 'event';
  const style = isEvent ? 'event' : 'designer';

  // The real brand logo (if any) is passed to the image model as a reference so
  // it can paint the actual logo into the poster's brand row. References are
  // inlined as raster data URLs: the provider fetches plain URLs itself and
  // rejects our CDN's binary/octet-stream content type (and SVG logos outright),
  // which 400s the whole generation.
  const assets = ((campaign as Record<string, unknown>).brand_assets ?? {}) as {
    logo_url?: string;
    primary_image_url?: string;
    images?: Array<{ url?: string }>;
  };
  const userReferences = Array.isArray((campaign as Record<string, unknown>).reference_images)
    ? ((campaign as Record<string, unknown>).reference_images as Array<Record<string, unknown>>)
        .map((image) => typeof image.url === 'string' ? image.url : '')
        .filter(Boolean)
        .slice(0, 5)
    : [];
  let referenceImages: Array<TypedImageReference | string>;
  let hasLogo = false;
  let hasStyleBoard = false;
  if (isEvent) {
    // Preserve the historical event painter contract: logo first, then user
    // references, with no source-board or product-asset additions.
    const inlinedLogo = assets.logo_url ? await fetchImageAsDataUrl(assets.logo_url) : null;
    const inlinedRefs = await inlineReferenceImages(userReferences, { maxImages: 5 });
    if (assets.logo_url && !inlinedLogo) {
      logPipelineEvent({
        source: 'hero',
        campaignId: campaign.id,
        status: 'degraded',
        code: 'logo_reference_skipped',
        detail: 'Brand logo could not be inlined as a raster image (SVG or fetch failure); painting without it.',
      });
    }
    if (inlinedRefs.length < userReferences.length) {
      logPipelineEvent({
        source: 'hero',
        campaignId: campaign.id,
        status: 'degraded',
        code: 'reference_image_skipped',
        detail: `${userReferences.length - inlinedRefs.length} of ${userReferences.length} reference image(s) could not be inlined; painting with the rest.`,
      });
    }
    referenceImages = [...(inlinedLogo ? [inlinedLogo] : []), ...inlinedRefs].slice(0, 6);
    hasLogo = !!inlinedLogo;
  } else {
    const screenshotUrl = typeof (campaign as Record<string, unknown>).screenshot_url === 'string'
      ? String((campaign as Record<string, unknown>).screenshot_url)
      : '';
    const productUrls = [
      assets.primary_image_url,
      ...(assets.images ?? []).map((image) => image.url),
    ].filter((url): url is string => !!url);
    const candidates: TypedImageReference[] = [
      ...(screenshotUrl
        ? [{
            kind: 'style-board' as const,
            url: screenshotUrl,
            purpose: 'Primary source evidence: preserve page palette proportions, type character, imagery treatment, lighting, texture, motifs, hierarchy, and density.',
          }]
        : []),
      ...userReferences.map((url, index) => ({
        kind: 'user-reference' as const,
        url,
        purpose: `User-supplied creative reference ${index + 1}; use for requested subject or direction after honoring the source style board.`,
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
        purpose: `Authentic product or brand image ${index + 1}; use its real subject and visual details without turning the poster into a UI screenshot.`,
      })),
    ];
    const inlined = await inlineImageReferences(candidates, {
      maxImages: 6,
      maxCandidates: 12,
      maxTotalBytes: 12_000_000,
    });
    referenceImages = inlined;
    hasLogo = inlined.some((reference) => reference.kind === 'logo');
    hasStyleBoard = inlined.some((reference) => reference.kind === 'style-board');

    if (screenshotUrl && !hasStyleBoard) {
      logPipelineEvent({
        source: 'hero',
        campaignId: campaign.id,
        status: 'degraded',
        code: 'style_board_reference_skipped',
        detail: 'Style board could not be attached to the painter because it failed to inline or exceeded the six-image limit.',
      });
    }
    const attachedUsers = inlined.filter((reference) => reference.kind === 'user-reference').length;
    if (attachedUsers < userReferences.length) {
      logPipelineEvent({
        source: 'hero',
        campaignId: campaign.id,
        status: 'degraded',
        code: 'reference_image_skipped',
        detail: `${userReferences.length - attachedUsers} of ${userReferences.length} user reference image(s) could not be attached; painting with the ordered remainder.`,
      });
    }
    if (assets.logo_url && !hasLogo) {
      logPipelineEvent({
        source: 'hero',
        campaignId: campaign.id,
        status: 'degraded',
        code: 'logo_reference_skipped',
        detail: 'The authentic logo could not be attached or no capacity remained; the prompt forbids an invented symbol and uses the product name only.',
      });
    }
  }
  const prompt = buildPosterPrompt(
    campaign as Record<string, unknown>,
    style,
    hasLogo,
    hasStyleBoard,
  );

  // Request 2:3 explicitly — aspect ratio only, never provider pixel dimensions
  // (AiPoster shows the full image uncropped above the external QR footer).
  let imageSource: string;
  try {
    imageSource = await aiImage(prompt, '2:3', referenceImages);
  } catch (e) {
    logPipelineEvent({
      source: 'hero',
      campaignId: campaign.id,
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
      .upload(`poster/${campaign.id}/${crypto.randomUUID()}.png`, blob);
    if (error || !data) {
      logPipelineEvent({
        source: 'hero',
        campaignId: campaign.id,
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
    logPipelineEvent({
      source: 'hero',
      campaignId: campaign.id,
      status: 'failed',
      code: 'poster_upload_failed',
      detail: 'poster image upload threw',
      error: e,
    });
    return jsonResponse({ error: String(e) }, 500);
  }

  const { error: upErr } = await client.database
    .from('campaigns')
    .update({ hero_image_url: url, hero_image_key: key })
    .eq('id', campaign.id);
  if (upErr) {
    await client.storage.from('assets').remove(key).catch(() => {});
    logPipelineEvent({
      source: 'hero',
      campaignId: campaign.id,
      status: 'failed',
      code: 'campaign_persist_failed',
      detail: 'campaign persist failed after image generation',
      error: upErr,
    });
    return jsonResponse({ error: upErr.message }, 500);
  }
  const previousKey = String((campaign as Record<string, unknown>).hero_image_key ?? '');
  if (previousKey && previousKey !== key) {
    await client.storage.from('assets').remove(previousKey).catch(() => {});
  }

  // Return the compiled text-to-image prompt for the generation loading UI.
  return jsonResponse({ poster_image_url: url, prompt: { image: prompt } });
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
): string {
  const context = String(c.reference_context ?? '').trim().slice(0, 4000);
  const referenceCount = Array.isArray(c.reference_images) ? c.reference_images.length : 0;
  const referenceBlock =
    `\n\nUSER CREATIVE CONTEXT: ${context || '(none provided)'}` +
    `\n${referenceCount} user-supplied supporting image(s) accompany this prompt. Use them for subject, product, and visual direction fidelity.`;
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
