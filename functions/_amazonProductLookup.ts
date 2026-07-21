import {
  canonicalAmazonProductUrl,
  extractAmazonProductTitle,
  parseAmazonAsin,
  sanitizeAmazonProductTitle,
} from '../src/lib/amazonProduct.ts';
import {
  captureSite,
  type CaptureResult,
} from './_captureSite.ts';

export const AMAZON_PRODUCT_LOOKUP_TIMEOUT_MS = 8_000;
export const MAX_AMAZON_PRODUCT_HTML_BYTES = 1_000_000;
export const MAX_AMAZON_PRODUCT_REDIRECTS = 3;

const AMAZON_FETCH_HOSTS = new Set(['amazon.com', 'www.amazon.com']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_IPV4_CIDRS: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
const BLOCKED_IPV6_CIDRS: Array<[string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

export type AmazonDnsResolver = (hostname: string) => Promise<string[]>;

export interface AmazonProductLookupError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ValidatedAmazonProductLookupRequest {
  asin: string;
  canonicalUrl: string;
}

export type AmazonProductLookupRequestResult =
  | { ok: true; value: ValidatedAmazonProductLookupRequest }
  | {
      ok: false;
      status: 400 | 422;
      error: AmazonProductLookupError;
    };

export type AmazonProductLookupResult =
  | { status: 'found'; title: string }
  | { status: 'unavailable' };

export interface AmazonProductPage {
  html: string;
  finalUrl: string;
}

interface AmazonProductLookupDependencies {
  fetchImpl?: typeof fetch;
  resolveHostname?: AmazonDnsResolver;
  capture?: (
    url: string,
    colorScheme: 'light' | 'dark',
  ) => Promise<CaptureResult>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export function validateAmazonProductLookupRequest(
  value: unknown,
): AmazonProductLookupRequestResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return requestFailure(
      400,
      'invalid_request',
      'The request body must be a JSON object.',
    );
  }

  const urlValue = (value as Record<string, unknown>).url;
  if (typeof urlValue !== 'string') {
    return requestFailure(
      400,
      'invalid_request',
      'The request must include a string url field.',
    );
  }

  let sourceUrl: URL;
  try {
    if (urlValue.trim().length > 2_048) throw new Error('too long');
    sourceUrl = new URL(urlValue.trim());
  } catch {
    return requestFailure(
      422,
      'invalid_amazon_product_url',
      'Enter a supported Amazon product URL containing an ASIN.',
    );
  }
  if (sourceUrl.username || sourceUrl.password) {
    return requestFailure(
      422,
      'invalid_amazon_product_url',
      'Enter a supported Amazon product URL containing an ASIN.',
    );
  }

  const asin = parseAmazonAsin(sourceUrl.href);
  const canonicalUrl = asin ? canonicalAmazonProductUrl(asin) : null;
  if (!asin || !canonicalUrl) {
    return requestFailure(
      422,
      'invalid_amazon_product_url',
      'Enter a supported Amazon product URL containing an ASIN.',
    );
  }

  return {
    ok: true,
    value: { asin, canonicalUrl },
  };
}

export async function lookupAmazonProductTitle(
  request: ValidatedAmazonProductLookupRequest,
  dependencies: AmazonProductLookupDependencies = {},
): Promise<AmazonProductLookupResult> {
  const fetchPromise = fetchAmazonProductPage(
    request.canonicalUrl,
    request.asin,
    dependencies,
  );
  const capturePromise = Promise.resolve().then(() =>
    (dependencies.capture ?? captureSite)(request.canonicalUrl, 'light')
  );
  const [pageResult, captureResult] = await Promise.allSettled([
    fetchPromise,
    capturePromise,
  ]);

  if (pageResult.status === 'fulfilled') {
    const title = extractAmazonProductTitle(pageResult.value.html);
    if (title) return { status: 'found', title };
  }

  if (captureResult.status === 'fulfilled') {
    const capture = captureResult.value;
    const finalAsin = capture.finalUrl
      ? parseAmazonAsin(capture.finalUrl)
      : null;
    const title = capture.error === null && finalAsin === request.asin
      ? sanitizeAmazonProductTitle(capture.pageTitle)
      : null;
    if (title) return { status: 'found', title };
  }

  return { status: 'unavailable' };
}

export async function fetchAmazonProductPage(
  canonicalUrl: string,
  expectedAsin: string,
  options: Pick<
    AmazonProductLookupDependencies,
    'fetchImpl' | 'resolveHostname' | 'timeoutMs' | 'maxBytes' | 'maxRedirects'
  > = {},
): Promise<AmazonProductPage> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveHostname = options.resolveHostname ?? resolveAmazonHostname;
  const timeoutMs = boundedPositive(
    options.timeoutMs,
    AMAZON_PRODUCT_LOOKUP_TIMEOUT_MS,
    20_000,
  );
  const maxBytes = boundedPositive(
    options.maxBytes,
    MAX_AMAZON_PRODUCT_HTML_BYTES,
    MAX_AMAZON_PRODUCT_HTML_BYTES,
  );
  const maxRedirects = boundedNonNegative(
    options.maxRedirects,
    MAX_AMAZON_PRODUCT_REDIRECTS,
    MAX_AMAZON_PRODUCT_REDIRECTS,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const resolveWithDeadline: AmazonDnsResolver = (hostname) =>
    abortable(resolveHostname(hostname), controller.signal);

  try {
    let currentUrl = await assertSafeAmazonFetchUrl(
      canonicalUrl,
      resolveWithDeadline,
    );
    let redirectCount = 0;

    while (true) {
      const response = await fetchImpl(currentUrl.href, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9',
          'Accept-Language': 'en-US,en;q=0.8',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
            + 'AppleWebKit/537.36 (KHTML, like Gecko) '
            + 'Chrome/124.0 Safari/537.36',
        },
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirectCount >= maxRedirects) {
          await response.body?.cancel().catch(() => {});
          throw new Error('Amazon redirect limit exceeded.');
        }
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location) throw new Error('Amazon redirect was invalid.');
        currentUrl = await assertSafeAmazonFetchUrl(
          new URL(location, currentUrl),
          resolveWithDeadline,
        );
        redirectCount += 1;
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error('Amazon product page was unavailable.');
      }
      if (parseAmazonAsin(currentUrl.href) !== expectedAsin) {
        await response.body?.cancel().catch(() => {});
        throw new Error('Amazon product redirect changed the ASIN.');
      }

      const contentType = response.headers.get('content-type');
      if (
        contentType
        && !contentType.toLowerCase().includes('text/html')
        && !contentType.toLowerCase().includes('application/xhtml+xml')
      ) {
        await response.body?.cancel().catch(() => {});
        throw new Error('Amazon product response was not HTML.');
      }

      return {
        html: await readBoundedHtml(response, maxBytes),
        finalUrl: currentUrl.href,
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function assertSafeAmazonFetchUrl(
  value: string | URL,
  resolveHostname: AmazonDnsResolver,
): Promise<URL> {
  let url: URL;
  try {
    const raw = value instanceof URL ? value.href : value;
    if (raw.length > 2_048) throw new Error('too long');
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    throw new Error('Amazon target URL was invalid.');
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || !AMAZON_FETCH_HOSTS.has(url.hostname)
    || (url.port && url.port !== '443')
  ) {
    throw new Error('Amazon redirect target was not allowed.');
  }
  const addresses = await resolveHostname(url.hostname);
  if (
    addresses.length === 0
    || addresses.some(isPrivateOrReservedAddress)
  ) {
    throw new Error('Amazon target did not resolve to a public network.');
  }
  return url;
}

async function resolveAmazonHostname(hostname: string): Promise<string[]> {
  const results = await Promise.allSettled([
    Deno.resolveDns(hostname, 'A'),
    Deno.resolveDns(hostname, 'AAAA'),
  ]);
  return results.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  );
}

async function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
  return await new Promise<T>((resolve, reject) => {
    const handleAbort = () =>
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    signal.addEventListener('abort', handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', handleAbort);
        reject(error);
      },
    );
  });
}

