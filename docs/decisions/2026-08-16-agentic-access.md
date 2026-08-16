# Agentic access to Posterlytics: a local read-only MCP server before any key or paid trigger

## Backlog item

**Agentic access to Posterlytics — skill or MCP.** Goal: let an AI agent see and eventually drive a user's campaigns without handing it a credential that bypasses owner-only RLS or can silently spend money. Maintainer note: "Feel like this is a big feature. make sure do careful planning across agents." This record is the deliverable; no feature code ships this tick.

## Verified before designing

Auth and enforcement:
- `functions/_shared.ts:46` `createAnonClient()`, `:55-62` `createUserClient(req)` forwards the caller's `Authorization` bearer as `edgeFunctionToken`, `:64-71` `createAdminGenerationClient()` whose own comment says "used only by scheduled server-side workers".
- Owner-only RLS is intact and uniform: `posterlytics_campaigns_owner` (db/schema.sql:708, `FOR ALL`), `poster_generations_owner_read` (:713), `generation_stage_traces_owner_read` (:724), `posterlytics_placements_owner` (:735), `posterlytics_scans_owner_read` (:740).
- Anon holds exactly three EXECUTE grants: `log_visit_attributed` (:1352), `log_visit` (:1353), `link_status` (:1354). Plus `posterlytics_assets_public_read` (:1369) and `GRANT SELECT ON storage.objects TO anon` (:1399).
- **No api_key / token / service-account / PAT concept exists.** grep of `db/schema.sql` + `src/lib/types.ts` for `api_key|apiKey|personal_access|service_account` = 0 hits. Greenfield.
- The anon key ships in the public SPA bundle (`src/lib/insforge.ts:39`), so any anon-granted RPC is a public internet endpoint. This kills any design where a stored token hash is itself the argument to an anon-granted RPC.

Read surface:
- **There are no views.** `CREATE VIEW` in `db/schema.sql` and `migrations/` = 0 hits. `placement_stats` (:950) and `campaign_breakdowns` (:979) are `LANGUAGE sql STABLE SECURITY DEFINER` filtering `pl.user_id = (SELECT auth.uid())` / `s.user_id = (SELECT auth.uid())`; `generation_activity` (:2046, superseded :4641). The read surface is PostgREST table reads plus `auth.uid()`-bound RPCs — **an admin-client design cannot reuse any of them.**
- `placement_stats` returns `code` in its result signature (:950-956). Any owner-parameterised fork of it leaks placement codes into whatever calls it.

Spend and availability:
- `enqueue_poster_generation(UUID,TEXT,JSONB,BOOLEAN,TEXT,TEXT)` created at :4108 (the 5-arg version was `DROP`ped at :4106), granted to `authenticated` at :4944, derives `v_user_id UUID := auth.uid()` at :4121 and raises `42501` when NULL at :4134. A `project_admin` client therefore **cannot invoke it at all**.
- `v_max_concurrency CONSTANT INTEGER := 2` (:2210) under `pg_advisory_xact_lock(741231, 1)` (:2223) — **global, not per user**. One-active-generation-per-campaign guard at :4200. Total spend is unbounded; burn rate is pinned project-wide at 2 stage runs, which is also a starvation vector.
- `consume_capture_preview_quota()` (:3380, granted :3462) is the quota idiom to copy. It is one shared budget consumed by both `functions/capture-preview.ts` and `functions/amazon-product-lookup.ts`. **There is no generation quota anywhere.**

Irreversibility:
- `GRANT SELECT, DELETE ON public.campaigns TO authenticated` (:752). Column-level grants exist for INSERT/UPDATE only (:753+), never SELECT. So an end-user session can delete campaigns.
- `scans.placement_id … REFERENCES public.placements(id) ON DELETE CASCADE` (:685). Deleting a placement destroys its entire visit history and voids a QR code already printed on paper.

