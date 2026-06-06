import {
  CORS,
  env,
  aiImage,
  dataUrlToBlob,
  jsonResponse,
  createUserClient,
} from './_shared.ts';

// `hero` is the AI hero-image FALLBACK — the SPA calls it only when `analyze`
// found no usable real product imagery. It paints an on-brand background from
// the style profile, stores it in the public `assets` bucket, and saves the URL.
export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResponse({ error: 'method' }, 405);

  const baseUrl = env('INSFORGE_BASE_URL');
  const apiKey = env('API_KEY');
  const client = createUserClient(req);

  const { data: userData } = await client.auth.getCurrentUser();
  if (!userData?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: { campaignId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad json' }, 400);
  }
  if (!body.campaignId) return jsonResponse({ error: 'missing campaignId' }, 400);

  const { data: campaign, error: cErr } = await client.database
    .from('campaigns')
    .select('id, product_name, tagline, style_profile, poster_copy')
    .eq('id', body.campaignId)
    .maybeSingle();
  if (cErr || !campaign) return jsonResponse({ error: 'campaign not found' }, 404);

  const sp = ((campaign as Record<string, unknown>).style_profile ?? {}) as {
    palette?: { primary?: string; accent?: string };
    tone?: string;
  };
  const pc = ((campaign as Record<string, unknown>).poster_copy ?? {}) as { what_it_does?: string };
  const tone = sp.tone || 'modern, clean';
  const primary = sp.palette?.primary || '#4f46e5';
  const accent = sp.palette?.accent || primary;

  const prompt =
    `Premium advertising hero background for the product "${campaign.product_name}". ` +
    `${pc.what_it_does ? `It is: ${pc.what_it_does}. ` : ''}` +
    `Mood and tone: ${tone}. Brand colors: ${primary} and ${accent}. ` +
    `Abstract, product-forward, high-end marketing aesthetic with generous negative space in the ` +
    `upper-left for text overlay. Absolutely NO text, NO words, NO letters, NO logos in the image.`;

  let dataUrl: string;
  try {
    dataUrl = await aiImage(baseUrl, apiKey, prompt, '4:5');
  } catch (e) {
    return jsonResponse({ error: String(e) }, 502);
  }

  let url: string;
  let key: string;
  try {
    const blob = dataUrlToBlob(dataUrl);
    const { data, error } = await client.storage
      .from('assets')
      .upload(`hero/${campaign.id}/${crypto.randomUUID()}.png`, blob);
    if (error || !data) return jsonResponse({ error: error?.message ?? 'upload failed' }, 500);
    url = data.url;
    key = data.key;
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }

  const { error: upErr } = await client.database
    .from('campaigns')
    .update({ hero_image_url: url, hero_image_key: key })
    .eq('id', campaign.id);
  if (upErr) return jsonResponse({ error: upErr.message }, 500);

  return jsonResponse({ hero_image_url: url });
}
