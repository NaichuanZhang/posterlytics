import { createClient as createInsForgeClient } from 'npm:@insforge/sdk';
import {
  lookupAmazonProductTitle,
  validateAmazonProductLookupRequest,
  type AmazonProductLookupResult,
  type ValidatedAmazonProductLookupRequest,
} from './_amazonProductLookup.ts';
import {
  mapCapturePreviewRateLimit,
} from './_captureRateLimit.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

interface LookupUserClient {
  auth: {
    getCurrentUser: () => Promise<{
      data?: { user?: { id?: string | null } | null } | null;
    }>;
  };
  database: {
    rpc: (
      name: string,
      parameters: Record<string, never>,
    ) => Promise<{ data: unknown; error: unknown }>;
  };
}

export interface AmazonProductLookupHandlerDependencies {
  createClient?: (request: Request) => LookupUserClient;
  lookup?: (
    request: ValidatedAmazonProductLookupRequest,
  ) => Promise<AmazonProductLookupResult>;
}

export function createAmazonProductLookupHandler(
  dependencies: AmazonProductLookupHandlerDependencies = {},
): (request: Request) => Promise<Response> {
  const createClient = dependencies.createClient ?? createLookupUserClient;
  const lookup = dependencies.lookup ?? lookupAmazonProductTitle;

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (req.method !== 'POST') {
      const response = errorResponse(
        405,
        'method_not_allowed',
        'Use POST for Amazon product lookup.',
        false,
      );
      response.headers.set('Allow', 'POST, OPTIONS');
      return response;
    }

    let client: LookupUserClient;
    try {
      client = createClient(req);
      const { data } = await client.auth.getCurrentUser();
      if (!data?.user?.id) {
        return errorResponse(
          401,
          'unauthorized',
          'Unauthorized',
          false,
        );
      }
    } catch {
      return errorResponse(
        503,
        'lookup_unavailable',
        'Amazon product lookup is temporarily unavailable.',
        true,
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse(
        400,
        'invalid_json',
        'The request body must be valid JSON.',
        false,
      );
    }

    const validated = validateAmazonProductLookupRequest(body);
    if (!validated.ok) {
      return jsonResponse({ error: validated.error }, validated.status);
    }

    let rateLimit;
    try {
      const { data, error } = await client.database.rpc(
        'consume_capture_preview_quota',
        {},
      );
      rateLimit = mapCapturePreviewRateLimit(data, error);
    } catch (error) {
      rateLimit = mapCapturePreviewRateLimit(null, error);
    }
    if (rateLimit.kind !== 'allow') {
      const response = rateLimit.kind === 'deny'
        ? errorResponse(
            429,
            'rate_limited',
            'Amazon product lookup is temporarily limited. Try again shortly.',
            true,
          )
        : errorResponse(
            503,
            'lookup_unavailable',
            'Amazon product lookup is temporarily unavailable.',
            true,
          );
      if (rateLimit.kind === 'deny') {
        response.headers.set(
          'Retry-After',
          rateLimit.retryAfterSeconds.toString(),
        );
      }
      return response;
    }

    try {
      const result = await lookup(validated.value);
      return jsonResponse(result.status === 'found'
        ? { status: 'found', title: result.title }
        : { status: 'unavailable' });
    } catch {
      return jsonResponse({ status: 'unavailable' });
    }
  };
}

function errorResponse(
  status: 400 | 401 | 405 | 429 | 503,
  code: string,
  message: string,
  retryable: boolean,
): Response {
  return jsonResponse({
    error: { code, message, retryable },
  }, status);
}

function createLookupUserClient(req: Request): LookupUserClient {
  const authHeader = req.headers.get('Authorization');
  const token = authHeader ? authHeader.replace('Bearer ', '') : null;
  return createInsForgeClient({
    baseUrl: requiredEnv('INSFORGE_BASE_URL'),
    edgeFunctionToken: token ?? undefined,
  }) as unknown as LookupUserClient;
}

function requiredEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing env: ${key}`);
  return value;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export default createAmazonProductLookupHandler();
