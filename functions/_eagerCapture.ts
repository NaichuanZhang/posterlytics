import { normalizeCaptureUrl } from '../src/lib/captureUrl.ts';
import type { DesignTokens } from './_shared.ts';
import type { ProductSourceMode } from './_sourceAcquisition.ts';

export const EAGER_CAPTURE_MAX_AGE_MS = 30 * 60 * 1000;
const EAGER_CAPTURE_MAX_IMAGES = 4;
const EAGER_CAPTURE_MAX_SELECTION_URLS = 6;

export type EagerCaptureReuseReason =
  | 'eligible'
  | 'missing_marker'
  | 'not_first_generation'
  | 'unsupported_use_case'
  | 'unsupported_source_mode'
  | 'url_mismatch'
  | 'color_scheme_mismatch'
  | 'invalid_captured_at'
  | 'captured_at_in_future'
  | 'stale'
  | 'missing_design_tokens'
  | 'missing_style_board'
  | 'invalid_style_board_url'
  | 'invalid_style_board_key'
  | 'invalid_brand_assets'
  | 'snapshot_mismatch';

export interface EagerCampaignSnapshot {
  id: unknown;
  product_url: unknown;
  scenario: unknown;
  use_case: unknown;
  design_tokens: unknown;
  brand_assets: unknown;
  screenshot_url: unknown;
  screenshot_key: unknown;
  eager_capture_url: unknown;
  eager_capture_color_scheme: unknown;
  eager_captured_at: unknown;
}

export interface EagerGenerationSnapshot {
  parent_generation_id: unknown;
  generation_mode: unknown;
  scenario: unknown;
  use_case: unknown;
  design_tokens: unknown;
  brand_assets: unknown;
  screenshot_url: unknown;
  screenshot_key: unknown;
}

export interface EagerSourceAssets {
  logoCandidates: string[];
  images: string[];
  selection?: {
    excludedUrls: string[];
    logoExcluded: boolean;
  };
}

export type EagerCaptureReuseDecision =
  | {
      reused: true;
      candidatePresent: true;
      reason: 'eligible';
      designTokens: DesignTokens;
      sourceAssets: EagerSourceAssets;
    }
  | {
      reused: false;
      candidatePresent: boolean;
      reason: Exclude<EagerCaptureReuseReason, 'eligible'>;
    };

