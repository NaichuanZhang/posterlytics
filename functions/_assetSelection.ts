import {
  aiChat,
  buildTraceContentManifest,
  errorDetails,
  extractJson,
  fetchImageForModel,
  jsonResponse,
  resolvedChatModelId,
  StageTraceRecorder,
  type BackendClient,
  type GenerationStageRunContext,
  type ModelImageFetcher,
  type PreparedImageReferences,
  type TraceImageAsset,
  type TraceImageSkip,
  type TypedImageReference,
} from './_shared.ts';
import { resolveProductUseCaseRecipe } from './_useCasePolicy.ts';

const MAX_SELECTED_ASSETS = 6;
const MAX_CANDIDATE_ASSETS = 50;
const MAX_VALIDATION_BYTES = 5_000_000;

interface AssetSnapshot {
  id: string;
  campaign_id: string;
  user_id: string;
  parent_generation_id: string | null;
  generation_mode: 'iteration' | 'website_refresh';
  instruction: string | null;
  reference_images: Array<Record<string, unknown>>;
  brand_assets: {
    logo_url?: string;
    logo_key?: string;
    primary_image_url?: string;
    images?: Array<{ url?: string; key?: string }>;
  } | null;
  screenshot_url: string | null;
  screenshot_key: string | null;
  scenario: string;
  use_case: string | null;
  asset_selection_mode: 'editor' | 'yolo';
  asset_selection_status: 'pending' | 'completed';
  trace_schema_version: number | null;
}

interface ParentSnapshot {
  hero_image_url: string | null;
  hero_image_key: string | null;
}

export interface GenerationAssetCandidate extends TypedImageReference {
  candidateKey: string;
}

export interface ValidatedGenerationAsset {
  id: string;
  candidate: GenerationAssetCandidate;
  candidatePosition: number;
  availability: 'available' | 'unavailable';
  availabilityReason: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  providerUrl: string | null;
}

export interface OrderedAssetSelection {
  assetIds: string[];
  reasons: Record<string, string>;
}

export interface AssetSelectionStageContext extends GenerationStageRunContext {
  jobId: string;
  workerId: string;
}

export class AssetSelectionValidationError extends Error {
  code = 'invalid_asset_selection';
  retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'AssetSelectionValidationError';
  }
}

export function buildGenerationAssetCandidates(
  generation: Pick<
    AssetSnapshot,
    'generation_mode' | 'reference_images' | 'brand_assets' | 'screenshot_url' | 'screenshot_key' | 'scenario' | 'use_case'
  >,
  parent: ParentSnapshot | null,
): GenerationAssetCandidate[] {
  const recipe = resolveProductUseCaseRecipe(generation.use_case);
  const usesSourceAssets = recipe.acquisitionMode !== 'reference-only';
  const assets = generation.brand_assets ?? {};
  const productImages = generation.scenario === 'event' || !usesSourceAssets
    ? []
    : [
        ...(assets.primary_image_url
          ? [{
              url: assets.primary_image_url,
              key: assets.images?.find((image) => image.url === assets.primary_image_url)?.key,
            }]
          : []),
        ...(assets.images ?? []).filter(
          (image): image is { url: string; key?: string } => typeof image.url === 'string' && !!image.url,
        ),
      ];
  const references: TypedImageReference[] = [
    ...(parent?.hero_image_url
      ? [{
          kind: 'previous-poster' as const,
          url: parent.hero_image_url,
          key: parent.hero_image_key ?? undefined,
          filename: 'Previous poster',
          storageSource: 'poster-version',
          purpose: generation.generation_mode === 'website_refresh'
            ? recipe.references.assetPreviousRefresh
            : recipe.references.assetPreviousIteration,
        }]
      : []),
    ...generation.reference_images
      .filter((image) => typeof image.url === 'string' && !!image.url)
      .map((image, index) => ({
        kind: 'user-reference' as const,
        url: String(image.url),
        key: typeof image.key === 'string' ? image.key : undefined,
        filename: typeof image.name === 'string' ? image.name : `Supporting image ${index + 1}`,
        mimeType: typeof image.mime_type === 'string' ? image.mime_type : undefined,
        sizeBytes: typeof image.size_bytes === 'number' ? image.size_bytes : undefined,
        storageSource: 'user-upload',
        purpose: recipe.references.assetUserReference(index + 1),
      })),
    ...(usesSourceAssets && assets.logo_url
      ? [{
          kind: 'logo' as const,
          url: assets.logo_url,
          key: assets.logo_key,
          filename: 'Brand logo',
          storageSource: 'website-asset',
          purpose: recipe.references.assetLogo,
        }]
      : []),
    ...productImages.map((image, index) => ({
      kind: 'product' as const,
      url: image.url,
      key: image.key,
      filename: `Product image ${index + 1}`,
      storageSource: 'website-asset',
      purpose: recipe.references.assetProduct(index + 1),
    })),
    ...(usesSourceAssets && generation.screenshot_url
      ? [{
          kind: 'style-board' as const,
          url: generation.screenshot_url,
          key: generation.screenshot_key ?? undefined,
          filename: 'Website style board',
          storageSource: 'website-capture',
          purpose: recipe.references.assetStyleBoard,
        }]
      : []),
  ];

  const seenKeys = new Set<string>();
  const seenUrls = new Set<string>();
  const candidates: GenerationAssetCandidate[] = [];
  for (const reference of references) {
    const normalizedUrl = normalizeCandidateUrl(reference.url);
    const normalizedKey = reference.key?.trim() || null;
    if (
      (normalizedKey && seenKeys.has(normalizedKey))
      || (normalizedUrl && seenUrls.has(normalizedUrl))
    ) {
      continue;
    }
    if (normalizedKey) seenKeys.add(normalizedKey);
    if (normalizedUrl) seenUrls.add(normalizedUrl);
    candidates.push({
      ...reference,
      candidateKey: candidateKey(reference, normalizedUrl),
    });
    if (candidates.length >= MAX_CANDIDATE_ASSETS) break;
  }
  return candidates;
}

