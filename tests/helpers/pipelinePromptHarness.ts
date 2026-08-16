import { runAnalyzeStage } from '../../functions/analyze.ts'
import { runAssetSelectionStage } from '../../functions/_assetSelection.ts'
import { runDesignerStage } from '../../functions/designer.ts'
import { runHeroStage } from '../../functions/hero.ts'
import {
  deriveRedNoteBackgroundLayout,
} from '../../functions/_redNoteBackground.ts'
import {
  isReferenceOnlyUseCaseId,
  type UseCaseId,
} from '../../src/lib/useCases.ts'

type PipelineStage = 'analyze' | 'assets' | 'designer' | 'hero'

interface HarnessTrace {
  status: string
  started_at: string | null
  model_calls: unknown[]
  artifacts: unknown[]
  failure_metadata?: Record<string, unknown>
}

interface HarnessState {
  campaign: Record<string, unknown>
  generation: Record<string, unknown>
  parent: Record<string, unknown> | null
  traces: Record<PipelineStage, HarnessTrace>
  captureServiceResponse: {
    status: number
    body: Record<string, unknown>
  } | null
  captureRequests: Array<Record<string, unknown>>
  captureLogs: string[]
  warningLogs: string[]
  storageUploads: string[]
  storageUploadBodies: Array<{ key: string; bytes: number[] }>
  storageRemovals: string[]
  storageObjects: Map<string, number[]>
  failStorageUploadKeys: Set<string>
  failStorageRemoveKeys: Set<string>
  operationLog: string[]
  sourceHtmlOverride: string | null
  htmlRequests: string[]
  imageUrls: Set<string>
  sourceImageRequests: string[]
  openRouterRequests: Array<Record<string, unknown>>
  imagePrompts: string[]
  imageResponses: string[]
  painterValidationEnabled: string | undefined
  rpcCalls: string[]
  chatRequests: number
  imageRequests: number
}

export interface PipelinePromptGoldens {
  analyze: {
    website_product: { system: string; user: string }
    amazon_listing: { system: string; user: string }
    social_cover: { system: string; user: string }
    rednote_post: { system: string; user: string }
    event: { system: string; user: string }
  }
  designer: {
    website_product: { system: string; user: string }
    amazon_listing: { system: string; user: string }
    social_cover: { system: string; user: string }
    rednote_post: {
      prompt: null
      layout: Record<string, unknown>
    }
  }
  hero: {
    website_product: string
    amazon_listing: string
    social_cover: string
    rednote_post: string
    event: string
  }
}

export interface SocialCoverQrPromptGoldens {
  designer: { system: string; user: string }
  hero: string
}

export interface RedNotePipelineDiagnostics {
  analyzeChatCalls: number
  analyzeImageCalls: number
  assetChatCalls: number
  assetImageCalls: number
  designerChatCalls: number
  designerImageCalls: number
  heroChatCalls: number
  heroImageCalls: number
  wroteRedNotePost: boolean
  persistedPosterContent: unknown
  redNoteSchemaVersion: unknown
  redNotePageCount: unknown
  persistedRenderMode: unknown
  designerArtifactRenderMode: unknown
  campaignRenderMode: unknown
}

export interface HeroArtifactValidationDiagnostics {
  responseStatus: number
  responsePrompt: string | null
  generationStatus: unknown
  heroImageUrl: unknown
  heroImageKey: unknown
  chatRequests: number
  imageRequests: number
  imagePrompts: string[]
  chatBodies: Array<Record<string, unknown>>
  storageUploads: string[]
  storageRemovals: string[]
  initialPosterKey: string
  retryPosterKey: string
  storedPosterKeys: string[]
  finalPosterBytes: number[] | null
  operationLog: string[]
  warningLogs: string[]
  rpcCalls: string[]
  modelCalls: unknown[]
  traceMetadata: Record<string, unknown>
}

const USER_ID = 'user-fixture'
const CAMPAIGN_ID = 'campaign-fixture'
const GENERATION_ID = 'generation-fixture'
export const HERO_FIXTURE_POSTER_KEY =
  `poster/${CAMPAIGN_ID}/${GENERATION_ID}/poster.png`
export const HERO_FIXTURE_RETRY_POSTER_KEY =
  `poster/${CAMPAIGN_ID}/${GENERATION_ID}/poster.retry.png`
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const CAPTURE_SERVICE_URL = 'https://capture.fixture'
const SOCIAL_REFERENCE_URL = 'https://assets.example/social-reference.png'
const CHAT_FAILURE = Symbol('chat-failure')
type ChatFixture = Record<string, unknown> | string | null | typeof CHAT_FAILURE

const CLEAN_PAINTER_VERDICT = {
  has_decorative_glyphs: false,
  has_slot_label_words: false,
  has_adjacent_duplicate_words: false,
  notes: '',
}

const PRODUCT_LAYOUT = {
  composition: 'asymmetric editorial stack',
  mood: 'precise, confident',
  art_style: 'crisp geometric print design',
  imagery: 'one isolated product close-up',
  typography_treatment: 'high-contrast grotesk hierarchy',
  lighting: 'soft directional studio light',
  texture: 'subtle uncoated paper grain',
  motifs: ['thin registration lines'],
  density: 'balanced',
  palette_roles: {
    bg: '#f7f4ed',
    text: '#152238',
    primary: '#235789',
    accent: '#f45b69',
    supporting: ['#70c1b3'],
    proportions: [
      { color: '#f7f4ed', proportion: 0.68 },
      { color: '#235789', proportion: 0.2 },
    ],
  },
  zones: [
    {
      band: 'top',
      role: 'plain-text brand row',
      content: 'Northstar',
      emphasis: 'low',
      align: 'left',
    },
    {
      band: 'upper',
      role: 'hero headline',
      content: 'See the signal',
      emphasis: 'high',
      align: 'left',
    },
    {
      band: 'mid',
      role: 'product detail',
      content: 'Decisions without delay',
      emphasis: 'med',
      align: 'left',
    },
  ],
}

const SOCIAL_LAYOUT = {
  ...PRODUCT_LAYOUT,
  composition: 'full-bleed diagonal editorial sweep',
  mood: 'kinetic, luminous',
  art_style: 'layered editorial collage',
  imagery: 'silhouetted figure crossing a luminous field',
  typography_treatment: 'condensed display type with quiet supporting text',
  lighting: 'hard side light with a saturated glow',
  texture: 'fine photographic grain',
  motifs: ['cropped circles', 'diagonal light bands'],
  palette_roles: {
    bg: '#111111',
    text: '#f7f4ed',
    primary: '#f45b69',
    accent: '#70c1b3',
    supporting: ['#235789'],
    proportions: [
      { color: '#111111', proportion: 0.62 },
      { color: '#f45b69', proportion: 0.2 },
    ],
  },
  zones: [
    {
      band: 'top',
      role: 'plain-text identity line',
      content: 'Summer Signals',
      emphasis: 'low',
      align: 'left',
    },
    {
      band: 'upper',
      role: 'visual hook headline',
      content: 'Follow the light',
      emphasis: 'high',
      align: 'left',
    },
    {
      band: 'mid',
      role: 'supporting artwork detail',
      content: 'A new season in motion',
      emphasis: 'med',
      align: 'left',
    },
  ],
}

