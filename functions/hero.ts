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
    .select('id, product_name, tagline, poster_style, style_profile, poster_spec, brand_essence')
    .eq('id', body.campaignId)
    .maybeSingle();
  if (cErr || !campaign) return jsonResponse({ error: 'campaign not found' }, 404);

  const style = (campaign as Record<string, unknown>).poster_style === 'saas_glassmorphism'
    ? 'saas_glassmorphism'
    : 'cozy_scrapbook';
  const prompt = buildPosterPrompt(campaign as Record<string, unknown>, style);

  // The image model emits a native 2:3 portrait regardless of aspect_ratio; we
  // request 2:3 explicitly. The cozy display container crops it 9:16, the SaaS
  // container shows the full 2:3 frame.
  let dataUrl: string;
  try {
    dataUrl = await aiImage(baseUrl, apiKey, prompt, '2:3');
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
interface SaasCard { icon: string; title: string; desc: string }
interface SaasSpec {
  headline?: string;
  sub_name?: string;
  slogan?: string;
  product_intro?: string;
  device_context?: string;
  hero_metric?: string;
  float_cards?: SaasCard[];
  feature_matrix?: SaasCard[];
  reasons?: SaasCard[];
  cta_main?: string;
  cta_sub?: string;
  qr_label?: string;
  footer_slogan?: string;
  urls?: string;
}

function stars(n: number): string {
  const f = Math.max(0, Math.min(5, Math.round(n)));
  return '★'.repeat(f) + '☆'.repeat(5 - f);
}

// Dispatch to the right template prompt based on the campaign's poster_style.
function buildPosterPrompt(c: Record<string, unknown>, style: string): string {
  return style === 'saas_glassmorphism' ? buildSaasPrompt(c) : buildCozyPrompt(c);
}

// Compose the full text-to-image prompt for the cozy gamified poster, weaving in
// the campaign's spec and the brand essence so it stays on-brand.
function buildCozyPrompt(c: Record<string, unknown>): string {
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

Honor this brand — infuse its palette, logo motif and vibe into the cozy style, do not copy a corporate look:
${essence || product}
Lean the primary accents toward ${primary} and ${accent}, but keep everything warm, soft and hand-painted.

CRITICAL: the ONLY words rendered anywhere on the poster are the exact quoted strings given below. Do NOT print any of
these layout/section descriptions, position words, or instruction words as visible text. Render no labels like "status
bar", "hero headline", "subtitle", "mascot", "quest cards", "conversion row", "footer", or "empty background" — those
are directions, not content.

Arrange it top to bottom:

- A thin status strip at the very top: on the left a pixel-art calendar icon with a date; on the right a laurel level
  badge reading "${spec.level_badge ?? 'Lv.1'}" and an XP progress bar reading "${spec.xp ?? '0 / 100 XP'}".

- The dominant hero area in the upper third, centered: an oversized hand-painted rounded brush-lettered title of two
  lines, in a warm vermilion orange-red, with hand-drawn arrows/hearts/leaf sprigs tucked around the words —
      line 1 reads "${spec.hook_line1 ?? `Others use ${product}.`}"
      line 2 reads "${spec.hook_line2 ?? 'You level up.'}"

- Just below the title, on a washi-tape strip, a subtitle reading "${spec.subtitle ?? product}".

- In the center, one adorable chibi mascot standing on a little grassy patch —
      ${spec.mascot ?? `a cute creature embodying ${product}`}
  ringed by an arc of soft pastel circular stat nodes (one tint each: green, yellow, pink, blue, peach), each a small
  hand-drawn icon with a label and a 5-star rating shown as filled/empty stars:
${statLines || '   • Easy ★★★★★\n   • Fast ★★★★★'}

- A middle band of exactly ${(spec.quest_cards ?? []).length || 3} torn-paper sticky-note cards in a row, each with
  washi-tape corners and a small hand-drawn icon:
${questLines || '   • Get started — in minutes (spark icon)'}

- A lower band (around 70-84% down): keep the CENTER of this band as completely clean, plain, EMPTY paper background — a
  calm open roughly-square area, about one third of the width, with absolutely nothing in it: no card, no panel, no
  frame, no outline, no box, no sticker, no QR code, no barcode, no pixel-grid, and no text. A real QR sticker is
  composited there afterward, so any drawn shape or label there would clash. To the LEFT of that empty center area, a
  torn-paper note titled "${spec.conv_left?.heading ?? `Why ${product}`}":
${leftLines || '     - Save time\n     - Do more'}
  and to the RIGHT, a torn-paper note titled "${spec.conv_right?.heading ?? 'Start in 3 Steps'}":
${rightSteps || '     1. Scan\n     2. Sign up\n     3. Go'}

- At the very bottom, centered, a formula-style tagline${spec.footer_formula ? ` reading "${spec.footer_formula}"` : ''} framed
  by little doodles${spec.urls ? `, with the url "${spec.urls}" on a small pill` : ''}.

All hand-lettered text must be crisp, legible and correctly spelled, and limited to the quoted strings above. Keep one
consistent hand-drawn icon style and one warm pastel palette throughout. High quality, 8k, storybook watercolor.`;
}

// Compose the text-to-image prompt for the premium SaaS / glassmorphism
// product-launch poster (2:3). Split light-upper / dark-lower, a 3D device on a
// metallic pedestal, frosted floating cards, a feature matrix, a dark
// "why choose" band, and a CTA band with a RESERVED blank panel for the QR.
function buildSaasPrompt(c: Record<string, unknown>): string {
  const spec = (c.poster_spec ?? {}) as SaasSpec;
  const essence = String(c.brand_essence ?? '');
  const product = String(c.product_name ?? 'the product');
  const sp = (c.style_profile ?? {}) as { palette?: Record<string, string> };
  const primary = sp.palette?.primary || '#6366f1';
  const accent = sp.palette?.accent || '#ec4899';

  const floatLines = (spec.float_cards ?? [])
    .map((f) => `     • ${f.title} — ${f.desc} (${f.icon} icon)`)
    .join('\n');
  const featureLines = (spec.feature_matrix ?? [])
    .map((f) => `     • ${f.title}: ${f.desc} (${f.icon} icon)`)
    .join('\n');
  const reasonLines = (spec.reasons ?? [])
    .map((r) => `     • ${r.title}: ${r.desc} (${r.icon} icon)`)
    .join('\n');

  return `Create a single premium portrait 2:3 SaaS product-launch poster — high-end, glassmorphism + editorial-magazine
aesthetic: frosted glass cards with soft long shadows, subtle gradients, a realistic 3D device mockup, crisp thin-line
icons, generous whitespace, professional and trustworthy. Not cartoon, not childish, not cluttered.

The composition is split into two clearly visible zones: the upper ~60% is a light zone (off-white to light-gray
gradient); the lower ~40% is a dark zone (near-black charcoal #0E0E0E). The eye flows top to bottom: brand, then
product, then reasons, then a call to action.

Honor this brand — infuse its palette, logo motif and vibe, do not invent an unrelated look:
${essence || product}
Use ${primary} as the brand primary (headline emphasis, highlights, data bars) and ${accent} as the accent / metallic
glow. Stay within one brand color plus neutrals — no rogue colors. If the brand is mono black/white, add tasteful
${accent} accents and a metallic pedestal glow as the only vivid decoration.

CRITICAL: the ONLY words rendered anywhere on the poster are the exact quoted strings given below. Do NOT print any of
these layout/section descriptions, position words, or instruction words as visible text. Render no labels like "brand
bar", "hero headline", "device", "feature matrix", "cta", "footer", or "empty background" — those are directions, not
content.

Arrange it top to bottom:

- Very top, a thin brand row in the light zone: top-left a small square logo mark beside the brand name "${product}";
  top-right a small laurel ornament beside a short identity tagline.

- Upper-left of the light zone, the dominant hero area: an oversized bold serif display headline reading "${spec.headline ?? product}"
  with the second half in ${primary} as a visual emphasis${spec.sub_name ? `, and a lighter sub-name "${spec.sub_name}" beneath it` : ''}.
  Below it a short ${primary} divider line, then the slogan "${spec.slogan ?? product}", then a 2-3 line product intro:
  "${spec.product_intro ?? ''}".

- Center-right of the light zone, a realistic 3D device (laptop or smartphone) resting on a ${accent} metallic circular
  pedestal with a soft glow halo. The screen shows a clean, credible, readable product UI: ${spec.device_context ?? `the ${product} dashboard`}${spec.hero_metric ? `, with one bold hero metric "${spec.hero_metric}" prominent` : ''}.
  The on-screen UI must look real and sharp — no garbled text, no fake glyphs.

- Around the device, 3 small frosted-glass cards gently overlapping it, each a thin-line icon with a short title and a
  tiny description:
${floatLines || '     • Fast — ships in minutes (bolt icon)'}

- Lower part of the light zone, a tidy 2-column grid under a small heading reading "Core Features", each row a thin-line
  icon with a feature name and a one-line description:
${featureLines || '     • Fast: built for speed (bolt icon)'}

- Top of the dark zone, a heading reading "Why ${product}?" in white, then a row of 4 thin-line icons evenly spaced, each
  with a short title and one line of light-gray text on the dark background:
${reasonLines || '     • Trusted: by modern teams (check icon)'}

- Lower dark zone (around 74-90% down): on the LEFT, a large decisive call-to-action headline reading "${spec.cta_main ?? `Try ${product}`}"
  (key words in ${primary}) with a smaller sub-line reading "${spec.cta_sub ?? ''}". The RIGHT third of this band must be
  left as completely clean, plain, EMPTY dark background — a calm open roughly-square area with absolutely nothing in it:
  no card, no panel, no frame, no outline, no box, no sticker, no QR code, no barcode, no pixel-grid, and no text. A real
  QR sticker is composited there afterward, so any drawn shape or label there would clash. Keep the call-to-action text
  on the left well clear of this empty right-side area so they never overlap.

- Very bottom, centered, a short all-caps letter-spaced tagline${spec.footer_slogan ? ` reading "${spec.footer_slogan}"` : ''}${spec.urls ? `, with "${spec.urls}" on a small pill` : ''}, key words in ${primary}.

All rendered text must be crisp, correctly spelled and legible, and limited to the quoted strings above. One consistent
thin-line icon style throughout. Frosted glass must read as translucent with soft shadows. High-end SaaS launch
aesthetic, soft studio lighting, 8k, sharp, clean.`;
}