export async function validateGenerationAssetCandidates(
  candidates: readonly GenerationAssetCandidate[],
  fetcher: ModelImageFetcher = fetchImageForModel,
): Promise<ValidatedGenerationAsset[]> {
  return Promise.all(candidates.slice(0, MAX_CANDIDATE_ASSETS).map(async (candidate, index) => {
    const result = await fetcher(candidate.url, MAX_VALIDATION_BYTES);
    if (result.ok) {
      return {
        id: crypto.randomUUID(),
        candidate,
        candidatePosition: index + 1,
        availability: 'available' as const,
        availabilityReason: null,
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
        providerUrl: result.dataUrl,
      };
    }
    return {
      id: crypto.randomUUID(),
      candidate,
      candidatePosition: index + 1,
      availability: 'unavailable' as const,
      availabilityReason: result.detail,
      mimeType: result.mimeType ?? candidate.mimeType ?? null,
      sizeBytes: result.sizeBytes ?? candidate.sizeBytes ?? null,
      providerUrl: null,
    };
  }));
}

export function validateYoloSelection(
  value: unknown,
  availableAssetIds: readonly string[],
): OrderedAssetSelection {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
  if (!record || !Array.isArray(record.selections)) {
    throw new AssetSelectionValidationError('Selection response must contain a selections array.');
  }
  if (record.selections.length > MAX_SELECTED_ASSETS) {
    throw new AssetSelectionValidationError('Selection response contains more than six assets.');
  }

  const available = new Set(availableAssetIds);
  const seen = new Set<string>();
  const assetIds: string[] = [];
  const reasons: Record<string, string> = {};
  for (const item of record.selections) {
    const selection = item && typeof item === 'object'
      ? item as Record<string, unknown>
      : null;
    const id = typeof selection?.id === 'string' ? selection.id.trim() : '';
    const reason = typeof selection?.reason === 'string' ? selection.reason.trim() : '';
    if (!id || !available.has(id)) {
      throw new AssetSelectionValidationError('Selection response contains an unknown or unavailable asset id.');
    }
    if (seen.has(id)) {
      throw new AssetSelectionValidationError('Selection response contains a duplicate asset id.');
    }
    if (!reason) {
      throw new AssetSelectionValidationError('Every selected asset must include a reason.');
    }
    seen.add(id);
    assetIds.push(id);
    reasons[id] = reason.slice(0, 1000);
  }
  return { assetIds, reasons };
}