const REDNOTE_MODEL_PLAN = {
  schema_version: 1,
  pages: [
    {
      kind: 'cover',
      title: 'Make the light the hook',
      subtitle: 'Keep the mood kinetic',
    },
    {
      kind: 'content',
      heading: 'Lead with motion',
      blocks: ['Build the composition around a diagonal sweep.'],
    },
    {
      kind: 'content',
      heading: 'Hold the focus',
      blocks: ['Let the light band carry the visual hook.'],
    },
  ],
}

export async function captureCurrentPipelinePromptGoldens(): Promise<PipelinePromptGoldens> {
  return {
    analyze: {
      website_product: await captureAnalyzePrompt(
        'website_product',
        'https://example.com/products/northstar',
        'product',
      ),
      amazon_listing: await captureAnalyzePrompt(
        'amazon_listing',
        'https://www.amazon.com/dp/B0FIXTURE1',
        'product',
      ),
      social_cover: await captureAnalyzePrompt(
        'social_cover',
        null,
        'product',
      ),
      rednote_post: await captureAnalyzePrompt(
        'rednote_post',
        null,
        'product',
      ),
      event: await captureAnalyzePrompt(
        'event',
        'https://lu.ma/fixture-summit',
        'event',
      ),
    },
    designer: {
      website_product: await captureDesignerPrompt('website_product'),
      amazon_listing: await captureDesignerPrompt('amazon_listing'),
      social_cover: await captureDesignerPrompt('social_cover'),
      rednote_post: await captureRedNoteDesignerArtifact(),
    },
    hero: {
      website_product: await captureHeroPrompt('website_product', 'product'),
      amazon_listing: await captureHeroPrompt('amazon_listing', 'product'),
      social_cover: await captureHeroPrompt('social_cover', 'product'),
      rednote_post: await captureHeroPrompt('rednote_post', 'product'),
      event: await captureHeroPrompt('event', 'event'),
    },
  }
}

export async function captureSocialCoverQrPromptGoldens(): Promise<
  SocialCoverQrPromptGoldens
> {
  const designerState = createSocialCoverQrState()
  const heroState = createSocialCoverQrState()
  return {
    designer: await captureDesignerPromptForState(
      designerState,
      'social_cover_qr',
    ),
    hero: await captureHeroPromptForState(heroState, 'social_cover_qr'),
  }
}

export async function captureRedNotePipelineDiagnostics(): Promise<RedNotePipelineDiagnostics> {
  const analyzeState = createState('rednote_post', null, 'product')
  await withHarnessGlobals(
    analyzeState,
    productAnalyzeResponse('rednote_post'),
    () => runAnalyzeStage({
      client: createHarnessClient(analyzeState) as never,
      userId: USER_ID,
      campaignId: CAMPAIGN_ID,
      generationId: GENERATION_ID,
      colorScheme: 'light',
      finalizeFailure: false,
      serverOwned: true,
    }),
  )

  const designerState = createState('rednote_post', null, 'product')
  await withHarnessGlobals(
    designerState,
    designerResponse(),
    () => runDesignerStage({
      client: createHarnessClient(designerState) as never,
      userId: USER_ID,
      campaignId: CAMPAIGN_ID,
      generationId: GENERATION_ID,
      finalizeFailure: false,
      serverOwned: true,
    }),
  )

  const assetState = createState('rednote_post', null, 'product')
  assetState.generation.trace_schema_version = 2
  assetState.generation.asset_selection_mode = 'yolo'
  assetState.generation.asset_selection_status = 'pending'
  await withHarnessGlobals(
    assetState,
    null,
    () => runAssetSelectionStage({
      client: createHarnessClient(assetState) as never,
      userId: USER_ID,
      campaignId: CAMPAIGN_ID,
      generationId: GENERATION_ID,
      jobId: 'job-fixture',
      workerId: 'worker-fixture',
      finalizeFailure: false,
      serverOwned: true,
    }),
  )

  const heroState = createState('rednote_post', null, 'product')
  await withHarnessGlobals(
    heroState,
    CLEAN_PAINTER_VERDICT,
    () => runHeroStage({
      client: createHarnessClient(heroState) as never,
      userId: USER_ID,
      campaignId: CAMPAIGN_ID,
      generationId: GENERATION_ID,
      finalizeFailure: false,
      serverOwned: true,
    }),
  )

  const analysisMetadata = analysisArtifactMetadata(analyzeState)
  return {
    analyzeChatCalls: analyzeState.chatRequests,
    analyzeImageCalls: analyzeState.imageRequests,
    assetChatCalls: assetState.chatRequests,
    assetImageCalls: assetState.imageRequests,
    designerChatCalls: designerState.chatRequests,
    designerImageCalls: designerState.imageRequests,
    heroChatCalls: heroState.chatRequests,
    heroImageCalls: heroState.imageRequests,
    wroteRedNotePost: [analyzeState, designerState, heroState]
      .some(hasRedNotePostPlan),
    persistedPosterContent: structuredClone(
      analyzeState.generation.poster_content,
    ),
    redNoteSchemaVersion: analysisMetadata.rednote_schema_version,
    redNotePageCount: analysisMetadata.rednote_page_count,
    persistedRenderMode: (
      designerState.generation.poster_layout as Record<string, unknown>
    ).render_mode,
    designerArtifactRenderMode: layoutArtifactRenderMode(designerState),
    campaignRenderMode: (
      heroState.campaign.poster_layout as Record<string, unknown>
    ).render_mode,
  }
}

export async function captureRedNoteAnalyzeFallbackDiagnostics(): Promise<{
  analyzeChatCalls: number
  analyzeImageCalls: number
  usedFallback: unknown
  posterContent: unknown
}> {
  const state = createState('rednote_post', null, 'product')
  await withHarnessGlobals(
    state,
    CHAT_FAILURE,
    () => runAnalyzeStage({
      client: createHarnessClient(state) as never,
      userId: USER_ID,
      campaignId: CAMPAIGN_ID,
      generationId: GENERATION_ID,
      colorScheme: 'light',
      finalizeFailure: false,
      serverOwned: true,
    }),
  )

  return {
    analyzeChatCalls: state.chatRequests,
    analyzeImageCalls: state.imageRequests,
    usedFallback: analysisArtifactMetadata(state).used_fallback,
    posterContent: structuredClone(state.generation.poster_content),
  }
}