Tooling and repo mechanics:
- `package.json:13` — `lint` is `tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.node.json --noEmit`. `tsconfig.json` references only those two. **Adding a project reference does not get a new directory type-checked; the lint script itself must change.**
- `package.json:14` — `test` globs `tests/*.test.ts` with the `tests/register.mjs` TS-extension loader, so new pure tests are picked up automatically.
- `functions/build.mjs:17` discovers slugs as `.ts` files not starting with `_`; `_`-prefixed modules are bundle-only. That is the established pure-seam idiom.
- `src/lib/viewUrl.ts` imports `FUNCTIONS_HOST` from `./insforge`, which evaluates `import.meta.env.VITE_INSFORGE_URL` and constructs a client at module scope (`src/lib/insforge.ts:8`, `:37-49`). **`buildViewUrl` is not importable from plain Node.** `src/lib/codes.ts` `mintCode` uses global `crypto` and is Node-safe.
- `@insforge/sdk/dist/index.mjs` contains `isServerMode` (22 occurrences). It is absent from `SDK-REFERENCE.md` and from `dist/index.d.mts`; there is no `deprecated` marker in the `.d.mts`. The headless sign-in path is real but **undocumented**, therefore unstable.
- `src/components/PosterExportButton.tsx:2` imports `toPng` from `html-to-image`. **The only renderer of a composited print sheet is the browser DOM.** There is no server-side renderer.
- `.gitignore` ignores `.claude`, `.agent`, `.agents`, and `.mcp.json`. Neither a skill nor an MCP client config can simultaneously sit where the tools auto-discover it and be version-controlled.
- `src/pages/` has no `SettingsPage.tsx` and there is no settings route. Any key-management UI is a new page plus route plus nav, not "a panel".
- `docs/decisions/` has zero records on public API, MCP, agent access, or API keys.

## Decisions

1. **Shape: a local stdio MCP server, in-repo, unpublished.** New workspace directory `mcp/` (bin `posterlytics-mcp`), spawned by the MCP client on the user's machine. Not npm-published, not remote, not hosted.
2. **Ship one committed `SKILL.md` alongside it that only points Claude Code at the same server.** Source of truth at `agent/skills/posterlytics/SKILL.md` plus an `npm run agent:install` symlink step, because `.claude` and `.mcp.json` are gitignored. This resolves skill-vs-MCP without maintaining two surfaces: the tool list is the contract, the skill is a pointer.
3. **v1 auth: a genuine InsForge end-user session. Zero backend change.** `posterlytics-mcp login` is run once by the human on a TTY, prompts for email/password, calls `createClient({ baseUrl, anonKey, isServerMode: true }).auth.signInWithPassword(...)`, and writes `~/.posterlytics/credentials.json` at mode 0600 containing only `{ baseUrl, userId, email, refreshToken }`. The password is never accepted on argv, never read from env, never written. The server refuses to start on a group- or world-readable file. On startup it calls `refreshSession`, persists the rotated refresh token via write-temp-then-rename, and builds requests as `createClient({ baseUrl, anonKey, edgeFunctionToken: <jwt> })`. On 401/`AUTH_TOKEN_EXPIRED`: refresh once, retry once, then return a tool error telling the user to re-run `login`.
4. **The credential must be the maintainer's own account.** A "dedicated agent account" is not available: RLS is strictly `user_id = auth.uid()` with no sharing or team table, so a separate account sees zero rows. Blast radius of the v1 credential is therefore the full account, including `DELETE ON public.campaigns`.
5. **Startup assertion:** the server calls `auth.getCurrentUser()` and refuses to serve unless it returns a real user id. `edgeFunctionToken` is polymorphic — `createAdminClient` sets the same field to a project API key — so one mix-up would silently escalate to RLS-bypassing project admin.
6. **v1 tool list is read-only, six tools:** `whoami`, `list_campaigns`, `get_campaign`, `list_poster_versions`, `get_campaign_analytics`, `get_generation_activity`. Every table read uses an explicit column allowlist in a tested pure constant; never `select('*')`.
7. **Two tools are permanently excluded, not deferred:** `delete_placement` (cascades `scans`, voids printed QR codes) and `delete_campaign` (cascades everything). The credential can do both; the tool list is the only thing that won't. That is a convention, not a boundary — recorded as such.
8. **Model-authored and scraped-derived fields are labelled untrusted in tool output.** `analyze` has an LLM author `poster_content` / `style_profile` / `product_name` from third-party pages and persists them, so those fields are an injection channel into an agent that has shell access. `include: ['copy','style']` is opt-in for that reason, not only for context size.
9. **Reuse the SPA's pure policy modules; do not restate rules.** Import `src/lib/posterSize.ts`, `src/lib/codes.ts`, `src/lib/useCases.ts`, `src/lib/sourceUrls.ts`, `src/lib/generationActivity.ts`, `src/lib/types.ts`. Refactor `buildViewUrl` to take an explicit host so `mcp/` and the SPA share one QR-URL builder; **do not re-derive the functions host in `mcp/`** (docs/decisions/2026-07-31-configurable-functions-host.md).
10. **Wire `mcp/` into lint and add `mcp/build.mjs`.** Add a third `tsc -p mcp/tsconfig.json --noEmit` to the `lint` script — a project reference alone does nothing. Add an esbuild bundler mirroring `functions/build.mjs`, because extensionless `../src/lib/*` imports do not resolve at runtime in plain Node. Add `mcp/` to `.vercelignore`.
11. **A source-grep guard test is part of slice 1**, in the style of `tests/generationWorkerPolicy.test.ts`: no file under `mcp/` may match `createAdminClient|API_KEY|\.insforge/project\.json|JWT_SECRET|uak_`, and no v1 tool file may match `\.insert\(|\.update\(|\.delete\(|rpc\('enqueue`. Read-only is CI-enforced, not documented.
12. **Write path is sequenced, not bundled.** Slice 2: `create_placement` only (insert + `mintCode()` + retry-once on collision, free, no migration), with the two `23514` guard-trigger errors mapped to plain sentences. Slice 3: revocable keys. Slice 4: paid generation, gated.
13. **A per-user generation quota is a HARD PREREQUISITE for exposing any paid trigger — and it is not sufficient alone.** Three items must all land first:
    - `consume_generation_quota()` per-user daily cap modelled on `consume_capture_preview_quota` (db/schema.sql:3380-3462), called **inside** `enqueue_poster_generation` so the SPA is capped too. Implement by extracting `enqueue_poster_generation_impl(p_user_id UUID, …)` granted to `project_admin` and rewriting the `authenticated` signature as a one-line `auth.uid()` wrapper. **Do not add a caller-supplied user id to the `authenticated`-granted function.**
    - `generation_jobs.origin` attribution so agent-originated runs are distinguishable.
    - An origin-aware reservation inside `claim_generation_jobs` keeping at least one of the two global slots for non-agent work. The wallet hole and the availability hole are separate; a quota fixes only the wallet.
