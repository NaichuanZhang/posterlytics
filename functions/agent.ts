import { CORS, env, createUserClient, jsonResponse } from './_shared.ts';
import { createOpenRouter } from 'npm:@openrouter/ai-sdk-provider@2.9.0';
import { generateText, tool, stepCountIs } from 'npm:ai@^6';
import { z } from 'npm:zod@^3';

// `agent` is the Campaign Optimizer — a multi-step tool-calling agent (Vercel AI
// SDK + OpenRouter). Authenticated. For an owned campaign it can:
//   - read live per-placement stats (placement_stats RPC)
//   - read the current poster/landing copy + style
//   - propose improved copy with a rationale
// It does NOT write — the SPA shows the proposal and the user clicks Apply.
//
// Each tool's `execute` uses the user-scoped InsForge client, so owner RLS holds
// even inside the agent loop. The OpenRouter key stays server-side (a secret).
export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResponse({ error: 'method' }, 405);

  const client = createUserClient(req);
  const { data: userData } = await client.auth.getCurrentUser();
  if (!userData?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: { campaignId?: string; goal?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad json' }, 400);
  }
  if (!body.campaignId) return jsonResponse({ error: 'missing campaignId' }, 400);

  // Confirm ownership / existence up front (owner RLS).
  const { data: campaign, error: cErr } = await client.database
    .from('campaigns')
    .select('id, product_name, tagline, cta_text, poster_copy, landing_content, style_profile')
    .eq('id', body.campaignId)
    .maybeSingle();
  if (cErr || !campaign) return jsonResponse({ error: 'campaign not found' }, 404);

  const campaignId = campaign.id as string;
  const openrouter = createOpenRouter({ apiKey: env('OPENROUTER_API_KEY'), appName: 'Posterlytics' });

  // The proposal the agent fills in via the propose_copy tool (captured here so
  // we can return the validated object to the SPA).
  let proposal: unknown = null;

  const tools = {
    get_placement_stats: tool({
      description:
        'Get live per-placement analytics for this campaign: scans, unique visitors, conversions, and conversion rate. Use this to find which placements convert best and worst.',
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await client.database.rpc('placement_stats', {
          p_campaign_id: campaignId,
        });
        if (error) return { error: error.message };
        return { placements: data ?? [] };
      },
    }),
    get_current_copy: tool({
      description:
        'Get the current poster copy, landing-page content, and brand style profile for this campaign.',
      inputSchema: z.object({}),
      execute: async () => ({
        product_name: campaign.product_name,
        tagline: campaign.tagline,
        cta_text: campaign.cta_text,
        poster_copy: campaign.poster_copy,
        landing_content: campaign.landing_content,
        style_profile: campaign.style_profile,
      }),
    }),
    propose_copy: tool({
      description:
        'Propose improved poster copy and landing content. Call this once you have analyzed the stats and current copy. Keep the brand tone; make the poster punchier and the landing clearer. This does NOT publish — it returns a proposal for the user to review.',
      inputSchema: z.object({
        rationale: z.string().describe('Short explanation of what you changed and why, citing the stats.'),
        poster_copy: z.object({
          hook: z.string().describe('<= 6 word punchy headline'),
          what_it_does: z.string().describe('one sentence'),
          features: z.array(z.string()).describe('exactly 3 short benefit phrases'),
          cta: z.string().describe('<= 3 words'),
        }),
        landing_content: z.object({
          headline: z.string(),
          what_it_does: z.string(),
          how_it_works: z.array(z.string()),
          why_use_it: z.array(z.string()),
          features: z.array(z.string()),
          cta: z.string(),
        }),
      }),
      execute: async (input) => {
        proposal = input;
        return { accepted: true, note: 'Proposal recorded; the user will review and apply.' };
      },
    }),
  };

  const system =
    'You are a senior growth marketer optimizing a product advertising campaign. ' +
    'Workflow: (1) call get_placement_stats to see which placements convert; ' +
    '(2) call get_current_copy to read the existing copy and brand style; ' +
    '(3) call propose_copy ONCE with improved, on-brand poster + landing copy and a rationale that cites the stats. ' +
    'Keep the brand tone. Be concrete. If there is little/no scan data yet, optimize for clarity and persuasion ' +
    'and say so in the rationale. After proposing, reply with a 1-2 sentence summary of your recommendation.';
  const goal = body.goal?.trim() || 'Improve this campaign\'s conversion rate.';

  try {
    const result = await generateText({
      model: openrouter('openai/gpt-4o'),
      stopWhen: stepCountIs(6),
      tools,
      system,
      prompt: `Campaign id: ${campaignId}. Goal: ${goal}`,
    });

    // In AI SDK v6, tool calls are surfaced per-step; aggregate the names.
    const toolNames = (result.steps ?? []).flatMap((s: { toolCalls?: Array<{ toolName: string }> }) =>
      (s.toolCalls ?? []).map((t) => t.toolName),
    );
    return jsonResponse({
      summary: result.text,
      proposal,
      toolCalls: [...new Set(toolNames)],
      steps: result.steps?.length ?? 0,
    });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 502);
  }
}