export async function runAnalyzeMismatchCompatibility(
  useCase: Extract<UseCaseId, 'website_product' | 'amazon_listing'>,
  productUrl: string,
): Promise<{
  status: number
  payload: Record<string, unknown>
  generation: Record<string, unknown>
}> {
  const state = createState(useCase, productUrl, 'product')
  const response = await runAnalyzeStage({
    client: createHarnessClient(state) as never,
    userId: USER_ID,
    campaignId: CAMPAIGN_ID,
    generationId: GENERATION_ID,
    colorScheme: 'light',
    finalizeFailure: true,
    serverOwned: false,
  })
  return {
    status: response.status,
    payload: await response.json() as Record<string, unknown>,
    generation: structuredClone(state.generation),
  }
}

export async function captureAnalyzeSourceMode(
  useCase: Extract<
    UseCaseId,
    'website_product' | 'amazon_listing' | 'social_cover' | 'rednote_post'
  >,
  productUrl: string | null,
): Promise<unknown> {
  const state = createState(useCase, productUrl, 'product')
  await withHarnessGlobals(
    state,
    productAnalyzeResponse(useCase),
    () => runAnalyzeStage({
      client: createHarnessClient(state) as never,
      userId: USER_ID,
      campaignId: CAMPAIGN_ID,
      generationId: GENERATION_ID,
      colorScheme: 'light',
      finalizeFailure: false,
      serverOwned: true,
    }),
  )
  const artifact = (state.traces.analyze.artifacts as Array<{
    kind?: unknown
    metadata?: Record<string, unknown>
  }>).find((candidate) => candidate.kind === 'analysis')
  return artifact?.metadata?.source_mode
}

/**
 * Runs analyze against a capture outcome that carries no usable evidence, and
 * reports which images the stage put forward as evidence.
 *
 * `empty-evidence` is the hole this exists for: the capture service answers 200
 * with neither tokens nor a style board, so `error` is null and the attempt looks
 * successful while carrying nothing. `with-board` is the control — same HTML, same
 * scraped assets, but a real style board — and must stay unchanged.
 *
 * Reports the trace's `candidate_images` rather than the provider payload: the
 * candidate list is what this stage decides to offer, recorded before any fetch or
 * byte-budget trimming, so the assertion tests the decision and not the fixture's
 * image plumbing.
 */
export async function runAnalyzeSourceAssetFallbackHarness(
  variant: 'empty-evidence' | 'with-board',
): Promise<{
  prompt: string
  candidateKinds: string[]
  candidatePurposes: string[]
  candidateUrls: string[]
}> {
  const productUrl = 'https://example.com/products/northstar'
  const state = createState('website_product', productUrl, 'product')
  state.sourceHtmlOverride = `<!doctype html>
    <html>
      <head>
        <meta name="theme-color" content="#235789">
        <meta property="og:logo" content="https://source.example/scraped-logo.png">
        <meta property="og:image" content="https://source.example/scraped-product.jpg">
      </head>
      <body>Northstar turns operational data into decisions without delay.</body>
    </html>`
  // Both scraped assets must be fetchable so rehostBrandAssets can re-host them —
  // the candidates under test carry the re-hosted URLs, never the origin ones.
  for (const url of [
    'https://source.example/scraped-logo.png',
    'https://source.example/scraped-product.jpg',
  ]) {
    state.imageUrls.add(url)
  }
  state.captureServiceResponse = variant === 'with-board'
    ? {
        status: 200,
        body: {
          screenshot_b64: 'AAECAwQ=',
          raw_tokens: {
            colors: {
              bg: '#ffffff',
              text: '#101010',
              primary: '#235789',
              accent: '#f45b69',
              palette: [{ color: '#ffffff', proportion: 0.8 }],
            },
            fonts: { heading: 'Inter', body: 'Inter' },
          },
        },
      }
    // 200, no tokens, no board: reports error === null while carrying nothing.
    : { status: 200, body: {} }
  await withHarnessGlobals(
    state,
    productAnalyzeResponse('website_product'),
    () => runAnalyzeStage({
      client: createHarnessClient(state) as never,
      userId: USER_ID,
      campaignId: CAMPAIGN_ID,
      generationId: GENERATION_ID,
      colorScheme: 'light',
      finalizeFailure: false,
      serverOwned: true,
    }),
  )
  const call = (state.traces.analyze.model_calls as Array<{
    prompt?: { user?: unknown }
  }>)[0]
  const candidates = ((state.traces.analyze as unknown as {
    candidate_images?: Array<{ source?: unknown; purpose?: unknown; url?: unknown }>
  }).candidate_images ?? [])
  return {
    prompt: String(call?.prompt?.user ?? ''),
    candidateKinds: candidates.map((image) => String(image.source ?? '')),
    candidatePurposes: candidates.map((image) => String(image.purpose ?? '')),
    candidateUrls: candidates.map((image) => String(image.url ?? '')),
  }
}

/**
 * Runs analyze for a campaign declaring several source URLs, and reports what was
 * actually acquired. The fixture fetch handler throws on any URL other than
 * `product_url`, so a stray acquisition of URL 2 or 3 fails loudly rather than
 * being counted.
 */
export async function runAnalyzeSourceUrlsHarness(
  sourceUrls: readonly string[],
): Promise<{
  prompt: string
  htmlRequests: string[]
  captureRequests: Array<Record<string, unknown>>
}> {
  const state = createState('website_product', sourceUrls[0] ?? null, 'product')
  state.campaign.source_urls = [...sourceUrls]
  state.captureServiceResponse = {
    status: 200,
    body: {
      screenshot_b64: 'AAECAwQ=',
      raw_tokens: {
        colors: {
          bg: '#ffffff',
          text: '#101010',
          primary: '#235789',
          accent: '#f45b69',
          palette: [{ color: '#ffffff', proportion: 0.8 }],
        },
        fonts: { heading: 'Inter', body: 'Inter' },
      },
    },
  }
  await withHarnessGlobals(
    state,
    productAnalyzeResponse('website_product'),
    () => runAnalyzeStage({
      client: createHarnessClient(state) as never,
      userId: USER_ID,
      campaignId: CAMPAIGN_ID,
      generationId: GENERATION_ID,
      colorScheme: 'light',
      finalizeFailure: false,
      serverOwned: true,
    }),
  )
  const call = (state.traces.analyze.model_calls as Array<{
    prompt?: { user?: unknown }
  }>)[0]
  return {
    prompt: String(call?.prompt?.user ?? ''),
    htmlRequests: [...state.htmlRequests],
    captureRequests: [...state.captureRequests],
  }
}

