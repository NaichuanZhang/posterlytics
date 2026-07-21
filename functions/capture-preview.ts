import {
  CORS,
  createUserClient,
  jsonResponse,
} from './_shared.ts';
import {
  mapCapturePreview,
  parseCapturePreviewRequest,
  validateCapturePreviewRequest,
} from './_capturePreview.ts';
import {
  acquireProductPreviewSource,
} from './_sourceAcquisition.ts';
import {
  resolveProductUseCaseRecipe,
} from './_useCasePolicy.ts';

export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== 'POST') {
    const response = jsonResponse({
      error: {
        code: 'method_not_allowed',
        message: 'Use POST for capture preview.',
        retryable: false,
      },
    }, 405);
    response.headers.set('Allow', 'POST, OPTIONS');
    return response;
  }

  const client = createUserClient(req);
  const { data: userData } = await client.auth.getCurrentUser();
  if (!userData?.user?.id) {
    return jsonResponse({
      error: {
        code: 'unauthorized',
        message: 'Unauthorized',
        retryable: false,
      },
    }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({
      error: {
        code: 'invalid_json',
        message: 'The request body must be valid JSON.',
        retryable: false,
      },
    }, 400);
  }

  const parsed = parseCapturePreviewRequest(body);
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, parsed.status);
  }
  const validated = validateCapturePreviewRequest(parsed.value);
  if (!validated.ok) {
    return jsonResponse({ error: validated.error }, validated.status);
  }

  const recipe = resolveProductUseCaseRecipe(validated.value.useCase);
  const acquisition = await acquireProductPreviewSource(
    validated.value.url,
    validated.value.colorScheme,
    recipe,
  );

  // Capture-service failures, including its private-network rejection, are
  // preview degradation rather than request validation failures.
  return jsonResponse(mapCapturePreview(validated.value.url, acquisition));
}
