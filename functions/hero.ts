import {
  CORS,
  env,
  aiImage,
  dataUrlToBlob,
  jsonResponse,
  createUserClient,
  compileLayoutPrompt,
  logTrace,
  type PosterLayout,
} from './_shared.ts';

// `hero` renders the poster (2:3) as a single AI image. For the two hardcoded
// styles it builds the prompt from poster_spec + brand_essence (produced by
// analyze) via a fixed template prompt; for the `designer` style it compiles the
// LLM-designed poster_layout (produced by the `designer` agent) into the prompt.
// The image model gets TEXT ONLY, so the brand is described in words. The SPA
// letterboxes this image into the TOP ~81.5% and gives the QR its own branded
// band in the bottom row, so we prompt the model to FINISH all content by ~80%
// down and leave the bottom ~20% as empty margin (the crop line lands there,
// discarding nothing important). Stored in the public assets bucket.
export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResponse({ error: 'method' }, 405);

  const baseUrl = env('INSFORGE_BASE_URL');
  const apiKey = env('API_KEY');
  const client = createUserClient(req);

  const { data: userData } = await client.auth.getCurrentUser();
  if (!userData?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401);
  const userId = userData.user.id;

  let body: { campaignId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad json' }, 400);
  }
  if (!body.campaignId) return jsonResponse({ error: 'missing campaignId' }, 400);

  const { data: campaign, error: cErr } = await client.database
    .from('campaigns')
    .select('id, product_name, tagline, poster_style, style_profile, poster_spec, brand_essence, poster_layout, brand_assets')
    .eq('id', body.campaignId)
    .maybeSingle();
  if (cErr || !campaign) return jsonResponse({ error: 'campaign not found' }, 404);

  const rawStyle = (campaign as Record<string, unknown>).poster_style;
  const style = rawStyle === 'saas_glassmorphism'
    ? 'saas_glassmorphism'
    : rawStyle === 'designer'
      ? 'designer'
      : 'cozy_scrapbook';

  // The real brand logo (if any) is passed to the image model as a reference so
  // it can paint the actual logo into the poster's brand row.
  const assets = ((campaign as Record<string, unknown>).brand_assets ?? {}) as { logo_url?: string };
  const referenceImages = assets.logo_url ? [assets.logo_url] : [];
  const prompt = buildPosterPrompt(campaign as Record<string, unknown>, style, referenceImages.length > 0);

  // The image model emits a native 2:3 portrait regardless of aspect_ratio; we
  // request 2:3 explicitly. The cozy display container crops it 9:16, the SaaS
  // container shows the full 2:3 frame.
  let dataUrl: string;
  try {
    dataUrl = await aiImage(baseUrl, apiKey, prompt, '2:3', referenceImages);
  } catch (e) {
    await logTrace(client, {
      campaignId: campaign.id,
      userId,
      step: 'hero',
      status: 'failed',
      detail: 'AI image generation failed',
      request: { model: Deno.env.get('OPENROUTER_IMAGE_MODEL') ?? 'google/gemini-2.5-flash-image', image: prompt },
      response: { error: e instanceof Error ? e.message : String(e) },
    });
    return jsonResponse({ error: String(e) }, 502);
  }

  let url: string;
  let key: string;
  try {
    const blob = dataUrlToBlob(dataUrl);
    const { data, error } = await client.storage
      .from('assets')
      .upload(`poster/${campaign.id}/${crypto.randomUUID()}.png`, blob);
    if (error || !data) {
      await logTrace(client, {
        campaignId: campaign.id,
        userId,
        step: 'hero',
        status: 'failed',
        detail: 'poster image upload failed',
        request: { image: prompt },
        response: { error: error?.message ?? 'upload failed' },
      });
      return jsonResponse({ error: error?.message ?? 'upload failed' }, 500);
    }
    url = data.url;
    key = data.key;
  } catch (e) {
    await logTrace(client, {
      campaignId: campaign.id,
      userId,
      step: 'hero',
      status: 'failed',
      detail: 'poster image upload threw',
      request: { image: prompt },
      response: { error: e instanceof Error ? e.message : String(e) },
    });
    return jsonResponse({ error: String(e) }, 500);
  }

  // Persist the image. The QR sits in a deterministic SPA-rendered bottom band,
  // so there's no qr_zone to detect or store; any legacy value is left untouched.
  const { error: upErr } = await client.database
    .from('campaigns')
    .update({ hero_image_url: url, hero_image_key: key })
    .eq('id', campaign.id);
  if (upErr) {
    await logTrace(client, {
      campaignId: campaign.id,
      userId,
      step: 'hero',
      status: 'failed',
      detail: 'campaign persist failed after image generation',
      response: { error: upErr.message },
    });
    return jsonResponse({ error: upErr.message }, 500);
  }

  // Return the compiled text-to-image prompt for the generation loading UI.
  return jsonResponse({ poster_image_url: url, prompt: { image: prompt } });
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