export async function runAnalyzeEagerCaptureHarness(
  scenario: 'reuse' | 'selection' | 'stale' | 'no-preview',
): Promise<{
  status: number
  captureRequests: Array<Record<string, unknown>>
  captureLogs: string[]
  storageUploads: string[]
  sourceImageRequests: string[]
  generation: Record<string, unknown>
  traceMetadata: Record<string, unknown>
}> {
  const productUrl = 'https://example.com/products/northstar'
  const state = createState('website_product', productUrl, 'product')
  const captureId = '10000000-0000-4000-8000-000000000001'
  const boardKey = `style-board/${CAMPAIGN_ID}/eager/${captureId}.jpg`
  const boardUrl = `https://assets.example/${boardKey}`
  const sourceBrandAssets = scenario === 'selection'
    ? {
        logo_url: 'https://source.example/eager-logo.png',
        images: [
          { url: 'https://source.example/eager-product-two.jpg' },
          { url: 'https://source.example/eager-product-one.jpg' },
          { url: 'https://source.example/eager-product-excluded.jpg' },
        ],
        primary_image_url: 'https://source.example/eager-product-two.jpg',
        eager_selection: {
          version: 1,
          excluded_urls: [
            'https://source.example/eager-product-excluded.jpg',
          ],
          logo_excluded: true,
        },
      }
    : {
        logo_url: 'https://source.example/eager-logo.png',
        images: [{ url: 'https://source.example/eager-product.jpg' }],
        primary_image_url: 'https://source.example/eager-product.jpg',
      }
  const tokens = captureDesignTokens()

  state.sourceHtmlOverride = `<!doctype html>
    <html>
      <head>
        <meta property="og:logo" content="https://source.example/fresh-logo.png">
        <meta property="og:image" content="${
          scenario === 'selection'
            ? 'https://source.example/eager-product-excluded.jpg'
            : 'https://source.example/fresh-product.jpg'
        }">
      </head>
      ${scenario === 'selection'
        ? '<img src="https://source.example/fresh-only.jpg">'
        : ''}
      <body>Northstar turns operational data into decisions without delay.</body>
    </html>`
  for (const url of [
    boardUrl,
    'https://source.example/eager-logo.png',
    'https://source.example/eager-product.jpg',
    'https://source.example/fresh-product.jpg',
    'https://source.example/eager-product-one.jpg',
    'https://source.example/eager-product-two.jpg',
    'https://source.example/eager-product-excluded.jpg',
    'https://source.example/fresh-only.jpg',
  ]) {
    state.imageUrls.add(url)
  }
  state.captureServiceResponse = scenario === 'stale'
    ? {
        status: 503,
        body: {
          error: {
            code: 'capture_failed',
            message: 'fixture capture failed',
            retryable: true,
          },
        },
      }
    : {
        status: 200,
        body: {
          tokens,
          screenshot_b64: 'YWJj',
        },
      }

  if (scenario !== 'no-preview') {
    const capturedAt = new Date(
      Date.now() - (scenario === 'stale' ? 31 * 60 * 1000 : 60 * 1000),
    ).toISOString()
    state.campaign = {
      ...state.campaign,
      design_tokens: structuredClone(tokens),
      brand_assets: structuredClone(sourceBrandAssets),
      screenshot_url: boardUrl,
      screenshot_key: boardKey,
      eager_capture_url: productUrl,
      eager_capture_color_scheme: 'light',
      eager_captured_at: capturedAt,
    }
    state.generation = {
      ...state.generation,
      parent_generation_id: null,
      design_tokens: structuredClone(tokens),
      brand_assets: structuredClone(sourceBrandAssets),
      screenshot_url: boardUrl,
      screenshot_key: boardKey,
    }
  }

  const response = await withHarnessGlobals(
    state,
    productAnalyzeResponse(),
    () => runAnalyzeStage({
      client: createHarnessClient(state) as never,
      userId: USER_ID,
      campaignId: CAMPAIGN_ID,
      generationId: GENERATION_ID,
      colorScheme: 'light',
      finalizeFailure: false,
      serverOwned: true,
    }),
  )
  const artifact = (state.traces.analyze.artifacts as Array<{
    kind?: unknown
    metadata?: Record<string, unknown>
  }>).find((candidate) => candidate.kind === 'analysis')

  return {
    status: response.status,
    captureRequests: structuredClone(state.captureRequests),
    captureLogs: [...state.captureLogs],
    storageUploads: [...state.storageUploads],
    sourceImageRequests: [...state.sourceImageRequests],
    generation: structuredClone(state.generation),
    traceMetadata: structuredClone(artifact?.metadata ?? {}),
  }
}

async function captureAnalyzePrompt(
  useCase: UseCaseId,
  productUrl: string | null,
  scenario: 'product' | 'event',
): Promise<{ system: string; user: string }> {
  const state = createState(useCase, productUrl, scenario)
  const response = await withHarnessGlobals(
    state,
    scenario === 'event'
      ? eventAnalyzeResponse()
      : productAnalyzeResponse(useCase),
    () => runAnalyzeStage({
      client: createHarnessClient(state) as never,
      userId: USER_ID,
      campaignId: CAMPAIGN_ID,
      generationId: GENERATION_ID,
      colorScheme: 'light',
      finalizeFailure: false,
      serverOwned: true,
    }),
  )
  const payload = await response.json() as {
    prompt?: { system?: unknown; user?: unknown }
  }
  return requireChatPrompt(payload.prompt, `analyze:${useCase}`)
}

async function captureDesignerPrompt(
  useCase: Extract<
    UseCaseId,
    'website_product' | 'amazon_listing' | 'social_cover'
  >,
): Promise<{ system: string; user: string }> {
  const productUrl = isReferenceOnlyUseCaseId(useCase)
    ? null
    : useCase === 'amazon_listing'
      ? 'https://www.amazon.com/dp/B0FIXTURE1'
      : 'https://example.com/products/northstar'
  const state = createState(useCase, productUrl, 'product')
  return captureDesignerPromptForState(state, useCase)
}

async function captureDesignerPromptForState(
  state: HarnessState,
  label: string,
): Promise<{ system: string; user: string }> {
  const response = await withHarnessGlobals(
    state,
    designerResponse(),
    () => runDesignerStage({
      client: createHarnessClient(state) as never,
      userId: USER_ID,
      campaignId: CAMPAIGN_ID,
      generationId: GENERATION_ID,
      finalizeFailure: false,
      serverOwned: true,
    }),
  )
  const payload = await response.json() as {
    prompt?: { system?: unknown; user?: unknown }
  }
  return requireChatPrompt(payload.prompt, `designer:${label}`)
}

async function captureRedNoteDesignerArtifact(): Promise<
  PipelinePromptGoldens['designer']['rednote_post']
