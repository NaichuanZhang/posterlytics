import { isAmazonSourceUrl } from '../src/lib/amazonSource.ts';

export type ProductSourceMode = 'website' | 'amazon-reference';

export interface AnalyzeBriefSet {
  sourceBrief: string;
  paletteBrief: string;
  densityBrief: string;
  evidenceSource: (input: {
    hasCapturedEvidence: boolean;
    captureSucceeded: boolean;
    themeColor: string | null;
  }) => string;
  sourceText: (visibleText: string) => string;
  referenceInstruction: (count: number) => string;
}

export interface ReferencePurposeVocabulary {
  analysisStyleBoard: string;
  analysisUserReference: (index: number) => string;
  assetPreviousRefresh: string;
  assetPreviousIteration: string;
  assetUserReference: (index: number) => string;
  assetLogo: string;
  assetProduct: (index: number) => string;
  assetStyleBoard: string;
  designerPrevious: string;
  designerStyleBoard: string;
  designerUserReference: (index: number) => string;
  heroPrevious: string;
  heroUserReference: (index: number) => string;
  heroLogo: string;
  heroProduct: (index: number) => string;
  heroStyleBoard: string;
}

export interface StageVocabulary {
  parentFirstRefresh: string;
  parentRefresh: string;
  parentSnapshot: string;
  designerPosterKind: string;
  designerReferenceSubjects: string;
  designerEvidenceRule: string;
  designerSourceObservationsHeading: string;
  heroPosterKind: string;
  heroStyleBoardAttached: string;
  heroStyleBoardMissing: string;
  heroTranslationRule: string;
}

export interface ProductUseCaseRecipe {
  kind: 'product';
  id: 'website_product' | 'amazon_listing';
  acquisitionMode: ProductSourceMode;
  analyze: AnalyzeBriefSet;
  references: ReferencePurposeVocabulary;
  stages: StageVocabulary;
}

export interface EventUseCaseRecipe {
  kind: 'event-bespoke';
  id: 'event';
  acquisitionMode: 'event-bespoke';
}

export type UseCaseRecipe = ProductUseCaseRecipe | EventUseCaseRecipe;

export interface UseCaseSourceMismatch {
  code: 'use_case_source_mismatch';
  message: string;
  retryable: false;
}

const COMMON_PRODUCT_REFERENCES: Omit<
  ReferencePurposeVocabulary,
  'analysisUserReference'
> = {
  analysisStyleBoard:
    'Primary source evidence: three page viewports showing palette proportions, typography, imagery, lighting, motifs, hierarchy, and density.',
  assetPreviousRefresh:
    'Current poster version; preserve useful visual continuity while applying refreshed website evidence.',
  assetPreviousIteration:
    'Primary edit source; preserve every visual choice not explicitly changed by the user.',
  assetUserReference: (index) =>
    `User-supplied creative reference ${index}; use it only where it supports the requested change.`,
  assetLogo:
    'Authentic brand logo; reproduce it faithfully when included.',
  assetProduct: (index) =>
    `Authentic product or brand image ${index}; preserve its real subject and visual details.`,
  assetStyleBoard:
    'Website evidence for palette, typography, imagery treatment, lighting, texture, motifs, and density.',
  designerPrevious:
    'The current poster to edit. Preserve every visual choice not explicitly changed by the user request.',
  designerStyleBoard:
    'Primary source evidence: merged page viewports for observed palette proportions, typography, imagery, lighting, motifs, composition, and density.',
  designerUserReference: (index) =>
    `User-supplied creative reference ${index}; secondary to the source style board.`,
  heroPrevious:
    'Primary edit source: keep every visual choice that the user did not explicitly ask to change.',
  heroUserReference: (index) =>
    `New supporting image ${index}; use it only for the requested change while preserving the parent poster.`,
  heroLogo:
    'Authentic brand logo; reproduce faithfully only if this reference remains attached.',
  heroProduct: (index) =>
    `Authentic product or brand image ${index}; preserve its real subject and visual details.`,
  heroStyleBoard:
    'Supporting source evidence for palette, typography, imagery treatment, lighting, texture, motifs, and density.',
};

// Website and Amazon intentionally share downstream vocabulary in this cycle.
// These strings preserve current runtime behavior byte-for-byte; later copy
// changes require their own product decision and golden updates.
const CURRENT_PRODUCT_STAGE_VOCABULARY: StageVocabulary = {
  parentFirstRefresh:
    'Use the freshly captured website evidence as the visual source of truth.',
  parentRefresh:
    'WEBSITE REFRESH: Reconcile newly captured brand evidence only where it conflicts with stale brand facts; the requested delta and preservation rule still govern the edit.',
  parentSnapshot:
    'BRAND SNAPSHOT: Reuse the current version brand analysis; do not reinterpret the website or invent a new direction.',
  designerPosterKind: 'product poster',
  designerReferenceSubjects:
    'previous poster, source style board, and supporting images.',
  designerEvidenceRule:
    'Use observed evidence rather than category assumptions or a generic template.',
  designerSourceObservationsHeading: 'SOURCE VISUAL OBSERVATIONS:',
  heroPosterKind: 'product-promotion poster',
  heroStyleBoardAttached:
    'A labeled STYLE BOARD image captured from the real source page is attached. Treat it as the primary brand-style evidence while preserving the painter priority described by each reference label.',
  heroStyleBoardMissing:
    'No source style board is attached; rely on the source-derived direction and palette below.',
  heroTranslationRule:
    'Translate the observed visual language into a poster-specific composition. Do not copy navigation bars, menus, browser chrome, app screens, cards, buttons, tabs, form controls, or other website UI. Do not impose category stereotypes or substitute a trendy medium that is not evidenced by the source. Any REFERENCE PURPOSE labels attached after this prompt are instructions only and must never appear as poster text.',
};

