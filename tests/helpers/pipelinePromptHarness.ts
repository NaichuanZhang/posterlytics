import { runAnalyzeStage } from '../../functions/analyze.ts'
import { runDesignerStage } from '../../functions/designer.ts'
import { runHeroStage } from '../../functions/hero.ts'
import type { UseCaseId } from '../../src/lib/useCases.ts'

type PipelineStage = 'analyze' | 'designer' | 'hero'

interface HarnessTrace {
  status: string
  started_at: string | null
  model_calls: unknown[]
  artifacts: unknown[]
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
  storageUploads: string[]
  storageRemovals: string[]
  sourceHtmlOverride: string | null
  imageUrls: Set<string>
  sourceImageRequests: string[]
}

export interface PipelinePromptGoldens {
  analyze: {
    website_product: { system: string; user: string }
    amazon_listing: { system: string; user: string }
    social_cover: { system: string; user: string }
    event: { system: string; user: string }
  }
  designer: {
    website_product: { system: string; user: string }
    amazon_listing: { system: string; user: string }
    social_cover: { system: string; user: string }
  }
  hero: {
    website_product: string
    amazon_listing: string
    social_cover: string
    event: string
  }
}

const USER_ID = 'user-fixture'
const CAMPAIGN_ID = 'campaign-fixture'
const GENERATION_ID = 'generation-fixture'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const CAPTURE_SERVICE_URL = 'https://capture.fixture'
const SOCIAL_REFERENCE_URL = 'https://assets.example/social-reference.png'

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
    },
    hero: {
      website_product: await captureHeroPrompt('website_product', 'product'),
      amazon_listing: await captureHeroPrompt('amazon_listing', 'product'),
      social_cover: await captureHeroPrompt('social_cover', 'product'),
      event: await captureHeroPrompt('event', 'event'),
    },
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
    'website_product' | 'amazon_listing' | 'social_cover'
  >,
  productUrl: string | null,
): Promise<unknown> {
  const state = createState(useCase, productUrl, 'product')
  await withHarnessGlobals(
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
  return artifact?.metadata?.source_mode
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
    scenario === 'event' ? eventAnalyzeResponse() : productAnalyzeResponse(),
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
  const productUrl = useCase === 'social_cover'
    ? null
    : useCase === 'amazon_listing'
      ? 'https://www.amazon.com/dp/B0FIXTURE1'
      : 'https://example.com/products/northstar'
  const state = createState(useCase, productUrl, 'product')
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
  return requireChatPrompt(payload.prompt, `designer:${useCase}`)
}

async function captureHeroPrompt(
  useCase: UseCaseId,
  scenario: 'product' | 'event',
): Promise<string> {
  const productUrl = useCase === 'amazon_listing'
    ? 'https://www.amazon.com/dp/B0FIXTURE1'
    : useCase === 'social_cover'
      ? null
    : scenario === 'event'
      ? 'https://lu.ma/fixture-summit'
      : 'https://example.com/products/northstar'
  const state = createState(useCase, productUrl, scenario)
  const response = await withHarnessGlobals(
    state,
    null,
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
    throw new Error(`Missing hero prompt for ${useCase}: ${JSON.stringify(payload)}`)
  }
  return payload.prompt.image
}

function createState(
  useCase: UseCaseId,
  productUrl: string | null,
  scenario: 'product' | 'event',
): HarnessState {
  const socialCover = useCase === 'social_cover'
  const campaign = {
    id: CAMPAIGN_ID,
    user_id: USER_ID,
    product_url: productUrl,
    product_name: scenario === 'event'
      ? 'Fixture Summit'
      : socialCover
        ? 'Summer Signals'
        : 'Northstar',
    tagline: scenario === 'event'
      ? 'Builders meet here'
      : socialCover
        ? 'A new season in motion'
        : 'Operational clarity',
    cta_text: scenario === 'event'
      ? 'Reserve a seat'
      : socialCover
        ? 'Learn more'
        : 'Start now',
    destination_url: socialCover ? null : productUrl,
    scenario,
    use_case: useCase,
    platform_hint: socialCover ? 'Instagram' : null,
    eager_capture_url: null,
    eager_capture_color_scheme: null,
    eager_captured_at: null,
  }
  const generation = {
    id: GENERATION_ID,
    campaign_id: CAMPAIGN_ID,
    user_id: USER_ID,
    status: 'created',
    parent_generation_id: null,
    generation_mode: 'website_refresh',
    instruction: socialCover
      ? 'Keep the mood kinetic and make the diagonal light band the visual hook.'
      : 'Keep the hierarchy focused and use the supplied proof points.',
    reference_images: socialCover
      ? [{
          key: 'references/social-reference.png',
          url: SOCIAL_REFERENCE_URL,
          name: 'social-reference.png',
          mime_type: 'image/png',
          size_bytes: 8,
        }]
      : [],
    poster_format: socialCover ? 'rednote_cover_3x4' : 'a4_2x3',
    scenario,
    use_case: useCase,
    platform_hint: socialCover ? 'Instagram' : null,
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
      tone: socialCover ? 'kinetic, luminous' : 'precise, confident',
      layout_hint: socialCover
        ? 'full-bleed diagonal editorial sweep'
        : 'asymmetric editorial stack',
      imagery: socialCover
        ? 'silhouetted figure crossing a luminous field'
        : 'one isolated product close-up',
      typography_treatment: socialCover
        ? 'condensed display type with quiet supporting text'
        : 'high-contrast grotesk hierarchy',
      lighting: socialCover
        ? 'hard side light with a saturated glow'
        : 'soft directional studio light',
      texture: socialCover
        ? 'fine photographic grain'
        : 'subtle uncoated paper grain',
      motifs: socialCover
        ? ['cropped circles', 'diagonal light bands']
        : ['thin registration lines'],
      composition: socialCover
        ? 'full-bleed diagonal editorial sweep'
        : 'asymmetric editorial stack',
      density: 'balanced',
    },
    poster_copy: {
      hook: scenario === 'event'
        ? 'Meet the builders'
        : socialCover
          ? 'Follow the light'
          : 'See the signal',
      what_it_does: scenario === 'event'
        ? 'A focused evening for builders.'
        : socialCover
          ? 'A new season in motion.'
          : 'Decisions without delay.',
      features: ['Fast setup', 'Shared context'],
      cta: scenario === 'event'
        ? 'Reserve a seat'
        : socialCover
          ? ''
          : 'Start now',
    },
    poster_content: {
      headline: scenario === 'event'
        ? 'Meet the builders'
        : socialCover
          ? 'Follow the light'
          : 'See the signal',
      what_it_does: scenario === 'event'
        ? 'A focused evening for builders.'
        : socialCover
          ? 'A new season in motion.'
          : 'Decisions without delay.',
      features: ['Fast setup', 'Shared context'],
    },
    brand_essence: scenario === 'event'
      ? 'An energetic builder gathering in deep blue and coral.'
      : socialCover
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
      : socialCover
        ? { qr_label: '', urls: '' }
        : { qr_label: 'Start now', urls: productUrl },
    poster_layout: scenario === 'event'
      ? null
      : socialCover
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
      designer: trace(),
      hero: trace(),
    },
    captureServiceResponse: null,
    captureRequests: [],
    captureLogs: [],
    storageUploads: [],
    storageRemovals: [],
    sourceHtmlOverride: null,
    imageUrls: new Set(),
    sourceImageRequests: [],
  }
}

