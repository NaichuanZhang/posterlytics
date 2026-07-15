import {
  CORS,
  aiImage,
  errorDetails,
  imageSourceToBlob,
  jsonResponse,
  createUserClient,
  compileLayoutPrompt,
  logPipelineEvent,
  type PosterLayout,
} from './_shared.ts';

// `hero` renders the poster (2:3) as a single AI image. Products compile the
// LLM-designed poster_layout (produced by the `designer` agent) into the prompt
// via the pure compileLayoutPrompt(); events use their own bespoke event prompt.
// The image model gets TEXT ONLY, so the brand is described in words. The SPA
// letterboxes this image into the TOP ~81.5% and gives the QR its own branded
// band in the bottom row, so we prompt the model to FINISH all content by ~80%
// down and leave the bottom ~20% as empty margin (the crop line lands there,
// discarding nothing important). Stored in the public assets bucket.
export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResponse({ error: 'method' }, 405);

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
    .select('id, product_name, tagline, style_profile, poster_spec, poster_content, poster_copy, brand_essence, poster_layout, brand_assets, scenario, event_details, hero_image_key, reference_context, reference_images')
    .eq('id', body.campaignId)
    .maybeSingle();
  if (cErr || !campaign) return jsonResponse({ error: 'campaign not found' }, 404);

  // Event campaigns get their own promo-poster prompt; every product campaign
  // paints the designer layout (the fixed template modes were removed).
  const isEvent = (campaign as Record<string, unknown>).scenario === 'event';
  const style = isEvent ? 'event' : 'designer';

  // The real brand logo (if any) is passed to the image model as a reference so
  // it can paint the actual logo into the poster's brand row.
  const assets = ((campaign as Record<string, unknown>).brand_assets ?? {}) as { logo_url?: string };
  const userReferences = Array.isArray((campaign as Record<string, unknown>).reference_images)
    ? ((campaign as Record<string, unknown>).reference_images as Array<Record<string, unknown>>)
        .map((image) => typeof image.url === 'string' ? image.url : '')
        .filter(Boolean)
        .slice(0, 5)
    : [];
  const referenceImages = [...(assets.logo_url ? [assets.logo_url] : []), ...userReferences].slice(0, 6);
  const prompt = buildPosterPrompt(campaign as Record<string, unknown>, style, !!assets.logo_url);

  // The image model emits a native 2:3 portrait regardless of aspect_ratio; we
  // request 2:3 explicitly (AiPoster letterboxes it above the QR band).
  let imageSource: string;
  try {
    imageSource = await aiImage(prompt, '2:3', referenceImages);
  } catch (e) {
    logPipelineEvent({
      source: 'hero',
      campaignId: campaign.id,
      status: 'failed',
      code: 'image_generation_failed',
      detail: 'AI image generation failed',
      error: e,
    });
    const details = errorDetails(e);
    return jsonResponse({ error: details.message, code: details.code, retryable: details.retryable }, 502);
  }

  let url: string;
  let key: string;
  try {
    const blob = await imageSourceToBlob(imageSource);
    const { data, error } = await client.storage
      .from('assets')
      .upload(`poster/${campaign.id}/${crypto.randomUUID()}.png`, blob);
    if (error || !data) {
      logPipelineEvent({
        source: 'hero',
        campaignId: campaign.id,
        status: 'failed',
        code: 'poster_upload_failed',
        detail: 'poster image upload failed',
        error: error?.message ?? 'upload failed',
      });
      return jsonResponse({ error: error?.message ?? 'upload failed' }, 500);
    }
    url = data.url;
    key = data.key;
  } catch (e) {
    logPipelineEvent({
      source: 'hero',
      campaignId: campaign.id,
      status: 'failed',
      code: 'poster_upload_failed',
      detail: 'poster image upload threw',
      error: e,
    });
    return jsonResponse({ error: String(e) }, 500);
  }

  const { error: upErr } = await client.database
    .from('campaigns')
    .update({ hero_image_url: url, hero_image_key: key })
    .eq('id', campaign.id);
  if (upErr) {
    await client.storage.from('assets').remove(key).catch(() => {});
    logPipelineEvent({
      source: 'hero',
      campaignId: campaign.id,
      status: 'failed',
      code: 'campaign_persist_failed',
      detail: 'campaign persist failed after image generation',
      error: upErr,
    });
    return jsonResponse({ error: upErr.message }, 500);
  }
  const previousKey = String((campaign as Record<string, unknown>).hero_image_key ?? '');
  if (previousKey && previousKey !== key) {
    await client.storage.from('assets').remove(previousKey).catch(() => {});
  }

  // Return the compiled text-to-image prompt for the generation loading UI.
  return jsonResponse({ poster_image_url: url, prompt: { image: prompt } });
}

// Dispatch: events get the event promo prompt; products compile the
// LLM-designed poster_layout. If the layout is missing (designer step failed /
// not yet run), fall back to a minimal generic editorial layout compiled from
// the same brand context, so hero never hard-fails.
function buildPosterPrompt(c: Record<string, unknown>, style: string, hasLogo: boolean): string {
  const context = String(c.reference_context ?? '').trim().slice(0, 4000);
  const referenceCount = Array.isArray(c.reference_images) ? c.reference_images.length : 0;
  const referenceBlock =
    `\n\nUSER CREATIVE CONTEXT: ${context || '(none provided)'}` +
    `\n${referenceCount} user-supplied supporting image(s) accompany this prompt. Use them for subject, product, and visual direction fidelity.`;
  if (style === 'event') return buildEventPrompt(c, hasLogo) + referenceBlock;
  const layout = c.poster_layout as PosterLayout | null;
  const ctx = {
    product: String(c.product_name ?? 'the product'),
    essence: String(c.brand_essence ?? ''),
    hasLogo,
  };
  if (layout && Array.isArray(layout.zones) && layout.zones.length > 0) {
    return compileLayoutPrompt(layout, ctx) + referenceBlock;
  }
  return compileLayoutPrompt(fallbackLayout(c), ctx) + referenceBlock;
}