async function readBoundedHtml(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('Amazon product response exceeded the size limit.');
  }
  if (!response.body) throw new Error('Amazon product response was empty.');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('Amazon product response exceeded the size limit.');
    }
    chunks.push(value);
  }
  if (total === 0) throw new Error('Amazon product response was empty.');

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function requestFailure(
  status: 400 | 422,
  code: string,
  message: string,
): AmazonProductLookupRequestResult {
  return {
    ok: false,
    status,
    error: { code, message, retryable: false },
  };
}

function boundedPositive(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

function boundedNonNegative(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? Math.min(value, maximum)
    : fallback;
}

function isPrivateOrReservedAddress(address: string): boolean {
  const parsed = parseIpAddress(address);
  if (!parsed) return true;
  const cidrs = parsed.length === 4 ? BLOCKED_IPV4_CIDRS : BLOCKED_IPV6_CIDRS;
  return cidrs.some(([network, prefix]) => {
    const parsedNetwork = parseIpAddress(network);
    return !!parsedNetwork
      && matchesAddressPrefix(parsed, parsedNetwork, prefix);
  });
}

function parseIpAddress(address: string): number[] | null {
  const value = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (value.includes('%')) return null;
  return value.includes(':') ? parseIpv6(value) : parseIpv4(value);
}

function parseIpv4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) =>
    /^\d{1,3}$/.test(part) ? Number(part) : -1
  );
  return bytes.every((part) => part >= 0 && part <= 255) ? bytes : null;
}

function parseIpv6(value: string): number[] | null {
  let normalized = value;
  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':');
    const ipv4 = parseIpv4(normalized.slice(lastColon + 1));
    if (lastColon < 0 || !ipv4) return null;
    normalized = `${normalized.slice(0, lastColon)}:`
      + `${((ipv4[0] << 8) | ipv4[1]).toString(16)}:`
      + `${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1]
    ? halves[1].split(':')
    : [];
  if (
    [...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))
    || (halves.length === 1 && left.length !== 8)
    || (halves.length === 2 && left.length + right.length >= 8)
  ) {
    return null;
  }

  const groups = [
    ...left,
    ...Array(8 - left.length - right.length).fill('0'),
    ...right,
  ].map((part) => Number.parseInt(part, 16));
  if (groups.length !== 8) return null;
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

function matchesAddressPrefix(
  address: number[],
  network: number[],
  prefix: number,
): boolean {
  if (
    address.length !== network.length
    || prefix < 0
    || prefix > address.length * 8
  ) {
    return false;
  }
  const wholeBytes = Math.floor(prefix / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (address[index] !== network[index]) return false;
  }
  const remainingBits = prefix % 8;
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (address[wholeBytes] & mask) === (network[wholeBytes] & mask);
}