> {
  const state = createState('rednote_post', null, 'product')
  const response = await withHarnessGlobals(
    state,
    CLEAN_PAINTER_VERDICT,
    () => runDesignerStage({
      client: createHarnessClient(state) as never,
      userId: USER_ID,
      campaignId: CAMPAIGN_ID,
      generationId: GENERATION_ID,
      finalizeFailure: false,
      serverOwned: true,
    }),
  )
  const payload = await response.json() as {
    prompt?: unknown
    poster_layout?: unknown
  }
  if (!payload.poster_layout || typeof payload.poster_layout !== 'object') {
    throw new Error(`Missing deterministic RedNote layout: ${JSON.stringify(payload)}`)
  }
  return {
    prompt: null,
    layout: structuredClone(
      payload.poster_layout as Record<string, unknown>,
    ),
  }
}

export async function captureEmojiStrippedHeroPrompt(): Promise<string> {
  const state = createState(
    'website_product',
    'https://example.com/products/northstar',
    'product',
  )
  state.campaign.product_name = 'Taskpilot ☕'
  state.campaign.tagline = 'Plan together 💬'
  state.generation.instruction =
    'Keep the hierarchy focused 🟠 and show the workflow 🔍.'
  state.generation.brand_essence =
    'A focused task system with a precise gear motif ⚙️.'
  const layout = structuredClone(PRODUCT_LAYOUT)
  layout.motifs = ['speech 💬', 'amber 🟠', 'gear ⚙️', 'search 🔍']
  layout.zones = [
    {
      band: 'top',
      role: 'plain-text brand row',
      content: 'Taskpilot ☕',
      emphasis: 'low',
      align: 'left',
    },
    {
      band: 'upper',
      role: 'hero headline',
      content: 'Plan tasks 💬 together',
      emphasis: 'high',
      align: 'left',
    },
    {
      band: 'mid',
      role: 'product detail',
      content: 'See progress 🟠 ⚙️ 🔍',
      emphasis: 'med',
      align: 'left',
    },
  ]
  state.generation.poster_layout = layout

  return captureHeroPromptForState(state, 'emoji-stripping')
}

export async function captureHeroArtifactValidationDiagnostics(
  options: {
    chatResponses?: readonly (Record<string, unknown> | string)[]
    failChatAt?: number
    imageSources?: readonly string[]
    painterValidationEnabled?: string
    serverOwned?: boolean
    finalizeFailure?: boolean
    failStorageUploadKeys?: readonly string[]
    failStorageRemoveKeys?: readonly string[]
  } = {},
): Promise<HeroArtifactValidationDiagnostics> {
  const state = createState(
    'website_product',
    'https://example.com/products/northstar',
    'product',
  )
  state.imageResponses = [...(options.imageSources ?? [
    'data:image/png;base64,AQ==',
    'data:image/png;base64,Ag==',
  ])]
  state.painterValidationEnabled = options.painterValidationEnabled
  state.failStorageUploadKeys = new Set(options.failStorageUploadKeys)
  state.failStorageRemoveKeys = new Set(options.failStorageRemoveKeys)
  const chatFixtures: ChatFixture[] = [
    ...(options.chatResponses ?? [CLEAN_PAINTER_VERDICT]),
  ].map((fixture, index) =>
    index === options.failChatAt ? CHAT_FAILURE : fixture
  )
  const response = await withHarnessGlobals(
    state,
    chatFixtures,
    () => runHeroStage({
      client: createHarnessClient(state) as never,
      userId: USER_ID,
      campaignId: CAMPAIGN_ID,
      generationId: GENERATION_ID,
      finalizeFailure: options.finalizeFailure ?? false,
      serverOwned: options.serverOwned ?? true,
    }),
  )
  const payload = await response.json() as {
    prompt?: { image?: unknown }
  }
  const selectedPosterKey = typeof state.generation.hero_image_key === 'string'
    ? state.generation.hero_image_key
    : null
  const traceMetadata = state.traces.hero.failure_metadata?.painter_validation

  return {
    responseStatus: response.status,
    responsePrompt: typeof payload.prompt?.image === 'string'
      ? payload.prompt.image
      : null,
    generationStatus: state.generation.status,
    heroImageUrl: state.generation.hero_image_url,
    heroImageKey: state.generation.hero_image_key,
    chatRequests: state.chatRequests,
    imageRequests: state.imageRequests,
    imagePrompts: [...state.imagePrompts],
    chatBodies: structuredClone(state.openRouterRequests.filter(
      (request) =>
        !Array.isArray(request.modalities)
        || !request.modalities.includes('image'),
    )),
    storageUploads: [...state.storageUploads],
    storageRemovals: [...state.storageRemovals],
    initialPosterKey: HERO_FIXTURE_POSTER_KEY,
    retryPosterKey: HERO_FIXTURE_RETRY_POSTER_KEY,
    storedPosterKeys: [...state.storageObjects.keys()].sort(),
    finalPosterBytes: selectedPosterKey
      ? state.storageObjects.get(selectedPosterKey) ?? null
      : null,
    operationLog: [...state.operationLog],
    warningLogs: [...state.warningLogs],
    rpcCalls: [...state.rpcCalls],
    modelCalls: structuredClone(state.traces.hero.model_calls),
    traceMetadata: traceMetadata && typeof traceMetadata === 'object'
      ? structuredClone(traceMetadata as Record<string, unknown>)
      : {},
  }
}

async function captureHeroPrompt(
  useCase: UseCaseId,
  scenario: 'product' | 'event',
): Promise<string> {
  const productUrl = useCase === 'amazon_listing'
    ? 'https://www.amazon.com/dp/B0FIXTURE1'
    : isReferenceOnlyUseCaseId(useCase)
      ? null
    : scenario === 'event'
      ? 'https://lu.ma/fixture-summit'
      : 'https://example.com/products/northstar'
  const state = createState(useCase, productUrl, scenario)
  return captureHeroPromptForState(state, useCase)
}

async function captureHeroPromptForState(
  state: HarnessState,
  label: string,
): Promise<string> {
  const response = await withHarnessGlobals(
    state,
    CLEAN_PAINTER_VERDICT,
    () => runHeroStage({
      client: createHarnessClient(state) as never,
      userId: USER_ID,
      campaignId: CAMPAIGN_ID,
      generationId: GENERATION_ID,
      finalizeFailure: false,
      serverOwned: true,
    }),
  )
  const payload = await response.json() as {
    prompt?: { image?: unknown }
  }
  if (typeof payload.prompt?.image !== 'string') {
    throw new Error(`Missing hero prompt for ${label}: ${JSON.stringify(payload)}`)
  }
  return payload.prompt.image
}