14. **v2 credential (slice 3): a `agent_api_keys` row exchanged for a short-lived user JWT.** Table stores `HMAC-SHA256(pepper, token)` with an edge-held `AGENT_TOKEN_PEPPER`, not bare SHA-256. The plaintext is generated **server-side in an edge function** and returned once; the client never supplies the hash or the digest. `REVOKE ALL` + no policy + no table grant (the `capture_preview_attempts` idiom). `scopes TEXT[]` with a value CHECK from day one. `campaign_id` nullable from day one. Resolution happens only inside SECURITY DEFINER functions reachable from the exchange function; **no data RPC is ever granted to `anon` keyed on the stored digest.** Per-key request ledger in the capture-quota shape. Before writing this: verify in a throwaway deployed function that a signing secret actually reaches `Deno.env`, and verify that a non-JWT `Authorization: Bearer` survives to the function body.
15. **Vision item reconciliation.** "Public API for programmatic campaign creation": slice 3 **subsumes its auth half** — do not build a second key table — and the HTTP surface, versioned URLs, and webhooks are **deferred**. "Read-only share links — poster & analytics": **deferred, not subsumed** — unauthenticated per-resource capability URLs belong in the `log_visit`/`link_status` anon family, a different threat model; the nullable `campaign_id` keeps a shared spine possible without promising it. "Per-user generation quota (daily cap)": **promoted** from Vision to a blocking prerequisite of slice 4.
16. **Remote Streamable-HTTP MCP with OAuth 2.1, hosted, multi-user: out of scope.** Separate project; it also requires the slice-3 key model as a prerequisite since there is no stdio env to read a credential from.
17. **No npm publish, no documented login for third parties, until slices 3 and 4 both land.** v1 is explicitly a local single-operator tool.

## Reasoning

**Why the local MCP server won.** Both finalists tied on aggregate score and both need the same credential in v1, so the tie broke on two things. First, capability restriction beats instruction: with an MCP server the enumerated tool list is the only surface the model is offered, whereas a skill driving the SDK directly puts `rpc('enqueue_poster_generation')` and `DELETE ON campaigns` one line away from a model reading prose that says "don't". For a surface that can spend real money and irreversibly cascade-delete printed QR codes, an allowlist that physically omits the verb is worth more than a SKILL.md rule. Second, MCP is the only shape a non-Claude, out-of-repo agent can consume, and it is the shape the board item names.

**Why the skill did not lose entirely.** Three of its ideas are grafted: the source-grep guard test as a CI-enforced auth boundary; importing the SPA's pure policy modules instead of restating rules; and the finding that a "dedicated agent account" is impossible under this RLS model. And the strongest objection against MCP — that the maintainer's in-repo coding agent can already run `npx @insforge/cli db query` as `project_admin`, so six read tools are a capability *reduction* — is answered by decision 2 rather than dismissed: the committed `SKILL.md` costs ~15 lines and points the in-repo agent at the same tool list, so the narrower owner-scoped path is the ergonomic one without a second codebase.