export function evaluateEagerCaptureReuse({
  campaign,
  generation,
  colorScheme,
  productSourceMode,
  nowMs = Date.now(),
}: {
  campaign: EagerCampaignSnapshot;
  generation: EagerGenerationSnapshot;
  colorScheme: 'light' | 'dark';
  productSourceMode: ProductSourceMode;
  nowMs?: number;
}): EagerCaptureReuseDecision {
  const campaignId = stringValue(campaign.id);
  const candidatePresent = hasEagerCaptureCandidate(campaign, generation);
  const reject = (
    reason: Exclude<EagerCaptureReuseReason, 'eligible'>,
  ): EagerCaptureReuseDecision => ({
    reused: false,
    candidatePresent,
    reason,
  });

  if (!candidatePresent) return reject('missing_marker');
  if (
    generation.generation_mode !== 'website_refresh'
    || generation.parent_generation_id !== null
  ) {
    return reject('not_first_generation');
  }
  if (
    campaign.scenario !== 'product'
    || generation.scenario !== 'product'
    || campaign.use_case !== 'website_product'
    || generation.use_case !== 'website_product'
  ) {
    return reject('unsupported_use_case');
  }
  if (productSourceMode !== 'website') {
    return reject('unsupported_source_mode');
  }

  const normalizedProductUrl = typeof campaign.product_url === 'string'
    ? normalizeCaptureUrl(campaign.product_url)
    : null;
  const eagerUrl = stringValue(campaign.eager_capture_url);
  if (
    !normalizedProductUrl
    || !eagerUrl
    || normalizeCaptureUrl(eagerUrl) !== eagerUrl
    || eagerUrl !== normalizedProductUrl
  ) {
    return reject('url_mismatch');
  }
  if (campaign.eager_capture_color_scheme !== colorScheme) {
    return reject('color_scheme_mismatch');
  }

  const capturedAt = typeof campaign.eager_captured_at === 'string'
    ? Date.parse(campaign.eager_captured_at)
    : Number.NaN;
  if (!Number.isFinite(capturedAt)) return reject('invalid_captured_at');
  const ageMs = nowMs - capturedAt;
  if (ageMs < 0) return reject('captured_at_in_future');
  if (ageMs > EAGER_CAPTURE_MAX_AGE_MS) return reject('stale');

  if (
    !isUsableDesignTokens(campaign.design_tokens)
    || !isUsableDesignTokens(generation.design_tokens)
  ) {
    return reject('missing_design_tokens');
  }

  const campaignScreenshotUrl = stringValue(campaign.screenshot_url);
  const campaignScreenshotKey = stringValue(campaign.screenshot_key);
  const generationScreenshotUrl = stringValue(generation.screenshot_url);
  const generationScreenshotKey = stringValue(generation.screenshot_key);
  if (
    !campaignScreenshotUrl
    || !campaignScreenshotKey
    || !generationScreenshotUrl
    || !generationScreenshotKey
  ) {
    return reject('missing_style_board');
  }
  if (
    !safeSourceUrl(campaignScreenshotUrl)
    || !safeSourceUrl(generationScreenshotUrl)
  ) {
    return reject('invalid_style_board_url');
  }
  if (
    !campaignId
    || !isEagerStyleBoardKey(campaignScreenshotKey, campaignId)
    || !isEagerStyleBoardKey(generationScreenshotKey, campaignId)
  ) {
    return reject('invalid_style_board_key');
  }

  const campaignSourceAssets = parseEagerSourceAssets(campaign.brand_assets);
  const generationSourceAssets = parseEagerSourceAssets(generation.brand_assets);
  if (!campaignSourceAssets || !generationSourceAssets) {
    return reject('invalid_brand_assets');
  }
  if (
    campaignScreenshotUrl !== generationScreenshotUrl
    || campaignScreenshotKey !== generationScreenshotKey
    || !jsonValuesEqual(campaign.design_tokens, generation.design_tokens)
    || !jsonValuesEqual(campaign.brand_assets, generation.brand_assets)
  ) {
    return reject('snapshot_mismatch');
  }

  return {
    reused: true,
    candidatePresent: true,
    reason: 'eligible',
    designTokens: generation.design_tokens,
    sourceAssets: generationSourceAssets,
  };
}

export function isEagerStyleBoardKey(
  value: unknown,
  campaignId: string,
): value is string {
  if (typeof value !== 'string') return false;
  const prefix = `style-board/${campaignId}/eager/`;
  const captureId = value.slice(prefix.length, -'.jpg'.length);
  return value.startsWith(prefix)
    && value.endsWith('.jpg')
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(captureId);
}

