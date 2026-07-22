import {
  CORS,
  aiChat,
  buildTraceContentManifest,
  buildParentContextPrompt,
  errorDetails,
  ensurePosterLayoutZones,
  extractJson,
  jsonResponse,
  createUserClient,
  getPosterFrameLabel,
  getPosterSize,
  loadFrozenGenerationImageReferences,
  markGenerationFailed,
  normalizePosterLayout,
  normalizeStyleProfile,
  logPipelineEvent,
  prepareImageReferences,
  productPosterActionInstructions,
  recordGenerationAssetProviderSkips,
  resolvedChatModelId,
  stageAlreadySucceeded,
  StageTraceRecorder,
  userContentWithImageReferences,
  type DesignTokens,
  type GenerationStageRunContext,
  type PosterLayout,
  type TypedImageReference,
} from './_shared.ts';
import { resolveProductUseCaseRecipe } from './_useCasePolicy.ts';
import type { ModelCopyPolicy } from './_copySanitizer.ts';

// `designer` is the layout-design agent for the `designer` poster style. It runs
// BETWEEN analyze and hero: given the brand context analyze produced
// (brand_essence, style_profile palette, copy, design_tokens), it asks gpt-4o to
// design a BESPOKE poster layout as structured JSON (composition, mood, art
// style, palette roles, top→lower zones) — not one of the two hardcoded
// templates. `hero` then compiles that layout into the text-to-image prompt via
// the pure compileLayoutPrompt(). The candidate layout is stored only on the
// active generation; completion later projects it onto the campaign atomically.
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
    return await runDesignerStage({
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
      'designer',
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

export async function runDesignerStage(
  context: GenerationStageRunContext,
): Promise<Response> {
  const {
    client,
    userId,
    campaignId,
    generationId,
    finalizeFailure,
  } = context;

  const { data: campaign, error: cErr } = await client.database
    .from('campaigns')
    .select('id, product_name, tagline, cta_text')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .maybeSingle();
  if (cErr || !campaign) return jsonResponse({ error: 'campaign not found' }, 404);

  const { data: generation, error: generationError } = await client.database
    .from('poster_generations')
    .select('id, campaign_id, status, parent_generation_id, generation_mode, instruction, reference_images, poster_format, use_case, brand_essence, style_profile, poster_copy, poster_content, design_tokens, brand_assets, screenshot_url, screenshot_key, poster_layout, trace_schema_version, asset_selection_status')
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
  if (
    ['painting', 'ready'].includes(generationStatus)
    || await stageAlreadySucceeded(context, 'designer')
  ) {
    return jsonResponse({ generation_id: generation.id, idempotent: true });
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
    .update({ status: 'designing', design_status: 'generating' })
    .eq('id', generation.id)
    .eq('user_id', userId);
  if (stageError) {
    if (finalizeFailure) {
      await markGenerationFailed(
        client,
        generation.id,
        'designer',
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
    stage: 'designer',
  });
  await trace.start();

  const c = {
    ...(generation as Record<string, unknown>),
    ...(campaign as Record<string, unknown>),
  };
  const recipe = resolveProductUseCaseRecipe(
    (generation as Record<string, unknown>).use_case,
  );
  const posterSize = getPosterSize(
    (generation as Record<string, unknown>).poster_format,
  );
  const parentPosterSize = parent
    ? getPosterSize((parent as Record<string, unknown>).poster_format)
    : null;
  const product = String(c.product_name ?? 'the product');
  const tagline = String(c.tagline ?? '');
  const essence = String(c.brand_essence ?? '');
  const sp = normalizeStyleProfile(c.style_profile);
  const palette = sp.palette;
  const tokens = (c.design_tokens ?? null) as DesignTokens | null;
  const copy = (c.poster_copy ?? {}) as Record<string, unknown>;
  const content = (c.poster_content ?? {}) as Record<string, unknown>;
  const assets = (c.brand_assets ?? {}) as {
    logo_url?: string;
    logo_key?: string;
    primary_image_url?: string;
    images?: Array<{ url: string; key?: string }>;
  };
  const instruction = String(c.instruction ?? '').trim().slice(0, 4000);
  const userReferenceImages = Array.isArray(c.reference_images)
    ? (c.reference_images as Array<Record<string, unknown>>)
        .filter((image) => typeof image.url === 'string' && image.url)
        .slice(0, 5)
    : [];
  const legacyVisualCandidates: TypedImageReference[] = [
    ...(typeof (parent as Record<string, unknown> | null)?.hero_image_url === 'string'
      ? [{
          kind: 'previous-poster' as const,
          url: String((parent as Record<string, unknown>).hero_image_url),
          key: typeof (parent as Record<string, unknown>).hero_image_key === 'string'
            ? String((parent as Record<string, unknown>).hero_image_key)
            : undefined,
          filename: 'Previous poster',
          storageSource: 'poster-version',
          purpose: recipe.references.designerPrevious,
        }]
      : []),
    ...(typeof c.screenshot_url === 'string' && c.screenshot_url
      ? [{
          kind: 'style-board' as const,
          url: c.screenshot_url,
          key: typeof c.screenshot_key === 'string' ? c.screenshot_key : undefined,
          filename: 'Website style board',
          storageSource: 'website-capture',
          purpose: recipe.references.designerStyleBoard,
        }]
      : []),
    ...userReferenceImages.map((image, index) => ({
      kind: 'user-reference' as const,
      url: String(image.url),
      key: typeof image.key === 'string' ? image.key : undefined,
      filename: typeof image.name === 'string' ? image.name : `Supporting image ${index + 1}`,
      mimeType: typeof image.mime_type === 'string' ? image.mime_type : undefined,
      sizeBytes: typeof image.size_bytes === 'number' ? image.size_bytes : undefined,
      storageSource: 'user-upload',
      purpose: recipe.references.designerUserReference(index + 1),
    })),
  ];
  const usesFrozenAssets = c.trace_schema_version === 2;
  if (usesFrozenAssets && c.asset_selection_status !== 'completed') {
    return jsonResponse({ error: 'generation assets have not been confirmed' }, 409);
  }
  const visualCandidates = usesFrozenAssets
    ? await loadFrozenGenerationImageReferences(context)
    : legacyVisualCandidates;
  const preparedImages = await prepareImageReferences(visualCandidates, {
    maxImages: 6,
    maxCandidates: usesFrozenAssets ? 6 : 7,
    ordering: usesFrozenAssets ? 'preserve' : 'source',
  });
  if (usesFrozenAssets) {
    await recordGenerationAssetProviderSkips(
      context,
      'designer',
      preparedImages.skippedImages,
    );
  }
  await trace.setImages(preparedImages);
  const visualReferences = preparedImages.providerReferences;
  const hasLogo = visualReferences.some((reference) => reference.kind === 'logo');
  const selectedLogo = visualCandidates.find((reference) => reference.kind === 'logo');
  const heroImg = visualCandidates.find((reference) => reference.kind === 'product')?.url
    || (!usesFrozenAssets ? assets.primary_image_url || assets.images?.[0]?.url || '' : '');
  if (
    visualCandidates.some((reference) => reference.kind === 'style-board') &&
    !visualReferences.some((reference) => reference.kind === 'style-board')
  ) {
    logPipelineEvent({
      source: 'designer',
      campaignId: campaign.id,
      generationId: generation.id,
      status: 'degraded',
      code: 'style_board_reference_skipped',
      detail: 'Stored style board could not be inlined for the layout designer.',
    });
  }
  const expectedUserReferences = usesFrozenAssets
    ? visualCandidates.filter((reference) => reference.kind === 'user-reference').length
    : userReferenceImages.length;
  const attachedUserReferences = visualReferences.filter(
    (reference) => reference.kind === 'user-reference',
  ).length;
  if (attachedUserReferences < expectedUserReferences) {
    logPipelineEvent({
      source: 'designer',
      campaignId: campaign.id,
      generationId: generation.id,
      status: 'degraded',
      code: 'reference_image_skipped',
      detail: `${expectedUserReferences - attachedUserReferences} of ${expectedUserReferences} selected user reference image(s) could not be inlined for the layout designer.`,
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
  const structuredCopySources = [copy, content].flatMap((record) =>
    Object.values(record).flatMap((value) =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : typeof value === 'string'
          ? [value]
          : []
    )
  );
  const protectedCopySources = [
    product,
    tagline,
    String(c.cta_text ?? ''),
    instruction,
    ...structuredCopySources,
  ].filter(Boolean);
  const copyPolicy: ModelCopyPolicy = {
    verbatimTexts: protectedCopySources,
    emojiSourceTexts: protectedCopySources,
  };
  const fallbackZones = [
    {
      band: 'top' as const,
      role: recipe.stages.designerFallbackTopRole,
      content: product,
      emphasis: 'low' as const,
    },
    { band: 'upper' as const, role: 'hero headline', content: headline, emphasis: 'high' as const },
    {
      band: 'mid' as const,
      role: recipe.stages.designerFallbackMidRole,
      content: whatItDoes,
      emphasis: 'med' as const,
    },
  ];
  const parentLayout = ((parent as Record<string, unknown> | null)?.poster_layout ?? null) as PosterLayout | null;
  const parentContext = buildParentContextPrompt({
    instruction,
    parentLayout,
    hasPreviousPoster: usesFrozenAssets
      ? visualReferences.some((reference) => reference.kind === 'previous-poster')
      : !!(parent as Record<string, unknown> | null)?.hero_image_url,
    refreshWebsite: c.generation_mode === 'website_refresh',
    posterSize,
    parentPosterSize,
    recipe,
  });
  const actionInstructions = productPosterActionInstructions(posterSize, recipe);

  const sys =
    `You are an award-winning poster art director creating the next version of a ${getPosterFrameLabel(posterSize)} ${recipe.stages.designerPosterKind}. ` +
    'Follow the iteration contract exactly: preserve the parent composition and every unspecified choice, changing ' +
    `only what the user requested. Reference-purpose labels identify the ${recipe.stages.designerReferenceSubjects} ` +
    `${recipe.stages.designerEvidenceRule} Never pick a ` +
    'medium from a category stereotype; for example, a game is not automatically risograph. Output STRICT JSON only ' +
    '(no prose, no code fences) ' +
    'matching this schema:\n' +
    '{"composition":"one phrase describing the overall composition (e.g. asymmetric, oversized hero top-left, diagonal flow)",' +
    '"mood":"2-4 words (e.g. editorial, calm, premium)",' +
    '"art_style":"source-observed visual medium and treatment",' +
    '"imagery":"subject matter, crop, depth and image treatment","typography_treatment":"type character and hierarchy",' +
    '"lighting":"lighting and contrast","texture":"surface/material finish","motifs":["recurring observed motifs"],' +
    '"density":"sparse|balanced|dense",' +
    '"palette_roles":{"bg":"#hex","surface":"#hex optional","text":"#hex","primary":"#hex","accent":"#hex",' +
    '"secondary":"#hex optional","supporting":["#hex"],"proportions":[{"color":"#hex","proportion":0.0}]},' +
    '"zones":[{"band":"top|upper|mid|lower","role":"what this zone is, e.g. ' +
    recipe.stages.designerZoneRoleExample +
    '",' +
    '"content":"the EXACT short words to render in this zone (English, concise)","emphasis":"low|med|high","align":"left|center|right"}]}\n' +
    recipe.stages.designerRules +
    recipe.stages.designerPaletteRule +
    `This is a PRINTED POSTER IMAGE, not an app screen. The four bands together fill the COMPLETE ${posterSize.providerAspectRatio} frame. ` +
    actionInstructions.designerRule +
    (hasLogo
      ? 'The brand has a real LOGO (a reference image is passed to the painter) — include a "top" brand-row zone whose role mentions the logo. '
      : '');

  const user =
    `${parentContext}\n\n` +
    `${recipe.stages.designerSubjectLabel}: ${product}\n` +
    `${recipe.stages.designerTaglineLabel}: ${tagline || '(none)'}\n` +
    `${recipe.stages.designerEssenceLabel}: ${essence || '(none)'}\n` +
    `${recipe.stages.designerColorsLabel}: bg ${palHint.bg}, text ${palHint.text}, primary ${palHint.primary}, accent ${palHint.accent}${palHint.secondary ? `, secondary ${palHint.secondary}` : ''}${palHint.supporting?.length ? `, supporting ${palHint.supporting.join(', ')}` : ''}\n` +
    `WEIGHTED COLOR USAGE: ${palHint.proportions?.length ? palHint.proportions.map((entry) => `${entry.color} ${(entry.proportion * 100).toFixed(1)}%`).join(', ') : '(not available)'}\n` +
    `${recipe.stages.designerSourceObservationsHeading}\n` +
    `- Imagery: ${sp.imagery || recipe.stages.designerObservationFallback}\n` +
    `- Typography: ${sp.typography_treatment || `${sp.fonts.heading} headings / ${sp.fonts.body} body`}\n` +
    `- Lighting: ${sp.lighting || recipe.stages.designerObservationFallback}\n` +
    `- Texture: ${sp.texture || recipe.stages.designerObservationFallback}\n` +
    `- Motifs: ${sp.motifs?.join(', ') || '(none observed)'}\n` +
    `- Composition: ${sp.composition || sp.layout_hint || recipe.stages.designerObservationFallback}\n` +
    `- Density: ${sp.density || 'balanced'}\n` +
    `TONE: ${sp.tone || 'modern'}\n` +
    `HEADLINE: ${headline}\n` +
    `WHAT IT DOES: ${whatItDoes}\n` +
    (features.length ? `AVAILABLE SUPPORTING COPY (select only what the hierarchy needs): ${features.join(' · ')}\n` : '') +
    `\nASSETS:\n` +
    (hasLogo
      ? `LOGO: ${selectedLogo?.url ?? assets.logo_url} (the selected real logo is passed to the painter — plan a brand row for it)\n`
      : `${recipe.stages.designerLogoMissing}\n`) +
    (heroImg ? `${recipe.stages.designerImageLabel}: ${heroImg}\n` : '') +
    `ATTACHED VISUAL EVIDENCE: ${visualReferences.length} labeled image(s), including the previous poster when available.\n` +
    `\n${actionInstructions.designerRequest}`;
  const userContent = userContentWithImageReferences(
    user,
    visualReferences,
    6,
    usesFrozenAssets ? 'preserve' : 'source',
  );

  let layout;
  try {
    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content: userContent },
    ];
    layout = await trace.runModelCall(
      {
        operation: 'chat',
        modelId: resolvedChatModelId(),
        prompt: { system: sys, user },
        providerSettings: { max_completion_tokens: 1800, timeout_ms: 30_000 },
        contentManifest: buildTraceContentManifest(messages, preparedImages.attachedImages),
      },
      async () => {
        const raw = await aiChat(messages, { maxTokens: 1800 });
        return ensurePosterLayoutZones(
          normalizePosterLayout(extractJson(raw), palHint, sp, copyPolicy),
          fallbackZones,
        );
      },
    );
  } catch {
    // One repair retry with a terse reminder, then give up (design_status=failed).
    try {
      const repairSystem = sys + ' Return ONLY valid minified JSON.';
      const messages = [
        { role: 'system', content: repairSystem },
        { role: 'user', content: userContent },
      ];
      layout = await trace.runModelCall(
        {
          operation: 'chat',
          modelId: resolvedChatModelId(),
          prompt: { system: repairSystem, user },
          providerSettings: { max_completion_tokens: 1800, timeout_ms: 30_000 },
          contentManifest: buildTraceContentManifest(messages, preparedImages.attachedImages),
        },
        async () => {
          const raw = await aiChat(messages, { maxTokens: 1800 });
          return ensurePosterLayoutZones(
            normalizePosterLayout(extractJson(raw), palHint, sp, copyPolicy),
            fallbackZones,
          );
        },
      );
    } catch (e) {
      if (finalizeFailure) {
        await trace.fail(e, 'layout_ai_failed');
        await markGenerationFailed(
          client,
          generation.id,
          'designer',
          e,
          'layout_ai_failed',
          userId,
        );
      }
      logPipelineEvent({
        source: 'designer',
        campaignId: campaign.id,
        generationId: generation.id,
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
    .from('poster_generations')
    .update({ poster_layout: layout, design_status: 'ready' })
    .eq('id', generation.id)
    .eq('user_id', userId);
  if (upErr) {
    if (finalizeFailure) {
      await trace.fail(upErr, 'generation_persist_failed');
      await markGenerationFailed(
        client,
        generation.id,
        'designer',
        upErr,
        'generation_persist_failed',
        userId,
      );
    }
    logPipelineEvent({
      source: 'designer',
      campaignId: campaign.id,
      generationId: generation.id,
      status: 'failed',
      code: 'generation_persist_failed',
      detail: 'generation persist failed after layout design',
      error: upErr,
    });
    return jsonResponse({ error: upErr.message }, 500);
  }
  await trace.addArtifact({ kind: 'layout', snapshot: layout });
  await trace.succeed();

  // Return the real layout-agent prompt for the generation loading UI.
  return jsonResponse({ poster_layout: layout, prompt: { system: sys, user } });
}