**Why the read-only HTTP token API lost despite the best architectural fit.** Its own hashing scheme defeats it: with the data RPC granted to `anon` and the anon key published in the SPA bundle, the stored `token_hash` *is* a directly replayable bearer credential, the edge function stops being a chokepoint, and its transport rule, uniform 401, and rate limit all become client-side convention. Its genuinely good ideas are grafted into decision 14 — hashed revocable rows, expiry, `last_used_at`, `scopes TEXT[]`, nullable `campaign_id` as the shared spine for share links, and the per-key ledger — with server-side minting, an HMAC pepper, and no anon grant fixing the defect. It also front-loaded six SECURITY DEFINER functions (three with no caller) and deferred the one hard discovery, the `auth.uid()`-bound analytics functions, to slice 2.

**Why the full public HTTP API lost.** It scored lowest and its ordering is backwards for this project: it puts the RLS-bypassing `project_admin` key onto an internet-exposed handler, freezes a `v1` projection over a schema that changed 24 times in five weeks, and delivers zero agentic access until its fourth slice. Two of its ideas are load-bearing here and are grafted whole: the `enqueue_poster_generation_impl` extraction with a one-line `auth.uid()` wrapper (zero duplication of ~200 lines of validation, append-only-compatible), and putting the cap inside `enqueue` so the SPA is capped too — the money risk is not agent-specific.

**Why owner-only RLS is genuinely preserved in v1, stated precisely.** The bearer is a real InsForge session JWT with `sub` = the user's own id and `role: 'authenticated'`. Postgres runs every statement as `authenticated` with `auth.uid()` = that user, so every policy at db/schema.sql:708-742, the column-level INSERT/UPDATE grants, and the `auth.uid()` filters inside `placement_stats`, `campaign_breakdowns`, and `generation_activity` apply byte-for-byte identically to the SPA. The server holds no project API key, forges no claim, adds no policy, adds no grant, and introduces no second enforcement path. That is why the alternative — an admin client plus hand-written `.eq('user_id', …)` filters — was rejected on two grounds, the second decisive: it relocates enforcement into TypeScript that no tsconfig in this repo checks, and it cannot call the `auth.uid()`-gated RPCs at all without a permanent `_for_agent(p_owner)` fork of each.

**Why a long-lived forged JWT was rejected outright.** The JWT is stateless and there is no session table in `db/schema.sql`, so the only revocation is rotating `JWT_SECRET`, which signs out every user. That single constraint is why the durable credential in decision 14 is a database row checked server-side per request, not a token.

## First slice

**Slice 1 — read-only stdio MCP server. One sitting. No migration, no edge-function deploy, no new secret, no spend path, no npm publish.** Reversible by deleting a directory and one password change.

Exact next implementation step, in order:

1. `mcp/package.json` (bin `posterlytics-mcp`; deps `@modelcontextprotocol/sdk`, `@insforge/sdk`), `mcp/tsconfig.json`, `mcp/build.mjs` (esbuild, mirroring `functions/build.mjs`). Add `tsc -p mcp/tsconfig.json --noEmit` to the `lint` script in `package.json:13`. Add `mcp/` to `.vercelignore`.
2. `mcp/lib/credentials.ts` (parse, 0600 permission check, atomic rotation write), `mcp/lib/session.ts` (refresh-on-start, refresh-once/retry-once, `getCurrentUser()` startup assertion), `mcp/lib/columns.ts` (the read allowlists), `mcp/lib/toolOutput.ts` (row → output mappers, untrusted-field labelling). All pure or thinly wrapped, all unit-testable.
3. Parameterise `buildViewUrl` on host in `src/lib/viewUrl.ts` so `mcp/` and the SPA share it. This is the only `src/` change in slice 1.
4. `mcp/login.ts` (TTY prompt, server-mode `signInWithPassword`, 0600 write) and `mcp/server.ts` (transport wiring only). One file per tool under `mcp/tools/`.
5. Tests under the existing `node --test` glob: `tests/mcpCredentials.test.ts`, `tests/mcpColumns.test.ts`, `tests/mcpToolOutput.test.ts`, `tests/mcpViewUrl.test.ts`, and `tests/mcpPolicy.test.ts` (the decision-11 source grep). Verify with `npm test && npm run lint`.
6. `agent/skills/posterlytics/SKILL.md` + `npm run agent:install`, and a README section with an `.mcp.json` snippet (noting `.mcp.json` is gitignored).
7. Measure the refresh-token TTL once against the live backend and write the number into the README instead of guessing.

