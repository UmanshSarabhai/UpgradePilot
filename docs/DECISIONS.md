# Architecture decisions

Each entry gives the decision, the reason, and what we gave up. Newest last.

## ADR-001: npm workspaces with three packages

**Decision.** One repo with npm workspaces: `apps/api`, `apps/web`, `packages/shared`. No Turborepo, Nx or pnpm.

**Why.** The API and the UI share request and response schemas. A shared package is the smallest way to share them with type safety. npm workspaces ship with npm, so there is nothing extra to install or learn.

**Trade-off.** No task caching or affected-only builds. With two apps that cost is negligible.

## ADR-002: One Worker serves the API and the static frontend

**Decision.** Next.js builds as a static export (`output: "export"`). The API Worker serves it through Workers static assets and handles `/api/*` itself. Dynamic pages use query strings (`/scan?id=…`) because a static export cannot pre-render unknown IDs.

**Why.** Static asset requests are free and unlimited. All data loads client-side through TanStack Query, so server rendering adds nothing. Running Next.js on Workers through OpenNext would spend the 10 ms CPU budget on rendering. One Worker also means one origin and no CORS.

**Trade-off.** No server components that fetch data and no middleware. URLs carry IDs as query parameters.

## ADR-003: Scan orchestration with Queues and D1 checkpoints

**Decision.** A scan is a state machine stored in D1. A queue message means "advance scan X by one step". Each step takes a lease on the scan row, does a bounded batch of work, commits results and the next checkpoint in one D1 batch, then enqueues the next step. A cron sweep every 5 minutes re-enqueues scans whose lease expired.

**Why.**
- A Free invocation allows 50 subrequests and 10 ms CPU. A 150-dependency scan needs several hundred fetches, so it must span many invocations. Each queue delivery is a new invocation with a fresh budget.
- `ctx.waitUntil` stops shortly after the response and is not a job runner.
- Workflows would fit the shape, but on Free it lists 50 subrequests per instance and 3,000 steps per day. Both are too tight for this load, and the per-instance wording is ambiguous.
- Queues on Free allow 10,000 operations a day. That covers dozens of scans.

**Trade-off.** We write our own lease and checkpoint logic, roughly 150 lines. The business logic stays independent of the queue, so swapping to Workflows later only touches the runner.

## ADR-004: Cheap lockfile reading

**Decision.**
- `package-lock.json`: native `JSON.parse`, with lookups checked lazily instead of validating the whole file with Zod.
- `pnpm-lock.yaml`: parse only the text before the `packages:` or `snapshots:` section with the `yaml` library. Installed versions for each importer sit in that top part.
- `yarn.lock`: one line scanner for both classic and Berry formats. It reads the entry keys and the `version` line and nothing else.

**Why.** Full YAML parsing of a multi-megabyte lockfile can exceed the 10 ms CPU limit. We only need "which version is installed for this name and spec".

**Trade-off.** We cannot answer questions about transitive dependencies. Those are out of scope for the MVP.

## ADR-005: Never guess installed versions

**Decision.** The installed version comes from a lockfile, or from an exact pin such as `"1.2.3"` when there is no lockfile. Anything else is `null` with a reason code. The lockfile wins even when its version is outside the declared range. Overrides cause that (seen live in TanStack/query, where pnpm `overrides` force `@types/react` 19 over a declared `^18`), and the lockfile is what actually installs. Later stages flag the mismatch from the stored range and version.

**Why.** A range like `^4.0.0` says nothing certain about what is installed. A wrong current version produces a wrong upgrade type and a wrong risk rating.

**Trade-off.** Repos without lockfiles show more unresolved rows. Phase 2 can still compare the declared range with the registry ("latest in range" vs "latest"), and the report says which comparison it used.

## ADR-006: Which manifests to read

**Decision.** The root `package.json` plus declared workspaces (`workspaces` field or `pnpm-workspace.yaml`). Without workspaces: the root plus manifests one folder deep, skipping `examples`, `test`, `fixtures`, `docs` and similar. Capped at 20, with skipped paths reported.