function createState(
  useCase: UseCaseId,
  productUrl: string | null,
  scenario: 'product' | 'event',
): HarnessState {
  const referenceOnly = isReferenceOnlyUseCaseId(useCase)
  const campaign = {
    id: CAMPAIGN_ID,
    user_id: USER_ID,
    product_url: productUrl,
    product_name: scenario === 'event'
      ? 'Fixture Summit'
      : referenceOnly
        ? 'Summer Signals'
        : 'Northstar',
    tagline: scenario === 'event'
      ? 'Builders meet here'
      : referenceOnly
        ? 'A new season in motion'
        : 'Operational clarity',
    cta_text: scenario === 'event'
      ? 'Reserve a seat'
      : referenceOnly
        ? 'Learn more'
        : 'Start now',
    destination_url: referenceOnly ? null : productUrl,
    scenario,
    use_case: useCase,
    platform_hint: referenceOnly ? 'Instagram' : null,
    eager_capture_url: null,
    eager_capture_color_scheme: null,
    eager_captured_at: null,
  }
  const generation: Record<string, unknown> = {
    id: GENERATION_ID,
    campaign_id: CAMPAIGN_ID,
    user_id: USER_ID,
    status: 'created',
    parent_generation_id: null,
    generation_mode: 'website_refresh',
    instruction: referenceOnly
      ? 'Keep the mood kinetic and make the diagonal light band the visual hook.'
      : 'Keep the hierarchy focused and use the supplied proof points.',
    reference_images: referenceOnly
      ? [{
          key: 'references/social-reference.png',
          url: SOCIAL_REFERENCE_URL,
          name: 'social-reference.png',
          mime_type: 'image/png',
          size_bytes: 8,
        }]
      : [],
    poster_format: referenceOnly ? 'rednote_cover_3x4' : 'a4_2x3',
    scenario,
    use_case: useCase,
    platform_hint: referenceOnly ? 'Instagram' : null,
    screenshot_url: null,
    screenshot_key: null,
    style_profile: {
      palette: {
        bg: '#f7f4ed',
        text: '#152238',
        primary: '#235789',
        accent: '#f45b69',
        supporting: ['#70c1b3'],
        proportions: [
          { color: '#f7f4ed', proportion: 0.68 },
          { color: '#235789', proportion: 0.2 },
        ],
      },
      fonts: { heading: 'Space Grotesk', body: 'Inter' },
      tone: referenceOnly ? 'kinetic, luminous' : 'precise, confident',
      layout_hint: referenceOnly
        ? 'full-bleed diagonal editorial sweep'
        : 'asymmetric editorial stack',
      imagery: referenceOnly
        ? 'silhouetted figure crossing a luminous field'
        : 'one isolated product close-up',
      typography_treatment: referenceOnly
        ? 'condensed display type with quiet supporting text'
        : 'high-contrast grotesk hierarchy',
      lighting: referenceOnly
        ? 'hard side light with a saturated glow'
        : 'soft directional studio light',
      texture: referenceOnly
        ? 'fine photographic grain'
        : 'subtle uncoated paper grain',
      motifs: referenceOnly
        ? ['cropped circles', 'diagonal light bands']
        : ['thin registration lines'],
      composition: referenceOnly
        ? 'full-bleed diagonal editorial sweep'
        : 'asymmetric editorial stack',
      density: 'balanced',
    },
    poster_copy: {
      hook: scenario === 'event'
        ? 'Meet the builders'
        : referenceOnly
          ? 'Follow the light'
          : 'See the signal',
      what_it_does: scenario === 'event'
        ? 'A focused evening for builders.'
        : referenceOnly
          ? 'A new season in motion.'
          : 'Decisions without delay.',
      features: ['Fast setup', 'Shared context'],
      cta: scenario === 'event'
        ? 'Reserve a seat'
        : referenceOnly
          ? ''
          : 'Start now',
    },
    poster_content: {
      headline: scenario === 'event'
        ? 'Meet the builders'
        : referenceOnly
          ? 'Follow the light'
          : 'See the signal',
      what_it_does: scenario === 'event'
        ? 'A focused evening for builders.'
        : referenceOnly
          ? 'A new season in motion.'
          : 'Decisions without delay.',
      features: ['Fast setup', 'Shared context'],
    },
    brand_essence: scenario === 'event'
      ? 'An energetic builder gathering in deep blue and coral.'
      : referenceOnly
        ? 'Kinetic editorial artwork with a coral light band, deep black field, and photographic grain.'
        : 'A precise analytics brand with deep blue geometry and coral accents.',
    poster_spec: scenario === 'event'
      ? {
          title: 'Fixture Summit',
          hook: 'Build what matters',
          host_line: 'Hosted by Northstar Guild',
          date_line: 'Sun, Jul 19',
          time_line: '6:30 PM UTC',
          location_line: 'Signal Hall - Seattle',
        }
      : referenceOnly
        ? { qr_label: '', urls: '' }
        : { qr_label: 'Start now', urls: productUrl },
    poster_layout: scenario === 'event'
      ? null
      : referenceOnly
        ? SOCIAL_LAYOUT
        : PRODUCT_LAYOUT,
    brand_assets: { images: [] },
    design_tokens: null,
    design_status: scenario === 'event' ? null : 'ready',
    hero_image_url: null,
    hero_image_key: null,
    trace_schema_version: 1,
    asset_selection_status: 'completed',
  }
  if (useCase === 'rednote_post') {
    generation.poster_content = {
      headline: 'Make the light the hook',
      what_it_does: 'Keep the mood kinetic',
      how_it_works: [],
      why_use_it: [],
      features: ['Lead with motion', 'Hold the focus'],
      cta: '',
      rednote_post: structuredClone(REDNOTE_MODEL_PLAN),
    }
    generation.poster_layout = deriveRedNoteBackgroundLayout({
      posterContent: generation.poster_content,
      styleProfile: generation.style_profile,
      posterFormat: generation.poster_format,
    })
  }
  const trace = (): HarnessTrace => ({
    status: 'pending',
    started_at: null,
    model_calls: [],
    artifacts: [],
  })
  return {
    campaign,
    generation,
    parent: null,
    traces: {
      analyze: trace(),
      assets: trace(),
      designer: trace(),
      hero: trace(),
    },
    captureServiceResponse: null,
    captureRequests: [],
    captureLogs: [],
    warningLogs: [],
    storageUploads: [],
    storageUploadBodies: [],
    storageRemovals: [],
    storageObjects: new Map(),
    failStorageUploadKeys: new Set(),
    failStorageRemoveKeys: new Set(),
    operationLog: [],
    sourceHtmlOverride: null,
    imageUrls: new Set(),
    htmlRequests: [],
    sourceImageRequests: [],
    openRouterRequests: [],
    imagePrompts: [],
    imageResponses: [],
    painterValidationEnabled: undefined,
    rpcCalls: [],
    chatRequests: 0,
    imageRequests: 0,
  }
}

function createSocialCoverQrState(): HarnessState {
  const state = createState('social_cover', null, 'product')
  state.campaign.destination_url = 'https://example.com/social'
  state.campaign.poster_format = 'rednote_3x4'
  state.generation.poster_format = 'rednote_3x4'
  return state
}

