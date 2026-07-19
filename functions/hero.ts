import {
  CORS,
  aiImage,
  buildTraceContentManifest,
  buildParentContextPrompt,
  errorDetails,
  imageGenerationContent,
  imageSourceToBlob,
  jsonResponse,
  createUserClient,
  compileLayoutPrompt,
  DEFAULT_POSTER_SIZE,
  getPosterFrameLabel,
  getPosterSize,
  hasPosterQrBand,
  loadFrozenGenerationImageReferences,
  logPipelineEvent,
  markGenerationFailed,
  prepareImageReferences,
  recordGenerationAssetProviderSkips,
  resolvedImageModelId,
  stageAlreadySucceeded,
  StageTraceRecorder,
  type GenerationStageRunContext,
  type PosterLayout,
  type PosterSize,
  type TypedImageReference,
} from './_shared.ts';

// `hero` renders the registered artwork frame as a single AI image. Products
// compile the LLM-designed poster_layout (produced by the `designer` agent) into
// the prompt via the pure compileLayoutPrompt(); events use their own bespoke
// event prompt.
// The image model gets a compiled prompt plus bounded visual references. The
// artwork fills its complete frame; the SPA shows it uncropped on the registered
// output sheet and adds a QR footer only when the descriptor requests one.
// Stored in the public assets bucket.
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

  try {
    return await runHeroStage({
      client,
      userId: userData.user.id,
      campaignId: body.campaignId,
      generationId: body.generationId,
      finalizeFailure: true,
      serverOwned: false,
    });
  } catch (error) {
    const details = errorDetails(error);
    await markGenerationFailed(
      client,
      body.generationId,
      'hero',
      error,
      details.code,
      userData.user.id,
    );
    return jsonResponse(
      { error: details.message, code: details.code, retryable: details.retryable },
      details.upstream_status ?? 500,
    );
  }
}