Known slice-1 traps: stray `console.log` on stdout breaks JSON-RPC framing (all logging must go to stderr); two concurrent MCP clients each refreshing the same credentials file will contend on rotation; and `isServerMode` is undocumented, with a ~20-line `fetch` fallback against `/api/auth/sessions?client_type=mobile` and `/api/auth/refresh?client_type=mobile` if it disappears.

## Follow-ups

- **Slice 2 — `create_placement`** (~1h). Free, no migration. Blocked on nothing.
- **Slice 3 — `agent_api_keys` + server-side minting + exchange function + key-management UI** (2-3 sittings, and the UI is a whole new settings page and route, not a panel). This is the auth half of the Public API Vision item. Blocked on two verification probes: that a signing secret reaches `Deno.env` in a deployed function, and that a non-JWT `Authorization: Bearer` survives to the handler.
- **Slice 4 — any agent-triggerable paid generation.** Hard-gated on all three parts of decision 13. Until then no `generate_poster`, no `retry_generation`, no `publish_campaign`.
- **Deferred: `update_campaign`.** `use_case` / `poster_format` writes cross six CHECK constraints and two triggers, and `functions/_useCasePolicy.ts` is already a second encoding of `src/lib/useCases.ts`; a third consumer is the dominant long-term maintenance cost of this surface.
- **Deferred: the HTTP surface of the Public API Vision item** (versioned URLs, webhooks, OpenAPI, non-agent consumers). Auth first; do not build a second key table.
- **Deferred, not subsumed: "Read-only share links — poster & analytics."** Unauthenticated anon capability URLs, different threat model.
- **Out of scope: remote hosted MCP, OAuth 2.1, multi-user, mobile.**

### Maintainer decisions required (not engineering calls)

1. **Is storing your own account's refresh token on disk acceptable for slice 1**, given the blast radius is the full account including `DELETE ON public.campaigns` and irreversible `scans` cascade? The alternative is to skip slice 1 and wait for slice 3's revocable keys, which costs 2-3 sittings before anything is usable.
2. **Should an agent ever be allowed to spend money here, and what is the number?** If the answer is no, slices 3-4 shrink dramatically and read-only becomes the permanent design.
3. **Does the unattended hourly feedback loop get this credential?** Unattended plus spend is the worst combination on the board; recommend no, permanently.
4. **Publish to npm / expose to anyone but you?** Default is no. Reversing that means owning abuse, rate limits, and a real support surface on a personal demo project.
5. **Is read-only-forever acceptable** if the quota work never gets scheduled? If not, schedule the quota item now rather than pulling writes into an earlier slice.

### What this design does NOT solve

- **No print-ready output.** The composited sheet exists only as browser DOM captured by `html-to-image` (`PosterExportButton.tsx:2`); there is no server-side renderer. An agent gets `hero_image_url` (raw artwork) and a `view_url`, never the A4 file a user would print. Every "give me the file for the printer" workflow dead-ends in the browser. Fixing it means a real headless renderer — the capture-service container is the natural host — and that is a bigger project than this board item.
- **The tool list is not a security boundary in v1.** Anyone who reads the credentials file ignores it and drives the SDK directly. Slice 3's scopes are better but stay advisory until a `posterlytics_agent_readonly` Postgres role carries them in the `role` claim. Do not describe either version as "read-only access" in user-facing copy.
- **Prompt injection is mitigated, not solved.** Read-only tools plus untrusted-field labelling plus opt-in `copy`/`style` reduce the channel; they do not close it while the agent holds a full-account credential and shell access.
- **No streaming, no realtime.** Generation is a multi-minute queued pipeline and the realtime channel policy is authenticated-only, so agents poll `get_generation_activity`. Worse UX and more load than the SPA's subscribe path.
- **Single user, single machine, zero server-side observability.** No Claude web or mobile connector, nothing shareable with a teammate, no server-side record of what an agent did. Slice 3's exchange function is the first point where agent activity becomes observable.
- **v1 revocation is coarse.** Password change or global sign-out, which logs the human out too. The refresh-token TTL is not written down anywhere in this repo.
- **Revoking anything does not unpublish a poster.** Generated assets are anon-readable in Storage (db/schema.sql:1369, :1399), so an image URL already read stays public forever. Any future revocation UI must say so.
- **Queue fairness stays broken until decision 13c ships.** A per-user quota bounds the wallet; the global two-slot cap means one looping agent still starves every human user's queue while staying inside its own budget.