const WEBSITE_RECIPE: ProductUseCaseRecipe = {
  kind: 'product',
  id: 'website_product',
  acquisitionMode: 'website',
  analyze: {
    sourceBrief:
      'Given a product website, a multi-frame source style board, and GTM inputs, describe only visual characteristics actually observed. ',
    paletteBrief:
      'The palette and usage proportions MUST reflect the supplied deterministic capture evidence. Preserve dominant neutrals and restrained accents instead of amplifying every vivid pixel. ',
    densityBrief:
      'Classify density from the observed page hierarchy, not from how much marketing copy is available.',
    evidenceSource: ({ hasCapturedEvidence, captureSucceeded, themeColor }) =>
      hasCapturedEvidence
        ? 'browser-visible DOM plus weighted style-board pixels'
        : captureSucceeded
          ? 'browser capture succeeded but yielded no usable visual palette'
          : `raw HTML color fallback${themeColor ? ` (theme-color ${themeColor})` : ''}`,
    sourceText: (visibleText) =>
      `WEBSITE TEXT (truncated):\n${visibleText || '(scrape failed — rely on the inputs above)'}`,
    referenceInstruction: (count) =>
      `The user supplied ${count} supporting image(s). Treat them as secondary visual references, not text to reproduce verbatim.`,
  },
  references: {
    ...COMMON_PRODUCT_REFERENCES,
    analysisUserReference: (index) =>
      `User-supplied creative reference ${index}; use only where it agrees with or intentionally supplements the source page.`,
  },
  stages: CURRENT_PRODUCT_STAGE_VOCABULARY,
};

const AMAZON_RECIPE: ProductUseCaseRecipe = {
  kind: 'product',
  id: 'amazon_listing',
  acquisitionMode: 'amazon-reference',
  analyze: {
    sourceBrief:
      'Given seller-provided Amazon listing copy, product or brand images, and GTM inputs, describe only visual characteristics actually present in those references. The Amazon listing URL was intentionally not fetched. ',
    paletteBrief:
      'The palette MUST reflect the seller-provided visual references. Preserve dominant neutrals and restrained accents instead of amplifying every vivid pixel. ',
    densityBrief:
      'Classify density only from the seller-provided references, not from how much marketing copy is available.',
    evidenceSource: () =>
      'seller-provided copy and images; Amazon fetch and browser capture intentionally skipped',
    sourceText: () =>
      'AUTOMATED AMAZON LISTING TEXT: (not fetched; use the seller-provided creative context below)',
    referenceInstruction: (count) =>
      `The seller supplied ${count} product or brand image(s). Treat them as primary product and visual evidence.`,
  },
  references: {
    ...COMMON_PRODUCT_REFERENCES,
    analysisUserReference: (index) =>
      `Seller-supplied product or brand reference ${index}; treat as primary visual evidence for this Amazon product.`,
  },
  stages: CURRENT_PRODUCT_STAGE_VOCABULARY,
};

const EVENT_RECIPE: EventUseCaseRecipe = {
  kind: 'event-bespoke',
  id: 'event',
  acquisitionMode: 'event-bespoke',
};

export function resolveUseCaseRecipe(useCase: unknown): UseCaseRecipe {
  if (useCase === 'amazon_listing') return AMAZON_RECIPE;
  if (useCase === 'event') return EVENT_RECIPE;
  return WEBSITE_RECIPE;
}

export function resolveProductUseCaseRecipe(
  useCase: unknown,
): ProductUseCaseRecipe {
  const recipe = resolveUseCaseRecipe(useCase);
  return recipe.kind === 'product' ? recipe : WEBSITE_RECIPE;
}

export function useCaseSourceMismatch(
  useCase: unknown,
  productUrl: unknown,
): UseCaseSourceMismatch | null {
  // Backfilled rows are non-null. Treat incomplete legacy snapshots as unknown
  // instead of introducing a new terminal failure for data this cycle did not create.
  if (typeof productUrl !== 'string' || !productUrl.trim()) return null;
  const amazonUrl = isAmazonSourceUrl(productUrl);
  if (useCase === 'amazon_listing' && !amazonUrl) {
    return {
      code: 'use_case_source_mismatch',
      message:
        'This generation is configured for an Amazon listing, but its source is not a supported Amazon URL.',
      retryable: false,
    };
  }
  if (useCase === 'website_product' && amazonUrl) {
    return {
      code: 'use_case_source_mismatch',
      message:
        'This generation is configured for a website product, but its source is an Amazon URL.',
      retryable: false,
    };
  }
  return null;
}