**Why.** Large repos have hundreds of `package.json` files in fixtures and examples. Declared workspaces are the owner's own statement of what the project is. The cap keeps discovery under the subrequest limit.

**Trade-off.** A real package outside the declared workspaces is missed. The report lists the skipped paths so nothing is hidden.

## ADR-007: npm cache and AI results in D1 (revised in Phases 2 and 3)

**Decision.** Reduced npm data (dist-tags, one version's manifest, version lists) goes in a D1 table, `registry_cache`, with an expiry column. AI results are reused from `upgrade_analyses` by `input_hash` (Phase 3 change: KV was the plan, but the table already stores the hash with an index, so KV would only add a binding). GitHub responses are not cached.

**Why.** The first version of this ADR put HTTP responses in the Cache API. The Cloudflare docs promise working cache operations only on custom domains and Pages, and a free deploy lives on `*.workers.dev`. KV allows only 1,000 writes a day. D1 allows 100,000 row writes a day and is already bound. Storing reduced JSON instead of raw bodies also saves the parse CPU on a hit.

**Trade-off.** Each cache read or write is a D1 query, and those count toward the 50-per-invocation limit. Batch sizes account for it.

## ADR-008: Deterministic risk is the floor, AI can only raise it with evidence

**Decision.** `UpgradeAnalysisModule` sets a baseline risk from rules (major bump, deprecation, engines change, peer range conflict, breaking-change markers in notes). AI can raise the level only when it cites a source. It cannot lower the baseline. The report labels each finding as deterministic, AI-assessed or unverified.

**Why.** LLM output varies and can be wrong. A major upgrade should never show as low risk because a model said so.

**Trade-off.** Some upgrades look riskier than they are. The report shows why, so the user can judge.

## ADR-009: AI providers and keys (expanded in Phase 3)

**Decision.** `AI_PROVIDER` picks the provider: `workers-ai` (default, free tier, `@cf/meta/llama-3.3-70b-instruct-fp8-fast` with JSON mode), `anthropic` (official `@anthropic-ai/sdk`, `claude-opus-5-5`, Zod structured outputs, effort `medium`, server-side refusal fallbacks) or `openai` (plain `fetch`, JSON schema response format, `AI_MODEL` required because no default is pinned here). `AI_MODEL` overrides any default. Keys are Cloudflare secrets (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). The browser never sends or receives keys.

**Why.** This is a personal tool with no user accounts. Accepting keys from the browser would mean handling secrets in requests and logs for no benefit.

**Trade-off.** Visitors to a public demo cannot bring their own key.

## ADR-010: GitHub token recommended

**Decision.** `GITHUB_TOKEN` is an optional secret. Use a fine-grained token with no extra permissions, which can read public repositories. Without it, calls are unauthenticated.

**Why.** Unauthenticated GitHub API calls allow 60 requests per hour per IP. Worker egress IPs are shared, so that limit can run out fast. A token raises it to 5,000 per hour. Raw file downloads from `raw.githubusercontent.com` do not count against the API limit.

**Trade-off.** One more setup step. The README covers it.

## ADR-011: Plain Node tests, external calls mocked at `fetch`

**Decision.** Vitest runs in Node. Business logic is tested directly. Endpoints are tested through `app.request()` with a stubbed global `fetch`. D1-backed endpoints get tests in Phase 2, using an in-memory storage implementation behind the storage interface.

**Why.** Modules do not import Cloudflare bindings, so they need no Workers runtime to test. That avoids the extra setup of `@cloudflare/vitest-pool-workers`. Tests are kept few on purpose. They exist to support development.

**Trade-off.** No test exercises real D1 SQL. Migrations are checked by applying them with `wrangler d1 migrations apply --local`.

## Implementation log

Smaller calls made while building, in order.

### Phase 1 (24 Nov 2026)

| Situation | Options considered | Chosen, and why |
| --- | --- | --- |
| `npm install` pulled TypeScript 7, Zod 4, Vitest 4, Wrangler 4.168 | Pin older majors, or use current | Current. All compile and test clean, and the project is new. |
| Where to run tests | `@cloudflare/vitest-pool-workers`, or plain Node | Plain Node (ADR-011). Modules take their dependencies as arguments, so no Workers runtime is needed. |
| Detecting branch-list truncation | Parse the `Link` header, or check for a full page | Full page (100 branches) means truncated. The HTTP client returns bodies only, and the default branch is always fetched and listed first anyway. |
| Redirects from GitHub (renamed repos) | `redirect: "follow"`, or manual | Manual, up to 3 hops, with the host allowlist checked on each hop. `follow` could reach a host off the allowlist. |
| GitHub `403` responses | Treat all as errors, or detect rate limits | Detect rate limits (`x-ratelimit-remaining: 0` or `retry-after`). Short waits are retried inside the request. Long ones return `503` with `Retry-After`, so the scan runner can re-queue later. |
| Bug found by the test subagent: pnpm v5 `1.0.0_react@18.2.0` returned the peer's version | Reorder the string splits, or read the leading semver | Read the leading semver, and only strip an alias prefix when the value does not start with a digit. Covered by tests. |
| Live run: TanStack/query resolved 0 of 338 versions | Inspect the real lockfile | pnpm 11+ writes two YAML documents in `pnpm-lock.yaml`, and the first holds only pnpm itself. The parser now uses the last document. Regression test added. |
| Live run: the 20 manifest slots filled with `examples/*`, which TanStack's workspace globs include | Raise the cap, drop examples from globs, or rank them | Rank them: root, then own packages, then example and test folders. Nothing declared is excluded, but real packages come first. |
| Live run: `@types/react` installed at 19.3.0 against a declared `^18` because of pnpm `overrides` | Mark unresolved (`LOCKFILE_OUT_OF_SYNC`), or trust the lockfile | Trust the lockfile and remove the reason code. It is what installs. Phase 2 flags "outside declared range" from stored data. ADR-005 updated. |
| Frontend in Phase 1 | Scaffold Next.js now, or in Phase 4 | Phase 4. Nothing exists to display until scans run, and an empty scaffold would go stale. |
| KV and Queue bindings in `wrangler.jsonc` | Add now, or add with the code that uses them | Add with the code (Phase 2). Unused bindings need real IDs before deploy for no benefit. |

### Phase 2 (24 Nov 2026)

| Situation | Options considered | Chosen, and why |
| --- | --- | --- |
| npm full version lists are 8.8 MB (`typescript`) to 25.7 MB (`next`), too much for 10 ms of CPU | Always fetch the list; use a third-party version API; small endpoints first | Small npm endpoints first (`dist-tags` plus one version manifest). The list is fetched only when needed, capped at 5 MB, and marked `VERSION_LIST_TOO_LARGE` above that. Stays on npm as the spec requires. |
| The Cache API is not confirmed to work on `*.workers.dev` | Cache API anyway, KV, or D1 | D1 table `registry_cache` (ADR-007 revised). |
| Publish timestamps | Fetch full packuments for `time` | Not collected. Neither the abbreviated packument nor the per-version manifest has `time`, and the full packument is too large. GitHub releases are the dated source. |
| Resuming long stages | Cursor in `scans.checkpoint`, or pending state in the rows | Pending state in the rows (`upgrade_type IS NULL`, no `release_sources`). Simpler and idempotent. The `checkpoint` column is unused for now. |
| Duplicate queue messages and recovery | Lease only; lease plus a step number | Lease plus `step_seq` fencing (migration 0002). A lease alone lets two chains alternate forever. |
| Where `FETCHING_REPOSITORY` does its work | Inside `POST /api/scans`, or as its own step | Both. `POST` checks the repository and branch for a fast 404. The step pins the commit SHA, so the scan reads one consistent snapshot. |
| A package's registry call keeps failing (timeouts or 5xx after retries) | Fail the scan, or mark the package | Mark that package `REGISTRY_UNAVAILABLE` and keep going. Rate limits still pause the whole scan. |
| `ANALYZING_UPGRADES` and `GENERATING_REPORT` before Phase 3 | Stop at `COLLECTING_RELEASE_NOTES`, or pass through | Pass through to `COMPLETED`, with the stage text saying analysis is not built yet. Scans finish and the API is usable now. |
| Testing SQL | In-memory fake store (ADR-011's plan), or real D1 | Real local D1 through Wrangler's `getPlatformProxy`. No fake to maintain, and the real SQL gets tested. GitHub and npm are faked at `fetch` through a new `createApp({ fetch })` option. |
| Two subagents built version resolution and release notes in parallel | Shared files, or fixed contracts first | Contract files (`versions/types.ts`, `release-notes/types.ts`, `lib/cache.ts`, shared enums) were written before they started. Neither touched the other's files. I moved their SHA-256 helper to `lib/hash.ts` afterwards for reuse. |
| Live run: eslint 8.47 → 10.15 stored 85 releases, and the excerpt budget went to 10.15 down to 10.11, missing 10.0.0 and 9.0.0 | Raise the budget, or reprioritise | Reprioritise: migration guide, changelog, major releases (`x.0.0`), then the rest newest first. Test added. |
| Live run: `accepts` shows latest 1.3.8 while 2.0.0 exists | Treat the highest stable as latest | Keep npm's `latest` dist-tag (it really is 1.3.8, with `next: 2.0.0`). "Latest in range" still finds 2.0.0. The maintainers' tag is the authority. |

### Phase 3 (24 Nov 2026)

| Situation | Options considered | Chosen, and why |
| --- | --- | --- |
| Work split | One agent, or parallel | Three subagents in parallel (risk rules, AI module, report) against contract files written first (`upgrade-analysis/types.ts`, `ai/types.ts`, `report/types.ts`, shared `analysis.ts` and `report.ts`). I built migration 0003, advisories, stages, routes and wiring meanwhile. No file had two writers. |
| "Why update" vs "what could break" | One risk list | Two lists: risk factors and upgrade reasons. A security fix or a deprecated install is a reason to upgrade, not a risk of upgrading. Both are stored in `risk_factors` as `{ factors, reasons }`. |
| Security advisories | GitHub advisory API per package; npm bulk endpoint | npm's bulk endpoint (the one `npm audit` uses): one POST per scan, no auth. A fix is claimed only when the target version is outside the vulnerable range. |
| Which Workers AI model | Llama 3.1 8B, Llama 3.3 70B fast | Llama 3.3 70B fast: listed for JSON mode, free tier, 24k context. About 365 neurons an analysis, so about 27 a day free. |
| Anthropic client | Raw `fetch`, or the SDK | Official SDK (`@anthropic-ai/sdk` 1.13), as the Claude API guidance requires for TypeScript. `client.beta.messages.parse` with `zodOutputFormat`, `fallbacks: "default"` (server-side refusal fallback, enabled by default), effort `medium`, timeout 120 s (Opus 5.5 always thinks). |
| OpenAI client | Add the OpenAI SDK, or `fetch` | `fetch` in its own file. One endpoint, keeps dependencies minimal, and keeps the Anthropic code separate. |
| What the AI may name as affected files | Ask it freely; GitHub code search; candidate list | Candidate list: the manifests plus config files named after the package, with up to two file contents included. Code search needs a token and is rate-limited to 10 a minute. Anything outside the list is dropped. |
| AI claims citing sources it was not given | Drop them; keep them | Keep them, marked `unverified` with no link. Dropping hides possibly useful hints. Marking prevents them passing as evidence, and they cannot raise the risk level. |
| When to call AI | Every upgrade; risky ones | Only major, medium or high risk, or breaking-change markers, and only with release text to read. Riskiest first, capped per scan (`AI_MAX_ANALYSES_PER_SCAN`, default 10). |
| Report storage | Build on every request; snapshot | Snapshot on the scan (`scans.report`), written by `GENERATING_REPORT`. Reads are cheap and consistent. Reanalysis clears it and the stage writes a new one. |
| Reanalysis | New scan; reopen the scan | Reopen: reset risk for the chosen upgrades, mark them `pending` (or `pending_force` to skip the cache), set the scan back to `ANALYZING_UPGRADES`. The partial unique index stops it while another scan of the branch runs (409). |
| Workers AI binding broke local tests and `wrangler dev` (needs a Cloudflare login) | Remove the binding locally; disable remote bindings | `getPlatformProxy({ remoteBindings: false })` in tests with a fake `AI` binding, and `npm run dev` = `wrangler dev --local`. `npm run dev:remote-ai` uses real Workers AI after login. `.dev.vars.example` sets `AI_PROVIDER=none`. |
| Live run: local "Binding AI needs to be run remotely" was recorded as `failed` | Leave it; treat as unavailable | Unavailable: it stops further AI calls for the scan and marks the rest `skipped` with the reason. |
| Live run: summary said "0 patch, 0 minor, 1 major" and "1 dependencies" | Leave it | Zero counts dropped, singular fixed, test updated. |
| Subagent reports: SDK schema errors come back with the SDK's wording; total evidence cap includes file excerpts | Normalise the message; separate caps | Kept both. The outcome is still `failed` with a reason, and one cap keeps the prompt inside Llama's 24k context. |

### Phase 4 (24 Nov 2026)

| Situation | Options considered | Chosen, and why |
| --- | --- | --- |
| Next.js 16.4 is newer than the training data of the agents writing it | Write from memory, or read the bundled docs | Read `node_modules/next/dist/docs` first (the scaffold's `AGENTS.md` asks for this). It confirmed rewrites are not allowed with `output: "export"` and that `useSearchParams` needs a `Suspense` boundary. |
| Local dev needs `/api` on the same origin, but static export forbids rewrites | CORS on the API; phase-aware `next.config` | Phase-aware config: dev server proxies `/api` to `wrangler dev`, production build is a static export. No CORS code in the API. |
| `cacheComponents` and `partialPrefetching` from the scaffold | Keep, or drop | Dropped. The site is a client-rendered static export, so server caching adds nothing. |
| Routes for unknown IDs | Dynamic routes with `generateStaticParams`; query parameters | Query parameters (`/scan/?id=`). A static export cannot pre-render IDs that do not exist at build time. |
| shadcn 4.23 added `cn` and `shadcn` as runtime dependencies | Swap for `clsx` + `tailwind-merge`; keep | Keep. The generated components import `cn`, and `globals.css` imports `shadcn/tailwind.css`. `cn` is published by shadcn (`shadcn-ui/cn`). |
| TypeScript version in the web app | TypeScript 7 like the API; 5 | 5. Next.js type-checks through the TypeScript compiler API, which the native TypeScript 7 build may not provide. Workspaces allow different versions. |
| ESLint from the scaffold | Keep; remove | Removed. The project uses `tsc` and tests as checks; ESLint was never part of the plan. |
| Wrangler needs `apps/web/out` to exist even for API-only dev and tests | Commit a placeholder; create it on demand | `predev`, `pretest` and `predev:remote-ai` scripts create the folder. `predeploy` builds the site. |
| Work split | One agent, or parallel | Three subagents in parallel (dashboard, scan page and detail panel, report view and repository pages) on top of shared pieces I wrote first: API client with Zod validation, query hooks, badges, state components, layout, and a stub `ReportView` so the scan page could import it before it existed. |
| Parallel agents each wrote a `safe-link.tsx` helper | Keep both; merge | Merged into `components/safe-link.tsx` with one `isHttpUrl` check. Every call site already checked the URL first, so behaviour did not change. |
| Live check: the page background showed the browser's dark canvas | Opaque body colour; background on `<html>` | `bg-background` on `<html>`. The body's translucent tint then sits on white as intended. |
| Live check method | Screenshots only; driving the real flow | Drove the real flow in the in-app browser against the Worker serving the built site: check repository, start a scan of vercel/ms, watch progress, open a dependency, read the report, view history, and check 375px width (no horizontal scroll) and the console (no errors). |

### Phase 5 (24 Nov 2026)

| Situation | Options considered | Chosen, and why |
| --- | --- | --- |
| Security review | Review my own code; an independent agent | An independent agent given the code and the spec's security list, not my conclusions. It found 2 high, 4 medium and 6 low issues plus a functional bug; all were checked against the code and fixed. |
| H1: crafted workspace globs and long changelog lines caused regex backtracking (24 s measured); a step killed by the CPU limit never reported failure, so the cron retried it forever | Timeouts; rewrite matchers; attempt cap | Both. Workspace globs are matched segment by segment with a two-pointer wildcard matcher (no regex); changelog lines over 200 characters are skipped. The runner fails a scan once its lease count passes 4, which catches killed runs. |
| Sweep filter for exhausted scans | Exclude them from the sweep; keep sweeping them | Keep sweeping. Excluding them would leave a scan whose queue retries ran out stuck forever, blocking its branch. The runner fails it on the next lease instead. |
| H2: one scan had no size cap | Cap packages, evidence, GitHub calls | 300 distinct packages per scan (with a warning when truncated) and 20 release items per upgrade (majors first). With those caps, GitHub calls are bounded too. |
| Rate limiting for a public demo | Workers rate-limiting binding; D1 counters | D1 counters: exact, testable locally, and confirmed on Free. Global caps protect quotas; per-client caps (hashed IP, a quarter of the global cap) stop one caller from locking everyone out. Counters no longer write when over the limit. |
| M2: dashboard reads every scan per call | Precomputed totals; indexes and cache | Indexes (`scans(created_at)`, `scans(repository_id, status, created_at)`) and a 10-second per-isolate cache. Totals stay exact. |
| M3: re-analysis bypassed the per-scan AI budget | Disable `force`; count it | Count it: the per-scan AI cap is now a lifetime counter covering re-analysis, so `force` cannot drain the daily cap. |
| M4: rate-limited scans waited forever | Count waits as attempts; deadline | A 6-hour deadline from the start of the run. Reanalysis resets the start time. |
| Low findings | Fix or note | Fixed: prompt strings sanitised and tag-neutralised (attributes too), Markdown escaping widened, `page` capped, JSON-only POST bodies (415), remaining raw links use `SafeLink`, provider error text replaced with fixed messages. |
| Functional bug from the review: `recommendation` filter and `riskLevel` sort were never applied | Fix | Fixed in the store; covered by the scan-flow test and checked live. |
| Example report | Fabricate a polished one; export a real scan | A real export of `vercel/ms` with AI off, labelled as such. |
| Deployment | Deploy from here; document and dry-run | Documented in `DEPLOYMENT.md` and verified with `wrangler deploy --dry-run` (430 KB gzipped). The real deploy needs the owner's Cloudflare login. |
| Security headers | None; CSP | `_headers` for static pages (CSP with `'unsafe-inline'` scripts, which the Next.js export needs), Hono `secureHeaders()` for API responses. Checked in the browser: no CSP violations. |
| First deploy (24 Nov 2026) | | Deployed to `https://upgradepilot.upgradepilot-api.workers.dev` from this machine after the owner approved `wrangler login` in their browser. D1 created in APAC, queue and cron attached, Worker startup 36 ms. A live scan of `vercel/ms` completed in about a minute with real Workers AI: 3 analyses, cited sources, one honest "inconclusive", one upgrade skipped for lack of release text. |