function createHarnessClient(state: HarnessState) {
  return {
    database: {
      from(table: string) {
        return new HarnessQuery(state, table)
      },
      async rpc(name: string, args: Record<string, unknown> = {}) {
        state.rpcCalls.push(name)
        state.operationLog.push(`rpc:${name}`)
        if (
          name === 'complete_poster_generation_for_worker'
          || name === 'complete_poster_generation'
        ) {
          Object.assign(state.generation, {
            status: 'ready',
            hero_image_url: args.p_hero_image_url,
            hero_image_key: args.p_hero_image_key,
          })
          Object.assign(state.campaign, {
            poster_content: structuredClone(state.generation.poster_content),
            poster_layout: structuredClone(state.generation.poster_layout),
            hero_image_url: state.generation.hero_image_url,
            hero_image_key: state.generation.hero_image_key,
          })
          return { data: structuredClone(state.generation), error: null }
        }
        if (name === 'complete_generation_asset_selection_for_worker') {
          state.generation.asset_selection_status = 'completed'
        }
        return { data: null, error: null }
      },
    },
    storage: {
      from() {
        return {
          async remove(key: string) {
            state.storageRemovals.push(key)
            state.operationLog.push(`storage.remove:${key}`)
            if (state.failStorageRemoveKeys.has(key)) {
              return {
                data: null,
                error: { message: `Fixture storage remove failure for ${key}` },
              }
            }
            state.storageObjects.delete(key)
            return { data: null, error: null }
          },
          async upload(key: string, file: Blob) {
            state.operationLog.push(`storage.upload:${key}`)
            const bytes = Array.from(new Uint8Array(await file.arrayBuffer()))
            state.storageUploads.push(key)
            state.storageUploadBodies.push({ key, bytes })
            if (state.failStorageUploadKeys.has(key)) {
              return {
                data: null,
                error: { message: `Fixture storage upload failure for ${key}` },
              }
            }
            state.storageObjects.set(key, bytes)
            const url = `https://assets.example/${key}`
            state.imageUrls.add(url)
            return {
              data: {
                url,
                key,
              },
              error: null,
            }
          },
        }
      },
    },
  }
}

class HarnessQuery {
  private operation: 'select' | 'update' = 'select'
  private patch: Record<string, unknown> | null = null
  private filters: Array<[string, unknown]> = []
  private readonly state: HarnessState
  private readonly table: string

  constructor(
    state: HarnessState,
    table: string,
  ) {
    this.state = state
    this.table = table
  }

  select(): this {
    this.operation = 'select'
    return this
  }

  update(patch: Record<string, unknown>): this {
    this.operation = 'update'
    this.patch = patch
    return this
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value])
    return this
  }

  order(): this {
    return this
  }

  async maybeSingle(): Promise<{ data: unknown; error: null }> {
    return { data: this.selectedRow(), error: null }
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<{ data: unknown; error: null } | TResult> {
    return this.execute().catch(onrejected)
  }

  private async execute(): Promise<{ data: unknown; error: null }> {
    if (this.operation === 'update' && this.patch) {
      const row = this.selectedRow()
      if (row && typeof row === 'object') Object.assign(row, structuredClone(this.patch))
    }
    return { data: this.selectedRow(), error: null }
  }

  private selectedRow(): Record<string, unknown> | HarnessTrace | null {
    if (this.table === 'campaigns') {
      return matches(this.state.campaign, this.filters) ? this.state.campaign : null
    }
    if (this.table === 'poster_generations') {
      const rows = [this.state.generation, this.state.parent].filter(
        (row): row is Record<string, unknown> => !!row,
      )
      return rows.find((row) => matches(row, this.filters)) ?? null
    }
    if (this.table === 'generation_stage_traces') {
      const stage = this.filters.find(([column]) => column === 'stage')?.[1]
      if (
        stage === 'analyze'
        || stage === 'assets'
        || stage === 'designer'
        || stage === 'hero'
      ) {
        return this.state.traces[stage]
      }
      return null
    }
    return null
  }
}

async function withHarnessGlobals<T>(
  state: HarnessState,
  chatResponse: ChatFixture | readonly ChatFixture[],
  run: () => Promise<T>,
): Promise<T> {
  const chatQueue = Array.isArray(chatResponse)
    ? [...chatResponse] as ChatFixture[]
    : null
  const originalFetch = globalThis.fetch
  const originalWarn = console.warn
  const originalInfo = console.info
  const originalDeno = (globalThis as Record<string, unknown>).Deno
  ;(globalThis as Record<string, unknown>).Deno = {
    env: {
      get(key: string) {
        if (key === 'OPENROUTER_API_KEY') return 'fixture-openrouter-key'
        if (key === 'PAINTER_VALIDATION_ENABLED') {
          return state.painterValidationEnabled
        }
        if (state.captureServiceResponse && key === 'CAPTURE_SERVICE_URL') {
          return CAPTURE_SERVICE_URL
        }
        if (state.captureServiceResponse && key === 'CAPTURE_TOKEN') {
          return 'fixture-capture-token'
        }
        return undefined
      },
    },
  }
  console.warn = (...values: unknown[]) => {
    state.warningLogs.push(values.map(String).join(' '))
  }
  console.info = (...values: unknown[]) => {
    state.captureLogs.push(values.map(String).join(' '))
  }
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url === `${CAPTURE_SERVICE_URL}/capture`) {
      state.captureRequests.push(
        JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      )
      const fixture = state.captureServiceResponse
      if (!fixture) throw new Error('Capture service was not configured.')
      return Response.json(fixture.body, { status: fixture.status })
    }
    if (url === OPENROUTER_URL) {
      const request = JSON.parse(String(init?.body ?? '{}')) as {
        modalities?: unknown
        messages?: Array<{ content?: unknown }>
      }
      state.openRouterRequests.push(structuredClone(request))
      if (Array.isArray(request.modalities) && request.modalities.includes('image')) {
        state.imageRequests += 1
        const content = request.messages?.[0]?.content
        const prompt = typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? String(
                (content.find(
                  (part) =>
                    !!part
                    && typeof part === 'object'
                    && (part as { type?: unknown }).type === 'text',
                ) as { text?: unknown } | undefined)?.text ?? '',
              )
            : ''
        state.imagePrompts.push(prompt)
        const imageSource = state.imageResponses.shift()
          ?? 'data:image/png;base64,iVBORw0KGgo='
        return Response.json({
          choices: [{
            message: {
              images: [{
                image_url: {
                  url: imageSource,
                },
              }],
            },
          }],
        })
      }
      state.chatRequests += 1
      const fixture = chatQueue
        ? chatQueue.shift()
        : chatResponse as ChatFixture
      if (fixture === undefined) {
        throw new Error('Fixture chat response queue was exhausted')
      }
      if (fixture === CHAT_FAILURE) {
        throw new Error('Fixture chat failure')
      }
      return Response.json({
        choices: [{
          message: {
            content: typeof fixture === 'string'
              ? fixture
              : JSON.stringify(fixture ?? {}),
          },
        }],
      })
    }
    if (url === SOCIAL_REFERENCE_URL) {
      return new Response(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        },
      )
    }
    if (url === 'https://source.example/fresh-logo.png') {
      state.sourceImageRequests.push(url)
      return new Response(null, { status: 404 })
    }
    if (state.imageUrls.has(url)) {
      if (url.startsWith('https://source.example/')) {
        state.sourceImageRequests.push(url)
      }
      return new Response(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        },
      )
    }
    if (url === state.campaign.product_url) {
      state.htmlRequests.push(url)
      return new Response(
        state.sourceHtmlOverride
          ?? sourceHtml(String(state.campaign.scenario)),
        {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
        },
      )
    }
    // Reached if any source URL other than source_urls[0] is fetched: extra
    // declared URLs must never be acquired.
    throw new Error(`Unexpected fixture fetch: ${url}`)
  }

  try {
    return await run()
  } finally {
    globalThis.fetch = originalFetch
    console.warn = originalWarn
    console.info = originalInfo
    if (originalDeno === undefined) {
      delete (globalThis as Record<string, unknown>).Deno
    } else {
      ;(globalThis as Record<string, unknown>).Deno = originalDeno
    }
  }
}