export function deterministicAssetSelection(
  assets: readonly ValidatedGenerationAsset[],
  generationMode: 'iteration' | 'website_refresh',
): OrderedAssetSelection {
  const priority = generationMode === 'website_refresh'
    ? {
        'previous-poster': 0,
        'style-board': 1,
        'user-reference': 2,
        logo: 3,
        product: 4,
      }
    : {
        'previous-poster': 0,
        'user-reference': 1,
        logo: 2,
        product: 3,
        'style-board': 4,
      };
  const selected = assets
    .filter((asset) => asset.availability === 'available')
    .map((asset, index) => ({ asset, index }))
    .sort((a, b) =>
      priority[a.asset.candidate.kind] - priority[b.asset.candidate.kind]
      || a.index - b.index
    )
    .slice(0, MAX_SELECTED_ASSETS)
    .map(({ asset }) => asset);
  return {
    assetIds: selected.map((asset) => asset.id),
    reasons: Object.fromEntries(selected.map((asset) => [
      asset.id,
      fallbackReason(asset.candidate.kind, generationMode),
    ])),
  };
}

export async function runAssetSelectionStage(
  context: AssetSelectionStageContext,
): Promise<Response> {
  const {
    client,
    userId,
    campaignId,
    generationId,
    jobId,
    workerId,
  } = context;
  const generation = await loadGeneration(client, context);
  if (!generation) return jsonResponse({ error: 'poster generation not found' }, 404);
  if (generation.trace_schema_version !== 2) {
    return jsonResponse({ error: 'asset selection is only valid for trace-v2 generations' }, 409);
  }
  if (generation.asset_selection_status === 'completed') {
    return jsonResponse({ generation_id: generation.id, idempotent: true });
  }

  const parent = await loadParent(client, generation);
  const trace = new StageTraceRecorder(client, {
    generationId,
    campaignId,
    userId,
    stage: 'assets',
  });
  await trace.start();

  const candidates = buildGenerationAssetCandidates(generation, parent);
  const validated = await validateGenerationAssetCandidates(candidates);
  const defaultSelection = deterministicAssetSelection(validated, generation.generation_mode);
  const initialSelection = generation.asset_selection_mode === 'editor'
    ? defaultSelection
    : { assetIds: [], reasons: {} };
  const rows = validated.map((asset) =>
    generationAssetRpcRow(asset, initialSelection)
  );
  const { error: replaceError } = await client.database.rpc(
    'replace_generation_assets_for_worker',
    {
      p_generation_id: generationId,
      p_user_id: userId,
      p_assets: rows,
    },
  );
  if (replaceError) throw new Error(replaceError.message);

  const preparedTrace = preparedAssetTrace(validated);
  await trace.setImages(preparedTrace);

  if (generation.asset_selection_mode === 'editor') {
    const { error: pauseError } = await client.database.rpc(
      'pause_generation_for_asset_review',
      {
        p_job_id: jobId,
        p_worker_id: workerId,
      },
    );
    if (pauseError) throw new Error(pauseError.message);
    return jsonResponse({
      generation_id: generationId,
      awaiting_review: true,
      candidate_count: validated.length,
      selected_count: initialSelection.assetIds.length,
    });
  }

  let selection = defaultSelection;
  let method: 'ai' | 'rules_fallback' = 'rules_fallback';
  let aiAttempts = 0;
  let fallbackDetail: string | null = null;
  const available = validated.filter((asset) => asset.availability === 'available');
  if (available.length > 0) {
    try {
      selection = await selectAssetsWithAi(trace, generation, available, false);
      method = 'ai';
      aiAttempts = 1;
    } catch (firstError) {
      aiAttempts = 1;
      try {
        selection = await selectAssetsWithAi(trace, generation, available, true);
        method = 'ai';
        aiAttempts = 2;
      } catch (secondError) {
        aiAttempts = 2;
        fallbackDetail = errorDetails(secondError).message.slice(0, 500);
      }
    }
  } else {
    fallbackDetail = 'No validated image candidates were available.';
  }

  const { error: completeError } = await client.database.rpc(
    'complete_generation_asset_selection_for_worker',
    {
      p_generation_id: generationId,
      p_user_id: userId,
      p_asset_ids: selection.assetIds,
      p_reasons: selection.reasons,
      p_method: method,
    },
  );
  if (completeError) throw new Error(completeError.message);
  await trace.succeed({
    selection_mode: 'yolo',
    selection_method: method,
    selected_count: selection.assetIds.length,
    zero_selection: selection.assetIds.length === 0,
    ai_attempts: aiAttempts,
    fallback: method === 'rules_fallback',
    ...(fallbackDetail ? { fallback_detail: fallbackDetail } : {}),
  });
  return jsonResponse({
    generation_id: generationId,
    selection_method: method,
    selected_asset_ids: selection.assetIds,
    ai_attempts: aiAttempts,
  });
}

