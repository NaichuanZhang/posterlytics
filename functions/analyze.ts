import {
  CORS,
  aiChat,
  buildTraceContentManifest,
  errorDetails,
  extractJson,
  jsonResponse,
  createUserClient,
  captureSite,
  normalizeCaptureColorScheme,
  normalizeStyleProfile,
  parseColor,
  toHex,
  logPipelineEvent,
  markGenerationFailed,
  prepareImageReferences,
  resolvedChatModelId,
  stageAlreadySucceeded,
  StageTraceRecorder,
  userContentWithImageReferences,
  extractEventDetails,
  fetchLumaHtml,
  formatEventLines,
  isLumaHost,
  type CaptureResult,
  type DesignTokens,
  type EventDetails,
  type GenerationStageRunContext,
  type TraceImageAsset,
  type TypedImageReference,
} from './_shared.ts';
import {
  acquireProductSource,
  acquireProductSourceWithoutCapture,
  resolveProductSourceMode,
  type ProductSourceMode,
} from './_sourceAcquisition.ts';
import {
  evaluateEagerCaptureReuse,
} from './_eagerCapture.ts';
import {
  discardUploadedAnalysisAssets,
  extractAssets,
  extractColors,
  mergeEagerSourceAssets,
  rehostBrandAssets,
  uploadStyleBoard,
} from './_websiteEvidence.ts';
import {
  isReferenceOnlyProductRecipe,
  resolveProductUseCaseRecipe,
  type ProductUseCaseRecipe,
  useCaseSourceMismatch,
} from './_useCasePolicy.ts';

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

  const client = createUserClient(req);

  const { data: userData } = await client.auth.getCurrentUser();
  if (!userData?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: { campaignId?: string; generationId?: string; colorScheme?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad json' }, 400);
  }
  if (!body.campaignId || !body.generationId) {
    return jsonResponse({ error: 'missing campaignId or generationId' }, 400);
  }
  const colorScheme = normalizeCaptureColorScheme(body.colorScheme);
  if (!colorScheme) {
    return jsonResponse({ error: 'colorScheme must be "light" or "dark"' }, 400);
  }

  try {
    return await runAnalyzeStage({
      client,
      userId: userData.user.id,
      campaignId: body.campaignId,
      generationId: body.generationId,
      colorScheme,
      finalizeFailure: true,
      serverOwned: false,
    });
  } catch (error) {
    const details = errorDetails(error);
    await markGenerationFailed(
      client,
      body.generationId,
      'analyze',
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

export async function runAnalyzeStage(
  context: GenerationStageRunContext & { colorScheme: 'light' | 'dark' },
): Promise<Response> {
  const {
    client,
    userId,
    campaignId,
    generationId,
    colorScheme,
    finalizeFailure,
  } = context;

  // Admin workers are still explicitly owner-scoped; wrappers get the same
  // defense in depth in addition to owner RLS.
  const { data: campaign, error: cErr } = await client.database
    .from('campaigns')
    .select('id, product_url, product_name, tagline, cta_text, destination_url, scenario, use_case, design_tokens, brand_assets, screenshot_url, screenshot_key, eager_capture_url, eager_capture_color_scheme, eager_captured_at')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .maybeSingle();
  if (cErr || !campaign) return jsonResponse({ error: 'campaign not found' }, 404);

  const { data: generation, error: generationError } = await client.database
    .from('poster_generations')
    .select('id, campaign_id, status, parent_generation_id, generation_mode, instruction, reference_images, scenario, use_case, platform_hint, brand_assets, design_tokens, screenshot_url, screenshot_key')
    .eq('id', generationId)
    .eq('campaign_id', campaign.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (generationError || !generation) {
    return jsonResponse({ error: 'poster generation not found' }, 404);
  }
  if ((generation as Record<string, unknown>).generation_mode !== 'website_refresh') {
    return jsonResponse({ error: 'analysis is only valid for website refresh generations' }, 409);
  }
  const generationStatus = String((generation as Record<string, unknown>).status ?? '');
  if (generationStatus === 'failed') {
    return jsonResponse({ error: 'poster generation already failed' }, 409);
  }
  if (
    ['designing', 'painting', 'ready'].includes(generationStatus)
    || await stageAlreadySucceeded(context, 'analyze')
  ) {
    return jsonResponse({ generation_id: generation.id, idempotent: true });
  }
  const productUrl = String(
    (campaign as Record<string, unknown>).product_url ?? '',
  );
  const sourceMismatch = useCaseSourceMismatch(
    (generation as Record<string, unknown>).use_case,
    productUrl,
  );
  if (sourceMismatch) {
    if (finalizeFailure) {
      await markGenerationFailed(
        client,
        generation.id,
        'analyze',
        sourceMismatch.message,
        sourceMismatch.code,
        userId,
      );
    }
    return jsonResponse({
      error: sourceMismatch.message,
      code: sourceMismatch.code,
      retryable: sourceMismatch.retryable,
    }, 409);
  }

  const { error: stageError } = await client.database
    .from('poster_generations')
    .update({ status: 'analyzing' })
    .eq('id', generation.id)
    .eq('user_id', userId);
  if (stageError) {
    if (finalizeFailure) {
      await markGenerationFailed(
        client,
        generation.id,
        'analyze',
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
    stage: 'analyze',
  });
  await trace.start();

  // New event creation is retired. Only persisted legacy event rows enter the
  // event branch, so a request body cannot turn a product campaign into an event.
  const persistedScenario = (generation as { scenario?: string | null }).scenario;
  const scenario = persistedScenario === 'event' ? 'event' : 'product';
  const referenceContext = String((generation as Record<string, unknown>).instruction ?? '').trim().slice(0, 4000);
  const userReferenceImages = Array.isArray((generation as Record<string, unknown>).reference_images)
    ? ((generation as Record<string, unknown>).reference_images as Array<Record<string, unknown>>)
        .filter((image) => typeof image.url === 'string' && image.url)
        .slice(0, 5)
    : [];
  const productRecipe = resolveProductUseCaseRecipe(
    (generation as Record<string, unknown>).use_case,
  );
  const platformHint = typeof (generation as Record<string, unknown>).platform_hint === 'string'
    ? String((generation as Record<string, unknown>).platform_hint).slice(0, 80).trim() || null
    : null;
  const eagerCaptureDecision = evaluateEagerCaptureReuse({
    campaign: campaign as Record<string, unknown> & Parameters<
      typeof evaluateEagerCaptureReuse
    >[0]['campaign'],
    generation: generation as Record<string, unknown> & Parameters<
      typeof evaluateEagerCaptureReuse
    >[0]['generation'],
    colorScheme,
    productSourceMode: resolveProductSourceMode(productUrl, productRecipe),
  });
  const eagerAssetSelection = eagerCaptureDecision.reused
    ? eagerCaptureDecision.sourceAssets.selection
    : undefined;

  // 1. Acquire source evidence. Legacy events retain the strict Luma allowlist.
  // Amazon product pages intentionally use seller-provided references because
  // both raw fetches and browser captures commonly return CAPTCHA evidence.
  let scrapeHtml = '';
  let productSourceMode: ProductSourceMode = 'website';
  let productCapture: CaptureResult | null = null;
  if (scenario === 'event') {
    try {
      const target = new URL(productUrl);
      if (target.protocol === 'https:' && isLumaHost(target.hostname)) {
        scrapeHtml = await fetchLumaHtml(target);
      }
    } catch {
      scrapeHtml = '';
    }
  } else if (eagerCaptureDecision.reused) {
    const acquisition = await acquireProductSourceWithoutCapture(
      productUrl,
      productRecipe,
    );
    productSourceMode = acquisition.mode;
    scrapeHtml = acquisition.html;
    productCapture = {
      tokens: eagerCaptureDecision.designTokens,
      styleBoardDataUrl: null,
      error: null,
    };
  } else {
    const acquisition = await acquireProductSource(
      productUrl,
      colorScheme,
      productRecipe,
    );
    productSourceMode = acquisition.mode;
    scrapeHtml = acquisition.html;
    productCapture = acquisition.capture;
  }

  // 1b. For the event scenario, parse the Luma page's schema.org/Event JSON-LD
  // into structured event_details (deterministic — no LLM). Date/time/location
  // here are AUTHORITATIVE; the poster renders them as real text, never AI-painted.
  const event_details: EventDetails | null =
    scenario === 'event' ? extractEventDetails(scrapeHtml) : null;

  // 2. Extract real assets + meta from the HTML.
  const extractedAssets = extractAssets(scrapeHtml, productUrl);
  const assets = eagerCaptureDecision.reused
    ? mergeEagerSourceAssets(
        extractedAssets,
        eagerCaptureDecision.sourceAssets,
      )
    : extractedAssets;

  // 2b. Programmatic style capture via the headless-browser service: real
  // computed fonts/colors/radii/shadows/spacing + a style board. Best-effort —
  // null when the service is unconfigured/unreachable, in which case we fall
  // back to the regex-mined colors below. (Capture happens here so its palette
  // can seed the model and its tokens are persisted.)
  const capture = scenario === 'event'
    ? await captureSite(productUrl, colorScheme)
    : productCapture;
  if (capture?.error) {
    logPipelineEvent({
      source: 'capture',
      campaignId: campaign.id,
      generationId: generation.id,
      status: 'degraded',
      code: capture.error.code,
      detail: 'Capture unavailable; using HTML color extraction.',
      error: capture.error.message,
    });
  }
  const design_tokens: DesignTokens | null = capture?.tokens ?? null;
  // A successful browser capture is self-contained evidence: only viewport-
  // visible computed DOM colors and style-board pixels are used. Raw HTML color
  // mining is retained strictly for a capture failure/unconfigured fallback.
  const captureSucceeded = capture?.error === null;
  const hasCapturedEvidence = !!design_tokens || !!capture?.styleBoardDataUrl;
  const fallbackHtmlColors = captureSucceeded ? [] : extractColors(scrapeHtml);
  const siteColors = design_tokens
    ? dedupeColors([
        ...(design_tokens.colors.visualPalette ?? []).map((entry) => entry.color),
        design_tokens.colors.accent,
        design_tokens.colors.primary,
        ...design_tokens.colors.palette,
      ])
    : fallbackHtmlColors;

  const brand_assets = await rehostBrandAssets(
    client,
    assets,
    campaign.id,
    generation.id,
  );
  const {
    screenshotUrl: screenshot_url,
    screenshotKey: screenshot_key,
    uploadedStyleBoardKey,
  } = await uploadStyleBoard(
    client,
    capture?.styleBoardDataUrl,
    productSourceMode,
    !eagerCaptureDecision.reused
        && eagerCaptureDecision.candidatePresent
        && (generation as Record<string, unknown>).parent_generation_id === null
      ? null
      : (generation as Record<string, unknown>).screenshot_url,
    !eagerCaptureDecision.reused
        && eagerCaptureDecision.candidatePresent
        && (generation as Record<string, unknown>).parent_generation_id === null
      ? null
      : (generation as Record<string, unknown>).screenshot_key,
    campaign.id,
    generation.id,
  );

  const analysisCandidates: TypedImageReference[] = [
    ...(screenshot_url
      ? [{
          kind: 'style-board' as const,
          url: screenshot_url,
          key: screenshot_key ?? undefined,
          filename: 'Website style board',
          mimeType: 'image/jpeg',
          storageSource: 'website-capture',
          purpose: productRecipe.references.analysisStyleBoard,
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
      purpose: productRecipe.references.analysisUserReference(index + 1),
    })),
  ];
  const preparedAnalysisImages = await prepareImageReferences(analysisCandidates, {
    maxImages: 6,
    maxCandidates: 8,
    maxTotalBytes: 12_000_000,
  });
  await trace.setImages(preparedAnalysisImages);
  if (screenshot_url) {
    await trace.addArtifact({
      kind: 'style-board',
      url: screenshot_url,
      key: screenshot_key,
      mime_type: preparedAnalysisImages.attachedImages.find(
        (image) => image.source === 'style-board',
      )?.mime_type ?? 'image/jpeg',
      size_bytes: preparedAnalysisImages.attachedImages.find(
        (image) => image.source === 'style-board',
      )?.size_bytes ?? null,
    });
  }
  const referenceImages = preparedAnalysisImages.providerReferences;

  // 3. gpt-4o → poster_content + style_profile + brand_essence. The `designer`
  // agent then designs the bespoke layout from these and `hero` paints it;
  // brand_essence is a word-portrait that supplements the visual references.
  const visibleText = stripToText(scrapeHtml).slice(0, 8000);

  // The event scenario uses its own prompt + spec normalizer (poster_spec becomes
  // an EventPosterSpec). Everything else — capture tokens, palette override,
  // asset re-hosting, persistence — is shared with the product path.
  if (scenario === 'event') {
    const parsedEv = await analyzeEvent({
      campaign: campaign as Record<string, string>,
      eventDetails: event_details ?? {}, siteColors, tokens: design_tokens,
      visibleText,
      referenceContext,
      referenceImages,
      attachedImages: preparedAnalysisImages.attachedImages,
      trace,
    });
    const { error: upErrEv } = await client.database
      .from('poster_generations')
      .update({
        scenario: 'event',
        event_details,
        style_profile: parsedEv.style_profile,
        poster_copy: parsedEv.poster_copy,
        poster_content: parsedEv.poster_content,
        brand_essence: parsedEv.brand_essence,
        poster_spec: parsedEv.poster_spec,
        brand_assets,
        design_tokens,
        screenshot_url,
        screenshot_key,
      })
      .eq('id', generation.id)
      .eq('user_id', userId);
    if (upErrEv) {
      await discardUploadedAnalysisAssets(client, uploadedStyleBoardKey, brand_assets);
      if (finalizeFailure) {
        await trace.fail(upErrEv, 'generation_persist_failed');
        await markGenerationFailed(
          client,
          generation.id,
          'analyze',
          upErrEv,
          'generation_persist_failed',
          userId,
        );
      }
      logPipelineEvent({
        source: 'analyze', campaignId: campaign.id, generationId: generation.id, status: 'failed',
        code: 'generation_persist_failed',
        detail: 'generation persist failed after event analyze',
        error: upErrEv,
      });
      return jsonResponse({ error: upErrEv.message }, 500);
    }
    await trace.addArtifact({
      kind: 'analysis',
      metadata: { scenario: 'event', deterministic_logistics: true },
    });
    await trace.succeed();
    return jsonResponse({
      generation_id: generation.id,
      scenario: 'event',
      event_details,
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
  const sys = productRecipe.analyze.promptKind === 'social-reference'
    ? (
      'You are a senior social-cover art director and visual-reference analyst. ' +
      productRecipe.analyze.sourceBrief +
      'Then produce concise artwork copy and a visual word-portrait centered on mood and a strong visual hook. ' +
      'The attached images are the PRIMARY style evidence. Create direction for original full-bleed artwork; do not ' +
      'copy reference text or add interface controls, badges, or promotional mechanics that were not requested. ' +
      'Output STRICT JSON only — no prose, no code fences.\n' +
      'Schema: {' +
      '"style_profile":{"palette":{"primary":"#hex","bg":"#hex","text":"#hex","accent":"#hex",' +
      '"secondary":"#hex optional","supporting":["#hex"],' +
      '"proportions":[{"color":"#hex","proportion":0.0}]},' +
      '"fonts":{"heading":"CSS font family","body":"CSS font family"},"tone":"2-4 words",' +
      '"layout_hint":"one phrase","imagery":"reference-led subject and treatment",' +
      '"typography_treatment":"reference-led type character, scale and hierarchy",' +
      '"lighting":"reference-led lighting and contrast","texture":"reference-led surface/finish",' +
      '"motifs":["supported recurring shapes or symbols"],"composition":"visual-hook hierarchy and spatial rhythm",' +
      '"density":"sparse|balanced|dense"},' +
      '"poster_content":{"headline":"concise artwork headline","what_it_does":"one short supporting line",' +
      '"how_it_works":[],"why_use_it":[],"features":["up to 3 concise supporting lines"],"cta":""},' +
      '"brand_essence":"one vivid sentence describing the artwork direction for an illustrator: mood, visual hook, ' +
      'signature colors (name the hex), imagery treatment, and overall feel","qr_label":""}\n' +
      'Keep all copy SHORT and legible. ' +
      productRecipe.analyze.paletteBrief +
      'Do not introduce colors absent from the evidence. ' +
      productRecipe.analyze.densityBrief
    )
    : (
      'You are a senior product marketer and visual-evidence analyst. ' +
      productRecipe.analyze.sourceBrief +
      'Then produce structured copy and a brand word-portrait. The first attached image, when present, is the PRIMARY brand evidence. Adapt ' +
      'the evidence for a poster later; do not copy navigation or website controls. Never infer a visual medium from ' +
      'the product category: for example, do not automatically choose risograph for a game. Output STRICT JSON only ' +
      '— no prose, no code fences.\n' +
      'Schema: {' +
      '"style_profile":{"palette":{"primary":"#hex","bg":"#hex","text":"#hex","accent":"#hex",' +
      '"secondary":"#hex optional","supporting":["#hex"],' +
      '"proportions":[{"color":"#hex","proportion":0.0}]},' +
      '"fonts":{"heading":"CSS font family","body":"CSS font family"},"tone":"2-4 words",' +
      '"layout_hint":"one phrase","imagery":"observed image subject and treatment",' +
      '"typography_treatment":"observed type character, scale and hierarchy",' +
      '"lighting":"observed lighting and contrast","texture":"observed surface/finish",' +
      '"motifs":["observed recurring shapes or symbols"],"composition":"observed hierarchy and spatial rhythm",' +
      '"density":"sparse|balanced|dense"},' +
      '"poster_content":{"headline":"compelling headline","what_it_does":"1-2 sentences","how_it_works":["3-4 short steps"],' +
      '"why_use_it":["3 short reasons"],"features":["4-6 concise feature lines"],"cta":"button text"},' +
      '"brand_essence":"one vivid sentence describing the brand\'s visual identity for an illustrator: logo motif/shape, ' +
      'UI vibe, signature colors (name the hex), and overall feel",' +
      '"qr_label":"<=4 words for the scan caption, e.g. Scan to Start"}\n' +
      'Keep all copy SHORT and legible. ' +
      productRecipe.analyze.paletteBrief +
      'Do not substitute generic SaaS blue or introduce colors absent from the evidence. ' +
      productRecipe.analyze.densityBrief
    );
  const capturedPalette = design_tokens?.colors.visualPalette ?? [];
  const paletteEvidence = capturedPalette.length
    ? capturedPalette
        .map((entry) => `${entry.color} ${(entry.proportion * 100).toFixed(1)}%`)
        .join(', ')
    : siteColors.join(', ');
  const evidenceSource = productRecipe.analyze.evidenceSource({
    hasCapturedEvidence,
    captureSucceeded,
    themeColor: assets.themeColor ?? null,
  });
  const sourceText = productRecipe.analyze.sourceText(visibleText);
  const referenceInstruction = productRecipe.analyze.referenceInstruction(
    referenceImages.filter((image) => image.kind === 'user-reference').length,
  );
  const user = productRecipe.analyze.promptKind === 'social-reference'
    ? (
      `ARTWORK NAME: ${campaign.product_name}\n` +
      `SUPPORTING LINE (optional): ${(campaign as Record<string, string>).tagline ?? ''}\n` +
      `VISUAL EVIDENCE SOURCE: ${evidenceSource}\n` +
      `${productRecipe.analyze.platformInstruction(platformHint)}\n\n` +
      `CREATIVE CONTEXT FROM THE USER:\n${referenceContext || '(none provided)'}\n` +
      referenceInstruction
    )
    : (
      `PRODUCT NAME: ${campaign.product_name}\n` +
      `TAGLINE (optional): ${(campaign as Record<string, string>).tagline ?? ''}\n` +
      `CTA HINT: ${(campaign as Record<string, string>).cta_text ?? ''}\n` +
      `PRODUCT URL: ${productUrl}\n` +
      `VISUAL EVIDENCE SOURCE: ${evidenceSource}\n` +
      `CAPTURED PAGE THEME: ${design_tokens?.colors.theme ?? '(unclassified)'}\n` +
      `WEIGHTED COLOR USAGE (preserve these proportions): ${paletteEvidence || '(none found — infer restrained defaults)'}\n` +
      `VISIBLE DOM COLOR ROLES: bg ${design_tokens?.colors.bg ?? '(unknown)'}, text ${design_tokens?.colors.text ?? '(unknown)'}, primary ${design_tokens?.colors.primary ?? '(unknown)'}, accent ${design_tokens?.colors.accent ?? '(unknown)'}\n\n` +
      `${sourceText}\n\n` +
      `CREATIVE CONTEXT FROM THE USER:\n${referenceContext || '(none provided)'}\n` +
      referenceInstruction
    );
  const userContent = userContentWithImageReferences(user, referenceImages, 6);

  let parsed: ParsedContent;
  let usedFallback = false;
  try {
    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content: userContent },
    ];
    parsed = await trace.runModelCall(
      {
        operation: 'chat',
        modelId: resolvedChatModelId(),
        prompt: { system: sys, user },
        providerSettings: { max_completion_tokens: 2200, timeout_ms: 30_000 },
        contentManifest: buildTraceContentManifest(
          messages,
          preparedAnalysisImages.attachedImages,
        ),
      },
      async () => {
        const raw = await aiChat(messages, { maxTokens: 2200 });
        return normalize(
          extractJson(raw),
          campaign as Record<string, string>,
          siteColors,
          design_tokens,
          productRecipe,
        );
      },
    );
  } catch {
    // One repair retry with a terse reminder.
    try {
      const repairSystem = sys + ' Return ONLY valid minified JSON.';
      const messages = [
        { role: 'system', content: repairSystem },
        { role: 'user', content: userContent },
      ];
      parsed = await trace.runModelCall(
        {
          operation: 'chat',
          modelId: resolvedChatModelId(),
          prompt: { system: repairSystem, user },
          providerSettings: { max_completion_tokens: 2200, timeout_ms: 30_000 },
          contentManifest: buildTraceContentManifest(
            messages,
            preparedAnalysisImages.attachedImages,
          ),
        },
        async () => {
          const raw = await aiChat(messages, { maxTokens: 2200 });
          return normalize(
            extractJson(raw),
            campaign as Record<string, string>,
            siteColors,
            design_tokens,
            productRecipe,
          );
        },
      );
    } catch (e) {
      // Both AI-chat attempts failed → hardcoded fallback content. The poster still
      // renders, but it's off-brand; record why so it's not invisible.
      logPipelineEvent({
        source: 'analyze',
        campaignId: campaign.id,
        generationId: generation.id,
        status: 'degraded',
        code: 'analysis_ai_failed',
        detail: 'AI chat failed twice — used hardcoded fallback content',
        error: e,
      });
      parsed = fallbackContent(
        campaign as Record<string, string>,
        siteColors,
        design_tokens,
        productRecipe,
      );
      usedFallback = true;
    }
  }

  // 4. Persist. design_tokens/screenshot are written even when the AI step used a
  // fallback. poster_content feeds the poster copy in designer.ts.
  const { error: upErr } = await client.database
    .from('poster_generations')
    .update({
      scenario: 'product',
      event_details: null, // clear any stale event data if a campaign switched to product
      style_profile: parsed.style_profile,
      poster_copy: parsed.poster_copy,
      poster_content: parsed.poster_content,
      brand_essence: parsed.brand_essence,
      poster_spec: parsed.poster_spec,
      brand_assets,
      design_tokens,
      screenshot_url,
      screenshot_key,
    })
    .eq('id', generation.id)
    .eq('user_id', userId);
  if (upErr) {
    await discardUploadedAnalysisAssets(client, uploadedStyleBoardKey, brand_assets);
    if (finalizeFailure) {
      await trace.fail(upErr, 'generation_persist_failed');
      await markGenerationFailed(
        client,
        generation.id,
        'analyze',
        upErr,
        'generation_persist_failed',
        userId,
      );
    }
    logPipelineEvent({
      source: 'analyze',
      campaignId: campaign.id,
      generationId: generation.id,
      status: 'failed',
      code: 'generation_persist_failed',
      detail: 'generation persist failed after analyze',
      error: upErr,
    });
    return jsonResponse({ error: upErr.message }, 500);
  }
  await trace.addArtifact({
    kind: 'analysis',
    metadata: {
      scenario: 'product',
      source_mode: productSourceMode,
      used_fallback: usedFallback,
      ...(eagerCaptureDecision.candidatePresent
        ? {
            eager_capture_reused: eagerCaptureDecision.reused,
            eager_capture_reason: eagerCaptureDecision.reason,
          }
        : {}),
      ...(eagerAssetSelection
        ? {
            eager_asset_selection_applied: true,
            eager_asset_excluded_count:
              eagerAssetSelection.excludedUrls.length,
            eager_logo_excluded: eagerAssetSelection.logoExcluded,
          }
        : {}),
    },
  });
  await trace.succeed();

  return jsonResponse({
    generation_id: generation.id,
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
// and exact-rgb duplicates. Capture evidence is ordered by pixel usage; this is
// also used for the raw-HTML fallback when browser capture is unavailable.
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
  style_profile: unknown;
  poster_copy: unknown;
  poster_content: unknown;
  brand_essence: string;
  poster_spec: unknown;
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
  recipe: ProductUseCaseRecipe = resolveProductUseCaseRecipe(undefined),
): ParsedContent {
  const recordOf = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  const o = recordOf(raw);
  const sp = recordOf(o.style_profile);
  const lc = recordOf(o.poster_content);
  const product = c.product_name;
  const tagline = c.tagline || '';

  const modelPalette = recordOf(sp.palette);
  const modelFonts = recordOf(sp.fonts);
  // Deterministic capture roles win over model guesses. The weighted palette is
  // kept separately so a tiny accent never becomes the poster's dominant field.
  const topSiteColor = siteColors.find(isVivid);
  const modelAccent = typeof modelPalette.accent === 'string' ? modelPalette.accent : undefined;
  const accent =
    (isVivid(tokens?.colors.accent) ? tokens!.colors.accent : null) ??
    topSiteColor ??
    (isVivid(modelAccent) ? modelAccent : '#10b981');
  const primary = tokens?.colors.primary ||
    (typeof modelPalette.primary === 'string' ? modelPalette.primary : '') ||
    '#1f2937';
  const bg = tokens?.colors.bg ||
    (typeof modelPalette.bg === 'string' ? modelPalette.bg : '') ||
    '#ffffff';
  const text = tokens?.colors.text ||
    (typeof modelPalette.text === 'string' ? modelPalette.text : '') ||
    '#111827';
  const visualPalette = tokens?.colors.visualPalette ?? [];
  const roleColors = new Set(dedupeColors([primary, bg, text, accent]));
  const supplementalColors = dedupeColors(visualPalette.map((entry) => entry.color))
    .filter((color) => !roleColors.has(color));
  const modelSupporting = asArray(modelPalette.supporting);
  const secondary = supplementalColors[0] ||
    (typeof modelPalette.secondary === 'string' ? modelPalette.secondary : '');
  const supporting = dedupeColors([
    ...supplementalColors.slice(1),
    ...modelSupporting,
  ]).filter((color) => color !== secondary).slice(0, 5);
  const capturedHeading = fontStack(tokens?.typography.headingFamily);
  const capturedBody = fontStack(tokens?.typography.bodyFamily);
  const styleProfile = normalizeStyleProfile({
    ...sp,
    palette: {
      ...modelPalette,
      primary,
      bg,
      text,
      accent,
      ...(secondary ? { secondary } : {}),
      ...(supporting.length ? { supporting } : {}),
      proportions: visualPalette.length ? visualPalette : modelPalette.proportions,
    },
    fonts: {
      ...modelFonts,
      heading: capturedHeading ??
        (typeof modelFonts.heading === 'string' ? modelFonts.heading : 'system-ui, sans-serif'),
      body: capturedBody ??
        (typeof modelFonts.body === 'string' ? modelFonts.body : 'system-ui, sans-serif'),
    },
  }, {
    palette: { primary, bg, text, accent },
    fonts: {
      heading: capturedHeading ?? 'system-ui, sans-serif',
      body: capturedBody ?? capturedHeading ?? 'system-ui, sans-serif',
    },
    tone: 'modern',
    imagery: isReferenceOnlyProductRecipe(recipe)
      ? 'reference-led imagery adapted to a full-bleed composition'
      : 'source-faithful product imagery adapted to a poster composition',
    typography_treatment: isReferenceOnlyProductRecipe(recipe)
      ? 'reference-led type character with a clear artwork-scale hierarchy'
      : 'source-derived type character with a clear poster-scale hierarchy',
    lighting: tokens?.colors.theme === 'dark'
      ? 'source-matched dark-field lighting and contrast'
      : tokens?.colors.theme === 'light'
        ? 'source-matched light-field lighting and contrast'
        : 'source-matched lighting and contrast',
    texture: isReferenceOnlyProductRecipe(recipe)
      ? 'preserve the references\' surface finish without adding an unrelated effect'
      : 'preserve the source page surface finish without adding an unrelated print effect',
    composition: typeof sp.layout_hint === 'string' && sp.layout_hint
      ? sp.layout_hint
      : isReferenceOnlyProductRecipe(recipe)
        ? 'full-bleed adaptation of the reference hierarchy and visual hook'
        : 'poster adaptation of the source page hierarchy',
    density: 'balanced',
  });

  // The layout itself is designed later by the `designer` function; the product
  // poster_spec carries only what the SPA band reads (qr_label) + the urls line.
  const qrLabel = isReferenceOnlyProductRecipe(recipe)
    ? ''
    : String((o.qr_label as unknown) ?? '').slice(0, 40) || 'Scan to start';
  const poster_spec = { qr_label: qrLabel, urls: c.product_url || '' };

  const contentHeadline = (lc.headline as string) || product;
  const contentWhat = (lc.what_it_does as string) || tagline;
  const contentFeatures = asArray(lc.features).slice(0, 6);
  const contentCta = isReferenceOnlyProductRecipe(recipe)
    ? String(lc.cta ?? '').slice(0, 80)
    : (lc.cta as string) || c.cta_text || 'Learn more';

  // poster_copy kept for backward-compat (editor fallbacks); derived straight
  // from the structured content now that the template specs are gone.
  const posterCopy = {
    hook: contentHeadline,
    what_it_does: contentWhat,
    features: contentFeatures.slice(0, 3),
    cta: contentCta,
  };

  return {
    style_profile: styleProfile,
    poster_copy: posterCopy,
    poster_content: {
      headline: contentHeadline,
      what_it_does: contentWhat,
      how_it_works: asArray(lc.how_it_works).slice(0, 4),
      why_use_it: asArray(lc.why_use_it).slice(0, 4),
      features: contentFeatures,
      cta: contentCta,
    },
    brand_essence: String(
      o.brand_essence ?? (
        isReferenceOnlyProductRecipe(recipe)
          ? `${product}: reference-led visual direction using the supplied mood, palette, and visual hook`
          : `${product}: source-faithful visual identity using its observed palette and type character`
      ),
    ).slice(0, 800),
    poster_spec,
  };
}

function fallbackContent(
  c: Record<string, string>,
  siteColors: string[] = [],
  tokens: DesignTokens | null = null,
  recipe: ProductUseCaseRecipe = resolveProductUseCaseRecipe(undefined),
): ParsedContent {
  return normalize({}, c, siteColors, tokens, recipe);
}

// =====================================================================
// Event scenario: analyze a Luma event into an EventPosterSpec + event copy.
// Logistics (date/time/location/host) are DETERMINISTIC from event_details
// (formatEventLines) — the model only writes the promo hook/blurb/RSVP label, so
// the poster can never show a wrong date. Palette/fonts reuse the shared capture.
// =====================================================================
async function analyzeEvent(args: {
  campaign: Record<string, string>;
  eventDetails: EventDetails;
  siteColors: string[];
  tokens: DesignTokens | null;
  visibleText: string;
  referenceContext: string;
  referenceImages: TypedImageReference[];
  attachedImages: TraceImageAsset[];
  trace: StageTraceRecorder;
}): Promise<ParsedContent & { prompt: { system: string; user: string } }> {
  const {
    campaign,
    eventDetails,
    siteColors,
    tokens,
    visibleText,
    referenceContext,
    referenceImages,
    attachedImages,
    trace,
  } = args;
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
    `EVENT PAGE TEXT (truncated):\n${visibleText || '(scrape failed — rely on the fields above)'}\n\n` +
    `CREATIVE CONTEXT FROM THE USER:\n${referenceContext || '(none provided)'}\n` +
    `The user supplied ${referenceImages.filter((image) => image.kind === 'user-reference').length} supporting image(s). Use them as visual references.`;
  const userContent = userContentWithImageReferences(user, referenceImages);

  let ev: Record<string, unknown> = {};
  try {
    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content: userContent },
    ];
    ev = await trace.runModelCall(
      {
        operation: 'chat',
        modelId: resolvedChatModelId(),
        prompt: { system: sys, user },
        providerSettings: { max_completion_tokens: 1600, timeout_ms: 30_000 },
        contentManifest: buildTraceContentManifest(messages, attachedImages),
      },
      async () => {
        const raw = await aiChat(messages, { maxTokens: 1600 });
        return extractJson(raw) as Record<string, unknown>;
      },
    );
  } catch (e) {
    logPipelineEvent({
      source: 'analyze',
      campaignId: campaign.id,
      status: 'degraded',
      code: 'event_analysis_ai_failed',
      detail: 'event AI chat failed — used deterministic logistics + minimal fallback copy',
      error: e,
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
