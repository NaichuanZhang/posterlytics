import {
  CORS,
  env,
  aiImage,
  dataUrlToBlob,
  jsonResponse,
  createUserClient,
} from './_shared.ts';

// `hero` renders the full gamified "cozy scrapbook" poster (9:16) as a single
// AI image, from the campaign's poster_spec + brand_essence (produced by
// analyze). The image model gets TEXT ONLY, so the brand is described in words.
// A calm light zone is reserved lower-center; we forbid drawing any QR there and
// overlay the real per-placement QR in the SPA. Stored in the public assets bucket.
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
    .select('id, product_name, tagline, style_profile, poster_spec, brand_essence')
    .eq('id', body.campaignId)
    .maybeSingle();
  if (cErr || !campaign) return jsonResponse({ error: 'campaign not found' }, 404);

  const prompt = buildPosterPrompt(campaign as Record<string, unknown>);

  let dataUrl: string;
  try {
    dataUrl = await aiImage(baseUrl, apiKey, prompt, '9:16');
  } catch (e) {
    return jsonResponse({ error: String(e) }, 502);
  }

  let url: string;
  let key: string;
  try {
    const blob = dataUrlToBlob(dataUrl);
    const { data, error } = await client.storage
      .from('assets')
      .upload(`poster/${campaign.id}/${crypto.randomUUID()}.png`, blob);
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

  return jsonResponse({ poster_image_url: url });
}

interface StatNode { icon: string; label: string; stars: number }
interface QuestCard { icon: string; title: string; desc: string }
interface PosterSpec {
  hook_line1?: string;
  hook_line2?: string;
  subtitle?: string;
  level_badge?: string;
  xp?: string;
  mascot?: string;
  stat_nodes?: StatNode[];
  quest_cards?: QuestCard[];
  conv_left?: { heading?: string; lines?: string[] };
  conv_right?: { heading?: string; steps?: string[] };
  qr_label?: string;
  footer_formula?: string;
  urls?: string;
}

function stars(n: number): string {
  const f = Math.max(0, Math.min(5, Math.round(n)));
  return '★'.repeat(f) + '☆'.repeat(5 - f);
}

// Compose the full text-to-image prompt for the cozy gamified poster, weaving in
// the campaign's spec and the brand essence so it stays on-brand.
function buildPosterPrompt(c: Record<string, unknown>): string {
  const spec = (c.poster_spec ?? {}) as PosterSpec;
  const essence = String(c.brand_essence ?? '');
  const product = String(c.product_name ?? 'the product');
  const sp = (c.style_profile ?? {}) as { palette?: Record<string, string>; tone?: string };
  const primary = sp.palette?.primary || '#5aa469';
  const accent = sp.palette?.accent || '#e8633a';

  const statLines = (spec.stat_nodes ?? [])
    .map((s) => `   • ${s.label} (${s.icon}) ${stars(s.stars)}`)
    .join('\n');
  const questLines = (spec.quest_cards ?? [])
    .map((q) => `   • ${q.title} — ${q.desc} (${q.icon} icon)`)
    .join('\n');
  const leftLines = (spec.conv_left?.lines ?? []).map((l) => `     - ${l}`).join('\n');
  const rightSteps = (spec.conv_right?.steps ?? []).map((s, i) => `     ${i + 1}. ${s}`).join('\n');

  return `Create a single vivid PORTRAIT 9:16 marketing poster in a warm hand-drawn watercolor + soft ink-linework
"cozy scrapbook journal / gamified life-RPG" style. Storybook illustration feel, aged kraft/cream paper texture with
torn paper edges, washi tape, sticky notes, dotted guide lines, scattered leaf/flower/heart doodles, small stars,
sparkles and coins around the margins. Warm dark-brown body text (never pure black). One cohesive warm pastel palette.

BRAND TO HONOR (infuse the palette, logo motif and vibe into the cozy style, do NOT copy a corporate look):
${essence || product}
Lean the primary accents toward ${primary} and ${accent}, but keep everything warm, soft and hand-painted.

Lay the poster out top-to-bottom in this exact structure:

1) STATUS BAR (very top, thin): left = a pixel-art calendar icon with a date; right = a laurel level badge
   "${spec.level_badge ?? 'Lv.1'}" and an XP progress bar reading "${spec.xp ?? '0 / 100 XP'}".

2) HERO HEADLINE (upper third, centered, DOMINANT): an oversized hand-painted rounded BRUSH-lettered title, two lines,
   in a warm vermilion orange-red, with hand-drawn arrows/hearts/leaf sprigs tucked around the words:
      Line 1: "${spec.hook_line1 ?? `Others use ${product}.`}"
      Line 2: "${spec.hook_line2 ?? 'You level up.'}"

3) SUBTITLE on a washi-tape strip right below the title:
      "${spec.subtitle ?? product}"

4) MASCOT & STAT RING (center): one adorable chibi mascot standing on a little grassy patch —
      ${spec.mascot ?? `a cute creature embodying ${product}`}
   ringed by an arc of soft pastel circular stat nodes (one tint each: green, yellow, pink, blue, peach), each a small
   hand-drawn icon + label + a 5-star rating shown as filled/empty stars:
${statLines || '   • Easy ★★★★★\n   • Fast ★★★★★'}

5) QUEST CARDS (middle band): exactly ${(spec.quest_cards ?? []).length || 3} torn-paper sticky-note cards in a row,
   each with washi-tape corners and a small hand-drawn icon:
${questLines || '   • Get started — in minutes (spark icon)'}

6) CONVERSION ROW (lower band): a calm, mostly-empty light cream paper panel CENTERED here — leave it clean and
   uncluttered as blank space for a sticker to be added later. DO NOT draw any QR code, barcode, scan square, or
   pixel-grid in this area; just a small hand-lettered caption beneath it reading "${spec.qr_label ?? 'Scan to Start'}".
   To the LEFT of that empty panel, a torn-paper note titled "${spec.conv_left?.heading ?? `Why ${product}`}":
${leftLines || '     - Save time\n     - Do more'}
   To the RIGHT, a torn-paper note titled "${spec.conv_right?.heading ?? 'Start in 3 Steps'}":
${rightSteps || '     1. Scan\n     2. Sign up\n     3. Go'}

7) FOOTER (very bottom, centered): a formula-style tagline${spec.footer_formula ? ` "${spec.footer_formula}"` : ''} framed
   by little doodles${spec.urls ? `, with the url "${spec.urls}" on a small pill` : ''}.

All hand-lettered text must be crisp, legible and correctly spelled. Keep one consistent hand-drawn icon style and one
warm pastel palette throughout. High quality, 8k, storybook watercolor.`;
}