async function selectAssetsWithAi(
  trace: StageTraceRecorder,
  generation: AssetSnapshot,
  assets: readonly ValidatedGenerationAsset[],
  repair: boolean,
): Promise<OrderedAssetSelection> {
  const system = [
    'You select image inputs for a poster generation pipeline.',
    'Return STRICT JSON only with this shape:',
    '{"selections":[{"id":"candidate UUID","reason":"specific selection reason"}]}',
    'Choose zero to six candidates. Keep selections in the exact order both downstream models should receive them.',
    'Use only candidate IDs supplied by the user. Every selected candidate requires a non-empty reason.',
    repair ? 'The previous response was invalid. Return only valid minified JSON matching the schema.' : '',
  ].filter(Boolean).join(' ');
  const candidateSummary = assets.map((asset) => ({
    id: asset.id,
    source: asset.candidate.kind,
    filename: asset.candidate.filename ?? null,
    purpose: asset.candidate.purpose,
    candidate_position: asset.candidatePosition,
  }));
  const user = [
    `Generation mode: ${generation.generation_mode}`,
    `Campaign scenario: ${generation.scenario}`,
    `User instruction: ${generation.instruction?.trim() || '(none)'}`,
    `Validated candidates: ${JSON.stringify(candidateSummary)}`,
  ].join('\n');
  const visualAssets = assets.slice(0, MAX_SELECTED_ASSETS);
  const content: unknown[] = [{ type: 'text', text: user }];
  const attachedImages: TraceImageAsset[] = [];
  for (const [index, asset] of visualAssets.entries()) {
    content.push({
      type: 'text',
      text: `CANDIDATE ${asset.id} [${asset.candidate.kind.toUpperCase()}]`,
    });
    content.push({ type: 'image_url', image_url: { url: asset.providerUrl } });
    attachedImages.push(traceAsset(asset, index + 1));
  }
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content },
  ];
  return trace.runModelCall(
    {
      operation: 'chat',
      modelId: resolvedChatModelId(),
      prompt: { system, user },
      providerSettings: { max_completion_tokens: 900, timeout_ms: 30_000 },
      contentManifest: buildTraceContentManifest(messages, attachedImages),
    },
    async () => {
      const raw = await aiChat(messages, { maxTokens: 900 });
      return validateYoloSelection(
        extractJson(raw),
        assets.map((asset) => asset.id),
      );
    },
  );
}

