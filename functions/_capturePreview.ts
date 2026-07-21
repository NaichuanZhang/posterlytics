import {
  classifyProductSourceUrl,
} from '../src/lib/amazonSource.ts';
import { normalizeCaptureUrl } from '../src/lib/captureUrl.ts';
import {
  normalizeCaptureColorScheme,
  parseColor,
  toHex,
  type CaptureColorScheme,
  type CaptureResult,
  type DesignTokens,
} from './_shared.ts';
import type { ProductSourceAcquisition } from './_sourceAcquisition.ts';
import {
  useCaseSourceMismatch,
} from './_useCasePolicy.ts';
import {
  extractAssets,
  extractColors,
} from './_websiteEvidence.ts';

export const MAX_CAPTURE_PREVIEW_IMAGES = 4;
export const MAX_CAPTURE_PREVIEW_COLORS = 6;
export const MAX_CAPTURE_PREVIEW_FONTS = 2;

const CAPTURE_UNAVAILABLE_CODES = new Set([
  'capture_network_error',
  'capture_failed',
  'capture_http_error',
  'capture_timeout',
  'capture_unconfigured',
]);

export interface CapturePreviewError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ParsedCapturePreviewRequest {
  url: string;
  useCase: string;
  colorScheme: CaptureColorScheme;
}

export interface ValidatedCapturePreviewRequest
  extends ParsedCapturePreviewRequest {
  useCase: 'website_product';
}

export interface CapturePreview {
  sourceUrl: string;
  styleBoardDataUrl: string | null;
  logoUrl: string | null;
  imageUrls: string[];
  colors: string[];
  fonts: string[];
}

export interface CapturePreviewResponse {
  preview: CapturePreview;
  error: CapturePreviewError | null;
}

export type CapturePreviewRequestResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      status: 400 | 422;
      error: CapturePreviewError;
    };

export function parseCapturePreviewRequest(
  value: unknown,
): CapturePreviewRequestResult<ParsedCapturePreviewRequest> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return requestFailure(
      400,
      'invalid_request',
      'The request body must be a JSON object.',
    );
  }

  const body = value as Record<string, unknown>;
  if (
    typeof body.url !== 'string'
    || typeof body.use_case !== 'string'
  ) {
    return requestFailure(
      400,
      'invalid_request',
      'The request must include string url and use_case fields.',
    );
  }

  const colorScheme = normalizeCaptureColorScheme(body.color_scheme);
  if (!colorScheme) {
    return requestFailure(
      400,
      'invalid_color_scheme',
      'color_scheme must be "light" or "dark".',
    );
  }

  return {
    ok: true,
    value: {
      url: body.url,
      useCase: body.use_case,
      colorScheme,
    },
  };
}

export function validateCapturePreviewRequest(
  request: ParsedCapturePreviewRequest,
): CapturePreviewRequestResult<ValidatedCapturePreviewRequest> {
  if (request.useCase !== 'website_product') {
    return requestFailure(
      422,
      'unsupported_use_case',
      'Capture preview is available only for website products.',
    );
  }

  const normalizedUrl = normalizeCaptureUrl(request.url);
  if (!normalizedUrl) {
    return requestFailure(
      422,
      'invalid_source_url',
      'Enter a complete HTTP or HTTPS website URL.',
    );
  }

  const sourceKind = classifyProductSourceUrl(normalizedUrl);
  const sourceMismatch = useCaseSourceMismatch(
    request.useCase,
    normalizedUrl,
  );
  if (sourceMismatch) {
    return {
      ok: false,
      status: 422,
      error: { ...sourceMismatch },
    };
  }
  if (sourceKind !== 'website') {
    return requestFailure(
      422,
      'invalid_source_url',
      'Enter a non-Amazon HTTP or HTTPS website URL.',
    );
  }

  return {
    ok: true,
    value: {
      ...request,
      useCase: 'website_product',
      url: normalizedUrl,
    },
  };
}