function createHarnessClient(state: HarnessState) {
  return {
    database: {
      from(table: string) {
        return new HarnessQuery(state, table)
      },
      async rpc(name: string) {
        if (name === 'complete_poster_generation_for_worker') {
          Object.assign(state.generation, {
            status: 'ready',
            hero_image_url: 'https://assets.example/poster.png',
            hero_image_key: 'poster/fixture/poster.png',
          })
          return { data: structuredClone(state.generation), error: null }
        }
        return { data: null, error: null }
      },
    },
    storage: {
      from() {
        return {
          async remove(key: string) {
            state.storageRemovals.push(key)
            return { data: null, error: null }
          },
          async upload(key: string) {
            state.storageUploads.push(key)
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
      if (stage === 'analyze' || stage === 'designer' || stage === 'hero') {
        return this.state.traces[stage]
      }
      return null
    }
    return null
  }
}

async function withHarnessGlobals<T>(
  state: HarnessState,
  chatResponse: Record<string, unknown> | null,
  run: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch
  const originalWarn = console.warn
  const originalInfo = console.info
  const originalDeno = (globalThis as Record<string, unknown>).Deno
  ;(globalThis as Record<string, unknown>).Deno = {
    env: {
      get(key: string) {
        if (key === 'OPENROUTER_API_KEY') return 'fixture-openrouter-key'
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
  console.warn = () => {}
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
      }
      if (Array.isArray(request.modalities) && request.modalities.includes('image')) {
        return Response.json({
          choices: [{
            message: {
              images: [{
                image_url: {
                  url: 'data:image/png;base64,iVBORw0KGgo=',
                },
              }],
            },
          }],
        })
      }
      return Response.json({
        choices: [{
          message: {
            content: JSON.stringify(chatResponse ?? {}),
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
      return new Response(
        state.sourceHtmlOverride
          ?? sourceHtml(String(state.campaign.scenario)),
        {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
        },
      )
    }
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

function productAnalyzeResponse(): Record<string, unknown> {
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
    poster_content: {
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
