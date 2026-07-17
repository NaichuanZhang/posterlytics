import {
  CORS,
  ReferenceImportError,
  createUserClient,
  fetchPublicReferenceImage,
  importedReferenceFilename,
  jsonResponse,
} from './_shared.ts';

export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResponse({ error: 'method' }, 405);

  const client = createUserClient(req);
  const { data: userData } = await client.auth.getCurrentUser();
  const userId = userData?.user?.id;
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: { campaignId?: unknown; url?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad json' }, 400);
  }
  if (typeof body.campaignId !== 'string' || typeof body.url !== 'string') {
    return jsonResponse({ error: 'campaignId and url are required' }, 400);
  }

  const { data: campaign, error: campaignError } = await client.database
    .from('campaigns')
    .select('id, user_id')
    .eq('id', body.campaignId)
    .eq('user_id', userId)
    .maybeSingle();
  if (campaignError || !campaign) {
    return jsonResponse({ error: 'campaign not found' }, 404);
  }

  try {
    const imported = await fetchPublicReferenceImage(body.url);
    const name = importedReferenceFilename(imported.finalUrl, imported.mimeType);
    const key = `references/${userId}/${campaign.id}/${crypto.randomUUID()}-${name}`;
    const blob = new Blob([imported.bytes], { type: imported.mimeType });
    const { data, error } = await client.storage.from('assets').upload(key, blob);
    if (error || !data) {
      return jsonResponse({ error: error?.message ?? 'Image storage failed.' }, 502);
    }

    return jsonResponse({
      key: data.key,
      url: data.url,
      name,
      mime_type: imported.mimeType,
      size_bytes: imported.bytes.byteLength,
    });
  } catch (error) {
    if (error instanceof ReferenceImportError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status);
    }
    return jsonResponse({ error: 'Image import failed.' }, 500);
  }
}
