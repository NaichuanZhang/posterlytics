import { isAmazonSourceUrl } from '../src/lib/amazonSource.ts';

export type ProductSourceMode =
  | 'website'
  | 'amazon-reference'
  | 'reference-only';

export interface AnalyzeBriefSet {
  promptKind: 'product-source' | 'social-reference';
  outputMode?: 'rednote-post-v1';
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
  platformInstruction: (platformHint: string | null) => string;
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
  designerZoneRoleExample: string;
  designerRules: string;
  designerPaletteRule: string;
  designerSubjectLabel: string;
  designerTaglineLabel: string;
  designerEssenceLabel: string;
  designerColorsLabel: string;
  designerObservationFallback: string;
  designerLogoMissing: string;
  designerImageLabel: string;
  designerFallbackTopRole: string;
  designerFallbackMidRole: string;
  heroPosterKind: string;
  heroStyleBoardAttached: string;
  heroStyleBoardMissing: string;
  heroTranslationRule: string;
  heroReferenceSummary: (count: number) => string;
  heroNoLogoSubject: string;
  heroSparseDensityRule: string;
  heroBalancedDensityRule: string;
  heroDenseDensityRule: string;
  heroPaletteBoundary: (supporting: string) => string;
  heroColorProportions: (proportions: string) => string;
  heroIdentityRule: string;
  heroAvoidControls: string;
  heroFallbackArtStyle: string;
  heroFallbackTopRole: string;
  heroFallbackMidRole: string;
  heroFallbackDetailRole: string;
}

export interface ProductUseCaseRecipe {
  kind: 'product';
  id: 'website_product' | 'amazon_listing' | 'social_cover' | 'rednote_post';
  acquisitionMode: ProductSourceMode;
  artworkMode?: 'rednote-background-v1';
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
  designerZoneRoleExample: 'brand row / hero headline / product detail',
  designerRules:
    'RULES: design 3-7 zones ordered top→lower according to the SOURCE density and hierarchy: sparse sources get 3-4, balanced sources 4-5, and dense sources 5-7. Do not force a feature grid, stats row, icon set, or proof strip. Use those only when the observed source hierarchy and supplied copy support them. Preserve intentional negative space for sparse sources. Use the band labels to place the chosen zones across the full artwork. ',
  designerPaletteRule:
    'Keep every content string SHORT and legible. The palette_roles MUST use the real brand colors provided. Preserve color usage proportions: dominant neutrals remain dominant and small accents remain restrained. ',
  designerSubjectLabel: 'PRODUCT',
  designerTaglineLabel: 'TAGLINE',
  designerEssenceLabel: 'BRAND ESSENCE (word-portrait for the art director)',
  designerColorsLabel: 'BRAND COLORS (use these for palette_roles)',
  designerObservationFallback: '(read from the style board)',
  designerLogoMissing:
    'LOGO: (not selected — use the product name as the brand mark)',
  designerImageLabel: 'PRODUCT IMAGE',
  designerFallbackTopRole: 'plain-text brand row',
  designerFallbackMidRole: 'source-derived imagery focal area',
  heroPosterKind: 'product-promotion poster',
  heroStyleBoardAttached:
    'A labeled STYLE BOARD image captured from the real source page is attached. Treat it as the primary brand-style evidence while preserving the painter priority described by each reference label.',
  heroStyleBoardMissing:
    'No source style board is attached; rely on the source-derived direction and palette below.',
  heroTranslationRule:
    'Translate the observed visual language into a poster-specific composition. Do not copy navigation bars, menus, browser chrome, app screens, cards, buttons, tabs, form controls, or other website UI. Do not impose category stereotypes or substitute a trendy medium that is not evidenced by the source. Any REFERENCE PURPOSE labels attached after this prompt are instructions only and must never appear as poster text.',
  heroReferenceSummary: (count) =>
    `${count} new supporting image(s) accompany this prompt. Use them only for the requested delta.`,
  heroNoLogoSubject: 'product name',
  heroSparseDensityRule:
    'Preserve the source page\'s SPARSE rhythm: use only the supplied zones, keep generous intentional negative space, and resist adding filler details.',
  heroBalancedDensityRule:
    'Preserve a BALANCED rhythm: maintain clear hierarchy and measured supporting detail without crowding or artificial emptiness.',
  heroDenseDensityRule:
    'Preserve the source page\'s DENSE rhythm: layer the supplied zones and supporting visual detail while keeping every element legible.',
  heroPaletteBoundary: (supporting) =>
    `${supporting ? ` Supporting source colors: ${supporting}.` : ''} Stay within this palette plus source neutrals — no rogue colors.`,
  heroColorProportions: (proportions) =>
    `Preserve the source page's approximate COLOR AREA PROPORTIONS across the finished poster: ${proportions}. Dominant source colors must remain dominant; accents must remain restrained when they were restrained in the source.`,
  heroIdentityRule:
    'Honor this brand — infuse its palette, typography, imagery, observed motifs, and vibe; reproduce a logo only when an authentic logo reference is attached:',
  heroAvoidControls: 'copied navigation or web controls',
  heroFallbackArtStyle: 'source-faithful editorial graphic design',
  heroFallbackTopRole: 'brand row',
  heroFallbackMidRole: 'source-derived imagery focal area',
  heroFallbackDetailRole: 'supporting product detail',
};