export async function runHeroStage(
  context: GenerationStageRunContext,
): Promise<Response> {
  const {
    client,
    userId,
    campaignId,
    generationId,
    finalizeFailure,
    serverOwned,
  } = context;

  const { data: campaign, error: cErr } = await client.database
    .from('campaigns')
    .select('id, product_name, tagline')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .maybeSingle();
  if (cErr || !campaign) return jsonResponse({ error: 'campaign not found' }, 404);

  const { data: generation, error: generationError } = await client.database
    .from('poster_generations')
    .select('id, campaign_id, status, parent_generation_id, generation_mode, instruction, reference_images, poster_format, style_profile, poster_spec, poster_content, poster_copy, brand_essence, poster_layout, brand_assets, scenario, event_details, screenshot_url, screenshot_key, design_status, hero_image_url, hero_image_key, trace_schema_version, asset_selection_status')
    .eq('id', generationId)
    .eq('campaign_id', campaign.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (generationError || !generation) {
    return jsonResponse({ error: 'poster generation not found' }, 404);
  }
  const generationStatus = String((generation as Record<string, unknown>).status ?? '');
  if (generationStatus === 'failed') {
    return jsonResponse({ error: 'poster generation already failed' }, 409);
  }
  if (generationStatus === 'ready' || await stageAlreadySucceeded(context, 'hero')) {
    return jsonResponse({
      generation_id: generation.id,
      poster_image_url: (generation as Record<string, unknown>).hero_image_url ?? null,
      idempotent: true,
    });
  }

  const parentId = String((generation as Record<string, unknown>).parent_generation_id ?? '');
  const { data: parent } = parentId
    ? await client.database
        .from('poster_generations')
        .select('id, poster_format, poster_layout, hero_image_url, hero_image_key')
        .eq('id', parentId)
        .eq('campaign_id', campaign.id)
        .eq('user_id', userId)
        .eq('status', 'ready')
        .maybeSingle()
    : { data: null };

  const { error: stageError } = await client.database
    .from('poster_generations')
    .update({ status: 'painting' })
    .eq('id', generation.id)
    .eq('user_id', userId);
  if (stageError) {
    if (finalizeFailure) {
      await markGenerationFailed(
        client,
        generation.id,
        'hero',
        stageError,
        'stage_transition_failed',
        userId,
      );
    }
    return jsonResponse({ error: stageError.message }, 409);
  }
  const trace = new StageTraceRecorder(client, {
    generationId: String(generation.id),
    campaignId: String(campaign.id),
    userId,
    stage: 'hero',
  });
  await trace.start();

  const generationSnapshot = {
    ...(generation as Record<string, unknown>),
    ...(campaign as Record<string, unknown>),
  };
  const posterSize = getPosterSize(
    (generation as Record<string, unknown>).poster_format,
  );
  const parentPosterSize = parent
    ? getPosterSize((parent as Record<string, unknown>).poster_format)
    : null;

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
    logo_key?: string;
    primary_image_url?: string;
    images?: Array<{ url?: string; key?: string }>;
  };
  const userReferences = Array.isArray(generationSnapshot.reference_images)
    ? (generationSnapshot.reference_images as Array<Record<string, unknown>>)
        .filter((image) => typeof image.url === 'string' && image.url)
        .slice(0, 5)
    : [];
  const previousPosterUrl = typeof (parent as Record<string, unknown> | null)?.hero_image_url === 'string'
    ? String((parent as Record<string, unknown>).hero_image_url)
    : '';
  const screenshotUrl = typeof generationSnapshot.screenshot_url === 'string'
    ? String(generationSnapshot.screenshot_url)
    : '';
  const productImages = isEvent
    ? []
    : [
        ...(assets.primary_image_url
          ? [{
              url: assets.primary_image_url,
              key: assets.images?.find((image) => image.url === assets.primary_image_url)?.key,
            }]
          : []),
        ...(assets.images ?? []).filter(
          (image): image is { url: string; key?: string } => !!image.url,
        ),
      ];
  const legacyCandidates: TypedImageReference[] = [
    ...(previousPosterUrl
      ? [{
          kind: 'previous-poster' as const,
          url: previousPosterUrl,
          key: typeof (parent as Record<string, unknown> | null)?.hero_image_key === 'string'
            ? String((parent as Record<string, unknown>).hero_image_key)
            : undefined,
          filename: 'Previous poster',
          storageSource: 'poster-version',
          purpose: 'Primary edit source: keep every visual choice that the user did not explicitly ask to change.',
        }]
      : []),
    ...userReferences.map((image, index) => ({
      kind: 'user-reference' as const,
      url: String(image.url),
      key: typeof image.key === 'string' ? image.key : undefined,
      filename: typeof image.name === 'string' ? image.name : `Supporting image ${index + 1}`,
      mimeType: typeof image.mime_type === 'string' ? image.mime_type : undefined,
      sizeBytes: typeof image.size_bytes === 'number' ? image.size_bytes : undefined,
      storageSource: 'user-upload',
      purpose: `New supporting image ${index + 1}; use it only for the requested change while preserving the parent poster.`,
    })),
    ...(assets.logo_url
      ? [{
          kind: 'logo' as const,
          url: assets.logo_url,
          key: assets.logo_key,
          filename: 'Brand logo',
          storageSource: 'website-asset',
          purpose: 'Authentic brand logo; reproduce faithfully only if this reference remains attached.',
        }]
      : []),
    ...productImages.map((image, index) => ({
      kind: 'product' as const,
      url: image.url,
      key: image.key,
      filename: `Product image ${index + 1}`,
      storageSource: 'website-asset',
      purpose: `Authentic product or brand image ${index + 1}; preserve its real subject and visual details.`,
    })),
    ...(!isEvent && screenshotUrl
      ? [{
          kind: 'style-board' as const,
          url: screenshotUrl,
          key: typeof generationSnapshot.screenshot_key === 'string'
            ? String(generationSnapshot.screenshot_key)
            : undefined,
          filename: 'Website style board',
          storageSource: 'website-capture',
          purpose: 'Supporting source evidence for palette, typography, imagery treatment, lighting, texture, motifs, and density.',
        }]
      : []),
  ];
  const usesFrozenAssets = generationSnapshot.trace_schema_version === 2;
  if (usesFrozenAssets && generationSnapshot.asset_selection_status !== 'completed') {
    return jsonResponse({ error: 'generation assets have not been confirmed' }, 409);
  }
  const candidates = usesFrozenAssets
    ? await loadFrozenGenerationImageReferences(context)
    : legacyCandidates;
  const preparedImages = await prepareImageReferences(candidates, {
    maxImages: 6,
    maxCandidates: usesFrozenAssets ? 6 : 14,
    maxTotalBytes: 12_000_000,
    ordering: usesFrozenAssets ? 'preserve' : 'painter',
  });
  if (usesFrozenAssets) {
    await recordGenerationAssetProviderSkips(
      context,
      'hero',
      preparedImages.skippedImages,
    );
  }
  await trace.setImages(preparedImages);
  const referenceImages = preparedImages.providerReferences;
  const hasLogo = referenceImages.some((reference) => reference.kind === 'logo');
  const hasStyleBoard = referenceImages.some((reference) => reference.kind === 'style-board');

  const expectedUsers = usesFrozenAssets
    ? candidates.filter((reference) => reference.kind === 'user-reference').length
    : userReferences.length;
  const attachedUsers = referenceImages.filter((reference) => reference.kind === 'user-reference').length;
  if (attachedUsers < expectedUsers) {
    logPipelineEvent({
      source: 'hero',
      campaignId: campaign.id,
      generationId: generation.id,
      status: 'degraded',
      code: 'reference_image_skipped',
      detail: `${expectedUsers - attachedUsers} of ${expectedUsers} selected user reference image(s) could not be attached; painting with the ordered remainder.`,
    });
  }
  if (candidates.some((reference) => reference.kind === 'logo') && !hasLogo) {
    logPipelineEvent({
      source: 'hero',
      campaignId: campaign.id,
      generationId: generation.id,
      status: 'degraded',
      code: 'logo_reference_skipped',
      detail: 'The authentic logo could not be attached or no capacity remained; the prompt forbids an invented symbol.',
    });
  }
  if (candidates.some((reference) => reference.kind === 'style-board') && !hasStyleBoard) {
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
    {
      ...generationSnapshot,
      reference_images: referenceImages.filter(
        (reference) => reference.kind === 'user-reference',
      ),
    },
    style,
    hasLogo,
    hasStyleBoard,
    ((parent as Record<string, unknown> | null)?.poster_layout ?? null) as PosterLayout | null,
    referenceImages.some((reference) => reference.kind === 'previous-poster'),
    posterSize,
    parentPosterSize,
  );

  // Request the registered ratio explicitly, never provider pixel dimensions.
  // AiPoster shows the full generated frame without cropping.
  let imageSource: string;
  try {
    const messages = [{
      role: 'user',
      content: imageGenerationContent(
        prompt,
        referenceImages,
        6,
        usesFrozenAssets ? 'preserve' : 'painter',
      ),
    }];
    imageSource = await trace.runModelCall(
      {
        operation: 'image',
        modelId: resolvedImageModelId(),
        prompt: { image: prompt },
        providerSettings: {
          modalities: ['image', 'text'],
          image_config: { aspect_ratio: posterSize.providerAspectRatio },
          timeout_ms: 90_000,
        },
        contentManifest: buildTraceContentManifest(messages, preparedImages.attachedImages),
      },
      () => aiImage(
        prompt,
        posterSize.providerAspectRatio,
        referenceImages,
        usesFrozenAssets ? 'preserve' : 'painter',
      ),
    );
  } catch (e) {
    if (finalizeFailure) {
      await trace.fail(e, 'image_generation_failed');
      await markGenerationFailed(
        client,
        generation.id,
        'hero',
        e,
        'image_generation_failed',
        userId,
      );
    }
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
  let posterMimeType = 'image/png';
  let posterSizeBytes = 0;
  try {
    const blob = await imageSourceToBlob(imageSource);
    posterMimeType = blob.type || posterMimeType;
    posterSizeBytes = blob.size;
    const posterKey = `poster/${campaign.id}/${generation.id}/poster.png`;
    await client.storage.from('assets').remove(posterKey).catch(() => {});
    const { data, error } = await client.storage
      .from('assets')
      .upload(posterKey, blob);
    if (error || !data) {
      if (finalizeFailure) {
        await trace.fail(error?.message ?? 'upload failed', 'poster_upload_failed');
        await markGenerationFailed(
          client,
          generation.id,
          'hero',
          error?.message ?? 'upload failed',
          'poster_upload_failed',
          userId,
        );
      }
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
    if (finalizeFailure) {
      await trace.fail(e, 'poster_upload_failed');
      await markGenerationFailed(
        client,
        generation.id,
        'hero',
        e,
        'poster_upload_failed',
        userId,
      );
    }
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
  await trace.addArtifact({
    kind: 'poster',
    url,
    key,
    mime_type: posterMimeType,
    size_bytes: posterSizeBytes,
  });

  const completionRpc = serverOwned
    ? client.database.rpc('complete_poster_generation_for_worker', {
        p_generation_id: generation.id,
        p_user_id: userId,
        p_hero_image_url: url,
        p_hero_image_key: key,
      })
    : client.database.rpc('complete_poster_generation', {
        p_generation_id: generation.id,
        p_hero_image_url: url,
        p_hero_image_key: key,
      });
  const { data: completedGeneration, error: completeError } = await completionRpc;
  if (completeError) {
    await client.storage.from('assets').remove(key).catch(() => {});
    if (finalizeFailure) {
      await trace.fail(completeError, 'generation_completion_failed');
      await markGenerationFailed(
        client,
        generation.id,
        'complete',
        completeError,
        'generation_completion_failed',
        userId,
      );
    }
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
  await trace.succeed();

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
  posterSize: PosterSize = DEFAULT_POSTER_SIZE,
  parentPosterSize: PosterSize | null = null,
): string {
  const instruction = String(c.instruction ?? '').trim().slice(0, 4000);
  const referenceCount = Array.isArray(c.reference_images) ? c.reference_images.length : 0;
  const parentContext = buildParentContextPrompt({
    instruction,
    parentLayout,
    hasPreviousPoster,
    refreshWebsite: c.generation_mode === 'website_refresh',
    posterSize,
    parentPosterSize,
  });
  const referenceBlock =
    `\n\n${parentContext}` +
    `\n${referenceCount} new supporting image(s) accompany this prompt. Use them only for the requested delta.`;
  if (style === 'event') return buildEventPrompt(c, hasLogo, posterSize) + referenceBlock;
  const layout = c.poster_layout as PosterLayout | null;
  const ctx = {
    product: String(c.product_name ?? 'the product'),
    essence: String(c.brand_essence ?? ''),
    hasLogo,
    hasStyleBoard,
  };
  if (layout && Array.isArray(layout.zones) && layout.zones.length > 0) {
    return compileLayoutPrompt(layout, ctx, posterSize) + referenceBlock;
  }
  return compileLayoutPrompt(fallbackLayout(c), ctx, posterSize) + referenceBlock;
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

// Compose the text-to-image prompt for an EVENT promo poster. Scaled-band
// formats keep authoritative logistics in AiPoster's real-text footer. A
// bandless format has no external text surface, so its exact logistics become
// quoted artwork content while QR codes, URLs, and link CTAs remain forbidden.
export function buildEventPrompt(
  c: Record<string, unknown>,
  hasLogo = false,
  posterSize: PosterSize = DEFAULT_POSTER_SIZE,
): string {
  const spec = (c.poster_spec ?? {}) as {
    title?: string;
    hook?: string;
    blurb?: string;
    host_line?: string;
    date_line?: string;
    time_line?: string;
    location_line?: string;
  } & Record<string, unknown>;
  const essence = String(c.brand_essence ?? '');
  const title = String((spec.title as string) || c.product_name || 'the event');
  const hook = String((c.poster_spec as { hook?: string })?.hook ?? '');
  const hostLine = String(spec.host_line ?? '');
  const dateLine = String(spec.date_line ?? '').trim();
  const timeLine = String(spec.time_line ?? '').trim();
  const locationLine = String(spec.location_line ?? '').trim();
  const sp = (c.style_profile ?? {}) as { palette?: Record<string, string> };
  const primary = sp.palette?.primary || '#1f2937';
  const accent = sp.palette?.accent || '#e8633a';
  const logoLine = hasLogo
    ? '\nA reference image of the host/brand LOGO is provided — reproduce it faithfully (exact shape and colors) in the top brand area; do not redraw or distort it.\n'
    : '';
  const includesQrBand = hasPosterQrBand(posterSize);
  const logisticsLines = [
    dateLine ? `- Lower information area: a clear date line reading "${dateLine}".` : '',
    timeLine ? `- Lower information area: a clear time line reading "${timeLine}".` : '',
    locationLine ? `- Lower information area: a clear location line reading "${locationLine}".` : '',
  ].filter(Boolean).join('\n');
  const trackingInstruction = includesQrBand
    ? `Do NOT paint any date, time, address, QR code, or barcode yourself — the real date/time/location and a scannable QR
are printed separately below the artwork as crisp real text.`
    : 'This artwork-only format has no footer. Do NOT paint any QR code, barcode, URL, registration link, link call-to-action, button, or pill anywhere.';
  const avoidInstruction = includesQrBand
    ? 'any QR/barcode drawn by you, any painted date/time/address'
    : 'any QR/barcode drawn by you, any URL, registration link, link call-to-action, or painted button/pill';

  return `Create a single ${getPosterFrameLabel(posterSize)} EVENT PROMOTION poster — an inviting, high-energy real-world event flyer
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
- Middle${includesQrBand || !logisticsLines ? ' and lower' : ''}: rich atmospheric illustration evoking the event's theme and energy (people gathering, venue mood,
  motifs from the brand essence)${includesQrBand || !logisticsLines ? ', filling the frame all the way to the bottom edge' : ''} — make it feel exciting and
  specific, not generic clip-art.
${!includesQrBand && logisticsLines ? `${logisticsLines}\n` : ''}
${trackingInstruction}

All rendered text must be crisp, correctly spelled, legible, ENGLISH only, and limited to the quoted strings above.
High quality, sharp, 8k, atmospheric event-poster art direction.
Avoid: product/app UI mockups, painted buttons/pills, ${avoidInstruction},
garbled or misspelled text, non-English text, and watermarks.`;
}