// A safe generic layout for when poster_layout is absent (designer failed or
// hasn't run). Same compileLayoutPrompt machinery, seeded from poster_content /
// poster_copy + the style_profile palette, so the poster still ships on-brand.
function fallbackLayout(c: Record<string, unknown>): PosterLayout {
  const product = String(c.product_name ?? 'the product');
  const content = (c.poster_content ?? {}) as Record<string, unknown>;
  const copy = (c.poster_copy ?? {}) as Record<string, unknown>;
  const sp = (c.style_profile ?? {}) as { palette?: Record<string, string> };
  const pal = sp.palette ?? {};
  const headline = String(content.headline ?? copy.hook ?? product);
  const what = String(content.what_it_does ?? copy.what_it_does ?? c.tagline ?? '');
  const features = (Array.isArray(content.features) ? (content.features as string[]) : []).slice(0, 4);
  return {
    composition: 'balanced vertical editorial flow, oversized hero headline, clear hierarchy',
    mood: 'modern, clean, professional',
    art_style: 'modern editorial graphic design, crisp vector shapes, soft shadows',
    palette_roles: {
      bg: pal.bg || '#ffffff',
      text: pal.text || '#111827',
      primary: pal.primary || '#1f2937',
      accent: pal.accent || '#10b981',
    },
    zones: [
      { band: 'top', role: 'brand row', content: product, emphasis: 'low' },
      { band: 'upper', role: 'hero headline', content: headline, emphasis: 'high' },
      ...(what ? [{ band: 'mid' as const, role: 'supporting product detail', content: what, emphasis: 'med' as const }] : []),
      ...(features.length
        ? [{ band: 'lower' as const, role: 'feature row', content: features.join(' · '), emphasis: 'low' as const }]
        : []),
    ],
  };
}

// Compose the text-to-image prompt for an EVENT promo poster (2:3). The exact
// date/time/location are rendered as REAL text by the SPA (AiPoster band), NOT by
// the image model — so this prompt paints only the ATMOSPHERE + event title + host,
// and (like every style) leaves the bottom ~26% empty for the composited band.
function buildEventPrompt(c: Record<string, unknown>, hasLogo = false): string {
  const spec = (c.poster_spec ?? {}) as {
    title?: string; hook?: string; blurb?: string; host_line?: string;
  } & Record<string, unknown>;
  const essence = String(c.brand_essence ?? '');
  const title = String((spec.title as string) || c.product_name || 'the event');
  const hook = String((c.poster_spec as { hook?: string })?.hook ?? '');
  const hostLine = String(spec.host_line ?? '');
  const sp = (c.style_profile ?? {}) as { palette?: Record<string, string> };
  const primary = sp.palette?.primary || '#1f2937';
  const accent = sp.palette?.accent || '#e8633a';
  const logoLine = hasLogo
    ? '\nA reference image of the host/brand LOGO is provided — reproduce it faithfully (exact shape and colors) in the top brand area; do not redraw or distort it.\n'
    : '';

  return `Create a single PORTRAIT 2:3 EVENT PROMOTION poster — an inviting, high-energy real-world event flyer
(the kind pinned to a bulletin board or shared as a story). Bold, editorial, atmospheric. NOT a product/SaaS mockup,
NOT a web UI.

Honor this event's identity — infuse its palette, mood, and motif; do not invent an unrelated corporate look:
${essence || title}
Use ${primary} as the dominant color and ${accent} as the vivid accent (headline emphasis, shapes, glow). Stay within
this palette plus neutrals. If the brand is monochrome, add tasteful ${accent} accents as the only vivid color.
${logoLine}
CRITICAL: the ONLY words rendered anywhere on the poster are the exact quoted strings below, all in ENGLISH. Do NOT
print any layout/section descriptions, position words, or instruction words as visible text.

Arrange it top to bottom:

- Upper area: the EVENT TITLE as an oversized, bold, celebratory display headline reading "${title}" — the dominant
  visual element, with expressive typography and decorative accents around it.
${hook ? `- Just below the title, a short punchy hook line reading "${hook}".` : ''}
${hostLine ? `- A small host/presenter line reading "${hostLine}".` : ''}
- Middle: rich atmospheric illustration evoking the event's theme and energy (people gathering, venue mood, motifs from
  the brand essence) — make it feel exciting and specific, not generic clip-art.

- CRITICAL FRAMING: FINISH all artwork and text by about 74% of the way down. Leave the BOTTOM ~26% — a full-width
  horizontal strip along the very bottom edge — as completely clean, plain, EMPTY background with nothing in it: no
  text, cards, icons, buttons, QR code, barcode, date, time, address, or decoration. That bottom margin is cropped and
  replaced by a branded footer bar (with the real date/time/location + a scannable QR) afterward, so anything drawn
  there is discarded or clashes. Do NOT paint any date, time, address, or QR code yourself — those are added later as
  crisp real text.

All rendered text must be crisp, correctly spelled, legible, ENGLISH only, and limited to the quoted strings above.
High quality, sharp, 8k, atmospheric event-poster art direction.
Avoid: product/app UI mockups, painted buttons/pills, any QR/barcode drawn by you, any painted date/time/address,
garbled or misspelled text, non-English text, and a busy/cluttered bottom edge.`;
}