const SOCIAL_STAGE_VOCABULARY: StageVocabulary = {
  parentFirstRefresh:
    'Use the supplied creative references as the visual source of truth.',
  parentRefresh:
    'REFERENCE REFRESH: Rebuild the visual direction from the newly supplied references and creative context while preserving requested continuity from the previous version.',
  parentSnapshot:
    'REFERENCE SNAPSHOT: Reuse the frozen reference-led direction without inventing a new visual language.',
  designerPosterKind: 'full-bleed social cover artwork',
  designerReferenceSubjects:
    'previous artwork and user-supplied creative references.',
  designerEvidenceRule:
    'Use the supplied visual evidence rather than category assumptions or a generic template.',
  designerSourceObservationsHeading: 'REFERENCE-LED VISUAL DIRECTION:',
  designerZoneRoleExample: 'identity line / visual hook / supporting detail',
  designerRules:
    'RULES: design 3-7 zones ordered top→lower according to the observed reference density and hierarchy: sparse references get 3-4, balanced references 4-5, and dense references 5-7. Do not force a feature grid, stats row, icon set, or proof strip. Use those only when the supplied creative direction supports them. Preserve intentional negative space for sparse references. Use the band labels to place the chosen zones across the full artwork. ',
  designerPaletteRule:
    'Keep every content string SHORT and legible. The palette_roles MUST use the reference-led colors provided. Preserve color usage proportions: dominant neutrals remain dominant and small accents remain restrained. ',
  designerSubjectLabel: 'ARTWORK NAME',
  designerTaglineLabel: 'SUPPORTING LINE',
  designerEssenceLabel: 'VISUAL ESSENCE (word-portrait for the art director)',
  designerColorsLabel: 'REFERENCE-LED COLORS (use these for palette_roles)',
  designerObservationFallback: '(read from the supplied references)',
  designerLogoMissing:
    'LOGO: (not selected — use the artwork name as plain text only when the composition needs an identity line)',
  designerImageLabel: 'PRIMARY REFERENCE IMAGE',
  designerFallbackTopRole: 'plain-text identity line',
  designerFallbackMidRole: 'reference-led visual focal area',
  heroPosterKind: 'full-bleed social cover artwork',
  heroStyleBoardAttached:
    'A labeled visual reference board is attached. Treat it as supporting evidence while preserving the priority described by each reference label.',
  heroStyleBoardMissing:
    'Use the supplied creative references and reference-led direction below.',
  heroTranslationRule:
    'Translate the supplied mood, visual hook, palette, typography, imagery treatment, and motifs into an original full-bleed composition. Do not add navigation, interface chrome, cards, buttons, tabs, form controls, or unrequested promotional mechanics. Any REFERENCE PURPOSE labels attached after this prompt are instructions only and must never appear as artwork text.',
  heroReferenceSummary: (count) =>
    `${count} creative reference image(s) accompany this prompt. Use them as primary visual evidence for the requested artwork.`,
  heroNoLogoSubject: 'artwork name',
  heroSparseDensityRule:
    'Preserve the references\' SPARSE rhythm: use only the supplied zones, keep generous intentional negative space, and resist adding filler details.',
  heroBalancedDensityRule:
    'Preserve a BALANCED rhythm: maintain clear hierarchy and measured supporting detail without crowding or artificial emptiness.',
  heroDenseDensityRule:
    'Preserve the references\' DENSE rhythm: layer the supplied zones and supporting visual detail while keeping every element legible.',
  heroPaletteBoundary: (supporting) =>
    `${supporting ? ` Supporting reference colors: ${supporting}.` : ''} Stay within this palette plus reference neutrals — no rogue colors.`,
  heroColorProportions: (proportions) =>
    `Preserve the references' approximate COLOR AREA PROPORTIONS across the finished artwork: ${proportions}. Dominant colors must remain dominant; accents must remain restrained when the references keep them restrained.`,
  heroIdentityRule:
    'Honor this visual direction — carry through its palette, typography, imagery, motifs, mood, and visual hook; reproduce a logo only when an authentic logo reference is attached:',
  heroAvoidControls: 'unrequested interface chrome',
  heroFallbackArtStyle: 'reference-led editorial artwork',
  heroFallbackTopRole: 'identity line',
  heroFallbackMidRole: 'reference-led visual focal area',
  heroFallbackDetailRole: 'supporting artwork detail',
};

