import { isAmazonSourceUrl } from '../src/lib/amazonSource.ts';
import {
  captureSite,
  type CaptureColorScheme,
  type CaptureResult,
} from './_shared.ts';
import type {
  ProductSourceMode,
  ProductUseCaseRecipe,
} from './_useCasePolicy.ts';

export type { ProductSourceMode } from './_useCasePolicy.ts';

export interface ProductSourceAcquisition {
  mode: ProductSourceMode;
  html: string;
  capture: CaptureResult | null;
}

interface SourceAcquisitionDependencies {
  fetchHtml: (url: string) => Promise<string>;
  capture: (
    url: string,
    colorScheme: CaptureColorScheme,
  ) => Promise<CaptureResult>;
}

export interface StyleBoardPointers {
  screenshotUrl: string | null;
  screenshotKey: string | null;
}

async function fetchProductHtml(productUrl: string): Promise<string> {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 5000);
  try {
    const response = await fetch(productUrl, {
      signal: ctl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      },
    });
    return response.ok ? await response.text() : '';
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

const DEFAULT_DEPENDENCIES: SourceAcquisitionDependencies = {
  fetchHtml: fetchProductHtml,
  capture: captureSite,
};

export async function acquireProductSource(
  productUrl: string,
  colorScheme: CaptureColorScheme,
  recipe: ProductUseCaseRecipe,
  dependencies: SourceAcquisitionDependencies = DEFAULT_DEPENDENCIES,
): Promise<ProductSourceAcquisition> {
  // URL classification is the independent safety boundary: even a malformed
  // persisted recipe can never make a recognized Amazon host fetch or capture.
  if (
    isAmazonSourceUrl(productUrl)
    || recipe.acquisitionMode === 'amazon-reference'
  ) {
    return {
      mode: 'amazon-reference',
      html: '',
      capture: null,
    };
  }

  return {
    mode: 'website',
    html: await dependencies.fetchHtml(productUrl),
    capture: await dependencies.capture(productUrl, colorScheme),
  };
}

export function resolveInheritedStyleBoard(
  mode: ProductSourceMode,
  inherited: StyleBoardPointers,
): StyleBoardPointers {
  if (mode === 'amazon-reference') {
    return {
      screenshotUrl: null,
      screenshotKey: null,
    };
  }
  return { ...inherited };
}