function hasRedNotePostPlan(state: HarnessState): boolean {
  return redNotePostPlanOf(state) !== undefined
}

function redNotePostPlanOf(state: HarnessState): unknown {
  const posterContent = state.generation.poster_content
  if (!posterContent || typeof posterContent !== 'object') return undefined
  const plan = (posterContent as Record<string, unknown>).rednote_post
  return plan === undefined ? undefined : structuredClone(plan)
}

function analysisArtifactMetadata(
  state: HarnessState,
): Record<string, unknown> {
  const artifact = (state.traces.analyze.artifacts as Array<{
    kind?: unknown
    metadata?: Record<string, unknown>
  }>).find((candidate) => candidate.kind === 'analysis')
  return artifact?.metadata ?? {}
}

function layoutArtifactRenderMode(state: HarnessState): unknown {
  const artifact = (state.traces.designer.artifacts as Array<{
    kind?: unknown
    snapshot?: Record<string, unknown>
  }>).find((candidate) => candidate.kind === 'layout')
  return artifact?.snapshot?.render_mode
}

function sourceHtml(scenario: string): string {
  if (scenario === 'event') {
    return `<!doctype html>
<html>
  <head>
    <meta name="theme-color" content="#10243a">
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Event",
        "name": "Fixture Summit",
        "startDate": "2026-07-19T18:30:00+00:00",
        "endDate": "2026-07-19T21:00:00+00:00",
        "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
        "location": {
          "@type": "Place",
          "name": "Signal Hall",
          "address": {
            "@type": "PostalAddress",
            "addressLocality": "Seattle",
            "addressRegion": "WA",
            "addressCountry": "US"
          }
        },
        "organizer": {
          "@type": "Organization",
          "name": "Northstar Guild"
        }
      }
    </script>
  </head>
  <body style="background:#f7f4ed;color:#152238">
    Fixture Summit brings focused builders together for one practical evening.
  </body>
</html>`
  }
  return `<!doctype html>
<html>
  <head>
    <meta name="theme-color" content="#235789">
    <style>body{background:#f7f4ed;color:#152238}.accent{color:#f45b69}</style>
  </head>
  <body>Northstar turns operational data into decisions without delay.</body>
</html>`
}

function productAnalyzeResponse(useCase?: UseCaseId): Record<string, unknown> {
  return {
    style_profile: {
      palette: {
        primary: '#235789',
        bg: '#f7f4ed',
        text: '#152238',
        accent: '#f45b69',
      },
      fonts: { heading: 'Space Grotesk', body: 'Inter' },
      tone: 'precise, confident',
      layout_hint: 'asymmetric editorial stack',
    },
    poster_content: useCase === 'rednote_post'
      ? { rednote_post: structuredClone(REDNOTE_MODEL_PLAN) }
      : {
          headline: 'See the signal',
          what_it_does: 'Decisions without delay.',
          how_it_works: ['Connect data', 'Spot changes', 'Act together'],
          why_use_it: ['Faster focus', 'Shared context', 'Clear ownership'],
          features: ['Fast setup', 'Shared context'],
          cta: 'Start now',
        },
    brand_essence: 'A precise analytics brand with deep blue geometry and coral accents.',
    qr_label: 'Start now',
  }
}

function captureDesignTokens() {
  return {
    typography: {
      headingFamily: 'Space Grotesk',
      bodyFamily: 'Inter',
      scale: [16, 24, 48],
      weights: [400, 700],
    },
    colors: {
      bg: '#f7f4ed',
      text: '#152238',
      primary: '#235789',
      accent: '#f45b69',
      palette: ['#235789', '#f45b69'],
      visualPalette: [
        { color: '#f7f4ed', proportion: 0.68 },
        { color: '#235789', proportion: 0.2 },
      ],
      theme: 'light',
    },
    radii: [4, 8],
    shadows: [],
    spacing: [8, 16, 24],
    button: null,
    fontLinks: [],
  }
}

function eventAnalyzeResponse(): Record<string, unknown> {
  return {
    style_profile: {
      palette: {
        primary: '#10243a',
        bg: '#f7f4ed',
        text: '#152238',
        accent: '#f15b40',
      },
      fonts: { heading: 'Space Grotesk', body: 'Inter' },
      tone: 'energetic, focused',
      layout_hint: 'bold editorial gathering',
    },
    brand_essence: 'An energetic builder gathering in deep blue and coral.',
    poster_content: {
      headline: 'Meet the builders',
      what_it_does: 'A focused evening for builders.',
      how_it_works: ['Arrive', 'Share', 'Build'],
      why_use_it: ['Meet peers', 'Trade notes', 'Leave ready'],
      features: ['Practical talks', 'Small groups'],
      cta: 'Reserve a seat',
    },
    poster_spec: {
      hook: 'Build what matters',
      blurb: 'For builders shipping the next thing.',
      rsvp_label: 'Reserve a seat',
    },
  }
}

function designerResponse(): Record<string, unknown> {
  return PRODUCT_LAYOUT
}

function requireChatPrompt(
  prompt: { system?: unknown; user?: unknown } | undefined,
  label: string,
): { system: string; user: string } {
  if (typeof prompt?.system !== 'string' || typeof prompt.user !== 'string') {
    throw new Error(`Missing chat prompt for ${label}: ${JSON.stringify(prompt)}`)
  }
  return { system: prompt.system, user: prompt.user }
}

function matches(
  row: Record<string, unknown>,
  filters: readonly [string, unknown][],
): boolean {
  return filters.every(([column, value]) => row[column] === value)
}