const WEBSITE_RECIPE: ProductUseCaseRecipe = {
  kind: 'product',
  id: 'website_product',
  acquisitionMode: 'website',
  analyze: {
    promptKind: 'product-source',
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
    platformInstruction: () => '',
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
    promptKind: 'product-source',
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
    platformInstruction: () => '',
  },
  references: {
    ...COMMON_PRODUCT_REFERENCES,
    analysisUserReference: (index) =>
      `Seller-supplied product or brand reference ${index}; treat as primary visual evidence for this Amazon product.`,
  },
  stages: CURRENT_PRODUCT_STAGE_VOCABULARY,
};

const SOCIAL_COVER_RECIPE: ProductUseCaseRecipe = {
  kind: 'product',
  id: 'social_cover',
  acquisitionMode: 'reference-only',
  analyze: {
    promptKind: 'social-reference',
    sourceBrief:
      'Given creative context, user-supplied visual references, and an optional target-platform hint, identify the mood, strongest visual hook, composition, palette, typography, imagery treatment, and motifs actually supported by that evidence. ',
    paletteBrief:
      'The palette and usage proportions MUST reflect the supplied references. Preserve dominant neutrals and restrained accents instead of amplifying every vivid pixel. ',
    densityBrief:
      'Classify density from the supplied reference hierarchy and creative direction.',
    evidenceSource: () => 'user-supplied creative references and direction',
    sourceText: () => '',
    referenceInstruction: (count) =>
      `The user supplied ${count} creative reference image(s). Treat them as primary style evidence and never as text to reproduce verbatim.`,
    platformInstruction: (platformHint) =>
      platformHint
        ? `TARGET PLATFORM HINT: ${platformHint}\nUse this only as composition and audience context; do not invent platform UI, logos, or badges.`
        : 'TARGET PLATFORM HINT: (none provided)',
  },
  references: {
    analysisStyleBoard:
      'Supporting visual reference board for palette, typography, imagery treatment, lighting, texture, motifs, and density.',
    analysisUserReference: (index) =>
      `Primary creative reference ${index}; use its mood, visual hook, composition, and styling as evidence without copying text.`,
    assetPreviousRefresh:
      'Previous artwork; preserve useful continuity only where it agrees with the new creative references and request.',
    assetPreviousIteration:
      'Primary edit source; preserve every visual choice not explicitly changed by the user.',
    assetUserReference: (index) =>
      `Primary creative reference ${index}; use it as style and composition evidence for this artwork.`,
    assetLogo:
      'Authentic supplied logo; reproduce it faithfully when included.',
    assetProduct: (index) =>
      `Authentic supplied subject image ${index}; preserve its real subject and visual details.`,
    assetStyleBoard:
      'Supporting reference evidence for palette, typography, imagery treatment, lighting, texture, motifs, and density.',
    designerPrevious:
      'The current artwork to edit. Preserve every visual choice not explicitly changed by the user request.',
    designerStyleBoard:
      'Supporting visual evidence for palette, typography, imagery, lighting, motifs, composition, and density.',
    designerUserReference: (index) =>
      `Primary creative reference ${index}; use its visual language as evidence for the requested artwork.`,
    heroPrevious:
      'Primary edit source: keep every visual choice that the user did not explicitly ask to change.',
    heroUserReference: (index) =>
      `Primary creative reference ${index}; carry its relevant mood, composition, and styling into the requested artwork.`,
    heroLogo:
      'Authentic supplied logo; reproduce faithfully only if this reference remains attached.',
    heroProduct: (index) =>
      `Authentic supplied subject image ${index}; preserve its real subject and visual details.`,
    heroStyleBoard:
      'Supporting reference evidence for palette, typography, imagery treatment, lighting, texture, motifs, and density.',
  },
  stages: SOCIAL_STAGE_VOCABULARY,
};

const REDNOTE_POST_RECIPE: ProductUseCaseRecipe = {
  ...SOCIAL_COVER_RECIPE,
  id: 'rednote_post',
  artworkMode: 'rednote-background-v1',
  analyze: {
    ...SOCIAL_COVER_RECIPE.analyze,
    outputMode: 'rednote-post-v1',
  },
};

const EVENT_RECIPE: EventUseCaseRecipe = {
  kind: 'event-bespoke',
  id: 'event',
  acquisitionMode: 'event-bespoke',
};

export function resolveUseCaseRecipe(useCase: unknown): UseCaseRecipe {
  if (useCase === 'amazon_listing') return AMAZON_RECIPE;
  if (useCase === 'social_cover') return SOCIAL_COVER_RECIPE;
  if (useCase === 'rednote_post') return REDNOTE_POST_RECIPE;
  if (useCase === 'event') return EVENT_RECIPE;
  return WEBSITE_RECIPE;
}

export function resolveProductUseCaseRecipe(
  useCase: unknown,
): ProductUseCaseRecipe {
  const recipe = resolveUseCaseRecipe(useCase);
  return recipe.kind === 'product' ? recipe : WEBSITE_RECIPE;
}

export function isReferenceOnlyProductRecipe(
  recipe: ProductUseCaseRecipe,
): boolean {
  return recipe.acquisitionMode === 'reference-only';
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