async function loadGeneration(
  client: BackendClient,
  context: Pick<GenerationStageRunContext, 'generationId' | 'campaignId' | 'userId'>,
): Promise<AssetSnapshot | null> {
  const { data, error } = await client.database
    .from('poster_generations')
    .select('id, campaign_id, user_id, parent_generation_id, generation_mode, instruction, reference_images, brand_assets, screenshot_url, screenshot_key, scenario, use_case, asset_selection_mode, asset_selection_status, trace_schema_version')
    .eq('id', context.generationId)
    .eq('campaign_id', context.campaignId)
    .eq('user_id', context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as AssetSnapshot | null;
}

async function loadParent(
  client: BackendClient,
  generation: AssetSnapshot,
): Promise<ParentSnapshot | null> {
  if (!generation.parent_generation_id) return null;
  const { data, error } = await client.database
    .from('poster_generations')
    .select('hero_image_url, hero_image_key')
    .eq('id', generation.parent_generation_id)
    .eq('campaign_id', generation.campaign_id)
    .eq('user_id', generation.user_id)
    .eq('status', 'ready')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as ParentSnapshot | null;
}

function generationAssetRpcRow(
  asset: ValidatedGenerationAsset,
  selection: OrderedAssetSelection,
): Record<string, unknown> {
  const selectionIndex = selection.assetIds.indexOf(asset.id);
  return {
    id: asset.id,
    candidate_key: asset.candidate.candidateKey,
    source: asset.candidate.kind,
    url: asset.candidate.url,
    key: asset.candidate.key ?? null,
    filename: asset.candidate.filename ?? null,
    mime_type: asset.mimeType,
    size_bytes: asset.sizeBytes,
    storage_source: asset.candidate.storageSource ??
      (asset.candidate.key ? 'insforge-storage' : 'external-url'),
    purpose: asset.candidate.purpose,
    metadata: {
      validation: {
        max_bytes: MAX_VALIDATION_BYTES,
        status: asset.availability,
      },
    },
    availability: asset.availability,
    availability_reason: asset.availabilityReason,
    included: selectionIndex !== -1,
    selection_rank: selectionIndex === -1 ? null : selectionIndex + 1,
    selection_reason: selection.reasons[asset.id] ?? (
      asset.availability === 'unavailable'
        ? asset.availabilityReason
        : 'Available for selection.'
    ),
    candidate_position: asset.candidatePosition,
  };
}

function preparedAssetTrace(
  assets: readonly ValidatedGenerationAsset[],
): PreparedImageReferences {
  const candidateImages = assets.map((asset) => traceAsset(asset, null));
  const attachedImages = assets
    .filter((asset) => asset.availability === 'available')
    .slice(0, MAX_SELECTED_ASSETS)
    .map((asset, index) => traceAsset(asset, index + 1));
  const providerReferences = assets
    .filter((asset) => asset.availability === 'available')
    .slice(0, MAX_SELECTED_ASSETS)
    .map((asset) => ({
      ...asset.candidate,
      assetId: asset.id,
      url: asset.providerUrl!,
      mimeType: asset.mimeType ?? undefined,
      sizeBytes: asset.sizeBytes ?? undefined,
    }));
  const skippedImages: TraceImageSkip[] = assets
    .filter((asset) => asset.availability === 'unavailable')
    .map((asset) => ({
      asset: traceAsset(asset, null),
      reason: validationSkipReason(asset),
      detail: asset.availabilityReason ?? 'Candidate image validation failed.',
    }));
  return { providerReferences, candidateImages, attachedImages, skippedImages };
}

function traceAsset(
  asset: ValidatedGenerationAsset,
  modelPosition: number | null,
): TraceImageAsset {
  return {
    asset_id: asset.id,
    source: asset.candidate.kind,
    purpose: asset.candidate.purpose,
    url: asset.candidate.url,
    key: asset.candidate.key ?? null,
    filename: asset.candidate.filename ?? null,
    mime_type: asset.mimeType,
    size_bytes: asset.sizeBytes,
    storage_source: asset.candidate.storageSource ??
      (asset.candidate.key ? 'insforge-storage' : 'external-url'),
    candidate_position: asset.candidatePosition,
    model_position: modelPosition,
  };
}

function validationSkipReason(asset: ValidatedGenerationAsset): TraceImageSkip['reason'] {
  const detail = asset.availabilityReason ?? '';
  if (/unsupported/i.test(detail)) return 'unsupported_format';
  if (/empty/i.test(detail)) return 'empty_image';
  if (/exceeds|too large/i.test(detail)) return 'image_too_large';
  return 'fetch_failed';
}

function fallbackReason(
  kind: TypedImageReference['kind'],
  mode: 'iteration' | 'website_refresh',
): string {
  const modeReason = mode === 'website_refresh'
    ? 'for refreshed source fidelity'
    : 'for the requested iteration';
  switch (kind) {
    case 'previous-poster':
      return `Preserves visual continuity ${modeReason}.`;
    case 'style-board':
      return `Carries verified website styling ${modeReason}.`;
    case 'user-reference':
      return `Applies explicit user-supplied visual direction ${modeReason}.`;
    case 'logo':
      return 'Preserves the authentic brand mark.';
    case 'product':
      return 'Preserves authentic product imagery.';
  }
}

function normalizeCandidateUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href;
  } catch {
    return value.trim();
  }
}

function candidateKey(reference: TypedImageReference, normalizedUrl: string): string {
  const identity = reference.key?.trim()
    ? `key:${reference.key.trim()}`
    : `url:${normalizedUrl}`;
  const hash = fnv1a(identity);
  return `${identity.slice(0, 480)}:${hash}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