export function mapCapturePreview(
  sourceUrl: string,
  acquisition: ProductSourceAcquisition,
): CapturePreviewResponse {
  const capture = acquisition.capture;
  const assets = extractAssets(acquisition.html, sourceUrl);
  const logoUrl = firstSourceImageUrl(assets.logoCandidates);
  const imageUrls = uniqueSourceImageUrls(assets.images)
    .filter((url) => url !== logoUrl)
    .slice(0, MAX_CAPTURE_PREVIEW_IMAGES);
  const tokenColors = colorsFromTokens(capture?.tokens ?? null);
  const themeColors = normalizeColors([assets.themeColor]);
  const colors = (
    tokenColors.length > 0
      ? tokenColors
      : themeColors.length > 0
        ? themeColors
        : normalizeColors(extractColors(acquisition.html))
  ).slice(0, MAX_CAPTURE_PREVIEW_COLORS);

  return {
    preview: {
      sourceUrl,
      styleBoardDataUrl: inlineStyleBoard(capture?.styleBoardDataUrl),
      logoUrl,
      imageUrls,
      colors,
      fonts: fontsFromTokens(capture?.tokens ?? null),
    },
    error: capture?.error
      ? sanitizeCaptureError(capture.error)
      : capture
        ? null
        : {
            code: 'capture_unavailable',
            message: 'Website capture did not run.',
            retryable: true,
          },
  };
}

function sanitizeCaptureError(
  error: NonNullable<CaptureResult['error']>,
): CapturePreviewError {
  return {
    code: error.code,
    message: CAPTURE_UNAVAILABLE_CODES.has(error.code)
      ? 'Website capture was unavailable.'
      : 'Website capture did not complete.',
    retryable: error.retryable,
  };
}

function requestFailure(
  status: 400 | 422,
  code: string,
  message: string,
): CapturePreviewRequestResult<never> {
  return {
    ok: false,
    status,
    error: { code, message, retryable: false },
  };
}

function firstSourceImageUrl(values: readonly string[]): string | null {
  return uniqueSourceImageUrls(values)[0] ?? null;
}

function uniqueSourceImageUrls(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const value of values) {
    try {
      const url = new URL(value);
      if (
        (url.protocol !== 'http:' && url.protocol !== 'https:')
        || url.username
        || url.password
      ) {
        continue;
      }
      url.hash = '';
      const normalized = url.toString();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
    } catch {
      // Ignore malformed source evidence without failing the whole preview.
    }
  }
  return urls;
}

function colorsFromTokens(tokens: DesignTokens | null): string[] {
  if (!tokens) return [];
  return normalizeColors([
    ...(tokens.colors.visualPalette ?? []).map((entry) => entry.color),
    tokens.colors.primary,
    tokens.colors.accent,
    ...tokens.colors.palette,
    tokens.colors.bg,
    tokens.colors.text,
  ]);
}

function normalizeColors(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const colors: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const rgb = parseColor(value);
    if (!rgb) continue;
    const color = toHex(rgb);
    if (!seen.has(color)) {
      seen.add(color);
      colors.push(color);
    }
  }
  return colors;
}

function fontsFromTokens(tokens: DesignTokens | null): string[] {
  if (!tokens) return [];
  const seen = new Set<string>();
  const fonts: string[] = [];
  for (const value of [
    tokens.typography.headingFamily,
    tokens.typography.bodyFamily,
  ]) {
    const font = value.trim().slice(0, 160);
    if (font && !seen.has(font)) {
      seen.add(font);
      fonts.push(font);
    }
  }
  return fonts.slice(0, MAX_CAPTURE_PREVIEW_FONTS);
}

function inlineStyleBoard(value: CaptureResult['styleBoardDataUrl']): string | null {
  return typeof value === 'string'
    && /^data:image\/jpeg;base64,[a-z0-9+/=\r\n]+$/i.test(value)
    ? value
    : null;
}