export function isUsableDesignTokens(value: unknown): value is DesignTokens {
  if (!isRecord(value)) return false;
  const typography = value.typography;
  const colors = value.colors;
  if (!isRecord(typography) || !isRecord(colors)) return false;
  if (
    !nonEmptyString(typography.headingFamily)
    || !nonEmptyString(typography.bodyFamily)
    || !nonEmptyNumberArray(typography.scale)
    || !nonEmptyNumberArray(typography.weights)
    || !nonEmptyString(colors.bg)
    || !nonEmptyString(colors.text)
    || !nonEmptyString(colors.primary)
    || !nonEmptyString(colors.accent)
    || !nonEmptyStringArray(colors.palette)
    || !nonEmptyNumberArray(value.radii)
    || !stringArray(value.shadows)
    || !nonEmptyNumberArray(value.spacing)
    || !stringArray(value.fontLinks)
  ) {
    return false;
  }
  if (
    colors.theme !== undefined
    && !['light', 'dark', 'mixed'].includes(String(colors.theme))
  ) {
    return false;
  }
  if (
    colors.visualPalette !== undefined
    && (
      !Array.isArray(colors.visualPalette)
      || colors.visualPalette.some((entry) =>
        !isRecord(entry)
        || !nonEmptyString(entry.color)
        || typeof entry.proportion !== 'number'
        || !Number.isFinite(entry.proportion)
      )
    )
  ) {
    return false;
  }
  if (value.button !== null) {
    if (!isRecord(value.button)) return false;
    if (
      !nonEmptyString(value.button.bg)
      || !nonEmptyString(value.button.color)
      || !finiteNumber(value.button.radius)
      || !finiteNumber(value.button.paddingX)
      || !finiteNumber(value.button.paddingY)
      || !finiteNumber(value.button.weight)
      || (
        value.button.shadow !== undefined
        && typeof value.button.shadow !== 'string'
      )
    ) {
      return false;
    }
  }
  return true;
}

function hasEagerCaptureCandidate(
  campaign: EagerCampaignSnapshot,
  generation: EagerGenerationSnapshot,
): boolean {
  const campaignId = stringValue(campaign.id);
  return [
    campaign.eager_capture_url,
    campaign.eager_capture_color_scheme,
    campaign.eager_captured_at,
  ].some((value) => value !== null && value !== undefined)
    || (!!campaignId && (
      isEagerStyleBoardKey(campaign.screenshot_key, campaignId)
      || isEagerStyleBoardKey(generation.screenshot_key, campaignId)
    ));
}

function parseEagerSourceAssets(value: unknown): EagerSourceAssets | null {
  if (
    !isRecord(value)
    || !Array.isArray(value.images)
    || value.images.length > EAGER_CAPTURE_MAX_IMAGES
  ) {
    return null;
  }
  const logoUrl = value.logo_url === undefined
    ? null
    : safeSourceUrl(value.logo_url);
  if (value.logo_url !== undefined && !logoUrl) return null;

  const images: string[] = [];
  for (const image of value.images) {
    if (!isRecord(image)) return null;
    const url = safeSourceUrl(image.url);
    if (!url) return null;
    if (!images.includes(url)) images.push(url);
  }
  const selection = parseEagerAssetSelection(value.eager_selection, images);
  return {
    logoCandidates: logoUrl ? [logoUrl] : [],
    images,
    ...(selection ? { selection } : {}),
  };
}

function parseEagerAssetSelection(
  value: unknown,
  capturedImageUrls: string[],
): EagerSourceAssets['selection'] | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 3
    || keys[0] !== 'excluded_urls'
    || keys[1] !== 'logo_excluded'
    || keys[2] !== 'version'
    || value.version !== 1
    || typeof value.logo_excluded !== 'boolean'
    || !Array.isArray(value.excluded_urls)
    || value.excluded_urls.length > EAGER_CAPTURE_MAX_SELECTION_URLS
  ) {
    return null;
  }

  const captured = new Set(capturedImageUrls);
  const excludedUrls: string[] = [];
  for (const valueUrl of value.excluded_urls) {
    const url = safeSourceUrl(valueUrl);
    if (
      !url
      || url !== valueUrl
      || !captured.has(url)
      || excludedUrls.includes(url)
    ) {
      return null;
    }
    excludedUrls.push(url);
  }
  return {
    excludedUrls,
    logoExcluded: value.logo_excluded,
  };
}

function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username
      || url.password
    ) {
      return null;
    }
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => jsonValuesEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) =>
      key === rightKeys[index] && jsonValuesEqual(left[key], right[key])
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(finiteNumber);
}

function nonEmptyNumberArray(value: unknown): value is number[] {
  return numberArray(value) && value.length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function nonEmptyStringArray(value: unknown): value is string[] {
  return stringArray(value) && value.length > 0;
}