// Dispatch to the right prompt based on the campaign's poster_style. For
// `designer`, compile the LLM-designed poster_layout; if it's missing (designer
// step failed / not yet run) fall back to the SaaS template so hero never
// hard-fails.
function buildPosterPrompt(c: Record<string, unknown>, style: string, hasLogo: boolean): string {
  if (style === 'designer') {
    const layout = c.poster_layout as PosterLayout | null;
    if (layout && Array.isArray(layout.zones)) {
      return compileLayoutPrompt(layout, {
        product: String(c.product_name ?? 'the product'),
        essence: String(c.brand_essence ?? ''),
        hasLogo,
      });
    }
    return buildSaasPrompt(c, hasLogo);
  }
  return style === 'saas_glassmorphism' ? buildSaasPrompt(c, hasLogo) : buildCozyPrompt(c, hasLogo);
}

// Compose the full text-to-image prompt for the cozy gamified poster, weaving in
// the campaign's spec and the brand essence so it stays on-brand.
function buildCozyPrompt(c: Record<string, unknown>, hasLogo = false): string {
  const spec = (c.poster_spec ?? {}) as PosterSpec;
  const essence = String(c.brand_essence ?? '');
  const product = String(c.product_name ?? 'the product');
  const sp = (c.style_profile ?? {}) as { palette?: Record<string, string>; tone?: string };
  const primary = sp.palette?.primary || '#5aa469';
  const accent = sp.palette?.accent || '#e8633a';
  const logoLine = hasLogo
    ? '\nA reference image of the brand LOGO is provided — reproduce it faithfully (exact shape and colors) near the title/brand area; do not redraw or distort it.\n'
    : '';

  const statLines = (spec.stat_nodes ?? [])
    .map((s) => `   • ${s.label} (${s.icon}) ${stars(s.stars)}`)
    .join('\n');
  const questLines = (spec.quest_cards ?? [])
    .map((q) => `   • ${q.title} — ${q.desc} (${q.icon} icon)`)
    .join('\n');
  const leftLines = (spec.conv_left?.lines ?? []).map((l) => `     - ${l}`).join('\n');
  const rightSteps = (spec.conv_right?.steps ?? []).map((s, i) => `     ${i + 1}. ${s}`).join('\n');

  return `Create a single PORTRAIT 2:3 product-promotion poster in a warm hand-drawn watercolor + soft ink-linework
"cozy scrapbook journal / gamified life-RPG / cottagecore healing" style. Storybook illustration feel: an aged
kraft/cream paper texture with torn paper edges (NEVER a flat solid or dark background), washi tape, sticky notes,
dotted guide lines, pixel-art widgets, and scattered leaf/flower/heart doodles, small stars, coins and sparkles around
the margins. Warm dark-brown body text (avoid pure black). One cohesive warm pastel palette throughout, one consistent
hand-drawn icon style.

Honor this brand — infuse its palette, logo motif and vibe into the cozy style, do not copy a corporate look:
${essence || product}
Lean the title and accents toward a warm vermilion orange-red and the brand colors ${primary} / ${accent}, kept warm,
soft and hand-painted. IF the brand is black-and-white / monochrome, DO NOT output a monochrome poster — add vivid
decorative color (leaves, washi tape, borders, doodles) in a derived warm complementary accent (sage green, peach,
dusty rose, or golden amber).
${logoLine}
CRITICAL: the ONLY words rendered anywhere on the poster are the exact quoted strings given below, and they must all be
in ENGLISH. Do NOT print any of these layout/section descriptions, position words, or instruction words as visible
text. Render no labels like "status bar", "hero headline", "subtitle", "mascot", "quest cards", "conversion row",
"footer", or "empty background" — those are directions, not content.

Arrange it top to bottom:

- A thin status strip at the very top: on the left a pixel-art calendar icon with a date; on the right a laurel level
  badge reading "${spec.level_badge ?? 'Lv.5'}" and an XP star bar "${spec.xp ?? '★★★★★'}".

- The dominant hero area in the upper third, centered: an oversized hand-painted rounded BRUSH / bold-marker title of
  two lines (the visual hammer), in warm vermilion orange-red, with hand-drawn arrows, hearts and leaf sprigs tucked
  around the words — a punchy "Others have X / You have Y" contrast:
      line 1 reads "${spec.hook_line1 ?? `Others use ${product}.`}"
      line 2 reads "${spec.hook_line2 ?? 'You level up.'}"

- Just below the title, on a washi-tape strip, a subtitle reading "${spec.subtitle ?? product}".

- In the center, one adorable chibi mascot embodying the brand's personality, standing on a small decorative patch —
      ${spec.mascot ?? `a cute creature embodying ${product}`}
  ringed by an arc of soft pastel circular stat nodes (one tint each: green, yellow, pink, blue, peach), each a small
  hand-drawn icon with a label and a 5-star rating shown as filled/empty stars:
${statLines || '   • Easy ★★★★★\n   • Fast ★★★★★'}

- A middle band of exactly ${(spec.quest_cards ?? []).length || 3} torn-paper sticky-note cards in a row, each with
  washi-tape corners and a small hand-drawn icon:
${questLines || '   • Get started — in minutes (spark icon)'}

- A lower conversion band with two torn-paper notes side by side: on the LEFT a note titled
  "${spec.conv_left?.heading ?? `Why ${product}`}":
${leftLines || '     - Save time\n     - Do more'}
  and on the RIGHT a note titled "${spec.conv_right?.heading ?? 'Start in 3 Steps'}":
${rightSteps || '     1. Scan\n     2. Sign up\n     3. Go'}

- CRITICAL FRAMING: FINISH all artwork, text, and the mascot by about 74% of the way down the poster. Leave the BOTTOM
  ~26% — a full-width horizontal strip along the very bottom edge — as completely clean, plain, EMPTY kraft-paper margin
  with absolutely nothing in it: no cards, notes, text, icons, doodles, buttons, QR code, barcode, pixel-grid, or
  decoration of any kind. That bottom margin is cropped off and replaced by a branded footer bar afterward, so anything
  drawn there is discarded or clashes. Keep a comfortable empty gap of plain kraft paper between the last content and
  that bottom margin so the transition reads cleanly. Do NOT place the footer formula, any URL, or a closing tagline in
  that bottom strip.

All hand-lettered text must be crisp, legible, correctly spelled, ENGLISH only, and limited to the quoted strings above.
Quality: warm hand-drawn watercolor, cozy scrapbook journal aesthetic, kraft paper texture, torn paper edges, washi
tape, cute chibi mascot, gamified RPG UI with star-rating stats, soft pastel palette, doodle decorations, storybook
illustration, high quality, 8k.
Avoid: corporate / glassmorphism / SaaS look, neon or high-saturation colors, 3D renders or photoreal imagery, dark
backgrounds, cluttered layout, unreadable or messy text, painted buttons / pills / clickable UI controls (the QR footer
bar is the call-to-action), more than one QR code, any QR/barcode drawn by you, any non-English text, and monochrome output.`;
}

// Compose the text-to-image prompt for the premium SaaS / glassmorphism
// product-launch poster (2:3). Split light-upper / dark-lower, a 3D device on a
// metallic pedestal, frosted floating cards, a feature matrix, a dark
// "why choose" band, and a CTA band with a RESERVED blank panel for the QR.
function buildSaasPrompt(c: Record<string, unknown>, hasLogo = false): string {
  const spec = (c.poster_spec ?? {}) as SaasSpec;
  const essence = String(c.brand_essence ?? '');
  const product = String(c.product_name ?? 'the product');
  const sp = (c.style_profile ?? {}) as { palette?: Record<string, string> };
  const primary = sp.palette?.primary || '#6366f1';
  const accent = sp.palette?.accent || '#ec4899';
  const logoLine = hasLogo
    ? '\nA reference image of the brand LOGO is provided — reproduce it faithfully (exact shape and colors) as the logo mark in the top brand row; do not redraw or distort it.\n'
    : '';

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
product, then reasons, then a closing brand statement. (No "get started" CTA — the QR footer bar is the action.)

Honor this brand — infuse its palette, logo motif and vibe, do not invent an unrelated look:
${essence || product}
Use ${primary} as the brand primary (headline emphasis, highlights, data bars) and ${accent} as the accent / metallic
glow. Stay within one brand color plus neutrals — no rogue colors. If the brand is mono black/white, add tasteful
${accent} accents and a metallic pedestal glow as the only vivid decoration.
${logoLine}
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

- Lower dark zone (around 56-72% down): a large closing brand statement / value prop reading "${spec.cta_main ?? `Built for modern teams`}"
  (key words in ${primary}) with a smaller supporting sub-line reading "${spec.cta_sub ?? ''}". Render it as plain bold
  TEXT — do NOT draw a button or pill, and do NOT phrase it as a "Get started"/"Sign up" call-to-action (the scannable
  QR footer bar composited afterward IS the call-to-action). Center or left-align it within the dark zone, full width.

- CRITICAL FRAMING: FINISH all call-to-action text and artwork by about 74% of the way down the poster. Leave the BOTTOM
  ~26% — a full-width horizontal strip along the very bottom edge — as completely clean, plain, EMPTY dark-charcoal margin
  with absolutely nothing in it: no cards, panels, frames, outlines, text, icons, buttons, QR code, barcode, pixel-grid,
  or decoration. That bottom margin is cropped off and replaced by a branded footer bar afterward, so anything drawn there
  is discarded or clashes. Keep a comfortable empty gap of plain dark background between the last content and that bottom
  margin so the transition reads cleanly. Do NOT place any closing tagline or URL in that bottom strip.

All rendered text must be crisp, correctly spelled and legible, and limited to the quoted strings above. One consistent
thin-line icon style throughout. Frosted glass must read as translucent with soft shadows. High-end SaaS launch
aesthetic, soft studio lighting, 8k, sharp, clean.
Avoid: painted buttons / pills / clickable UI controls (the QR footer bar is the call-to-action), any QR code or barcode
drawn by you, garbled or misspelled text, and a busy/cluttered bottom edge.`;
}
