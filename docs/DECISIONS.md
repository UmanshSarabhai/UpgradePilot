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

## ADR-007: Caching split between the Cache API and KV

**Decision.** HTTP responses (npm metadata, GitHub files and metadata) go to the Cache API. KV holds only AI results, keyed by a hash of the full AI input.

**Why.** KV on Free allows 1,000 writes a day. One scan can touch hundreds of packages, so caching registry data in KV would hit that limit. The Cache API has no daily cap and suits HTTP responses. AI results are few, expensive and worth keeping across data centres, which suits KV.

**Trade-off.** The Cache API is per data centre, so a cold location refetches. That is fine for a personal tool.

## ADR-008: Deterministic risk is the floor, AI can only raise it with evidence

**Decision.** `UpgradeAnalysisModule` sets a baseline risk from rules (major bump, deprecation, engines change, peer range conflict, breaking-change markers in notes). AI can raise the level only when it cites a source. It cannot lower the baseline. The report labels each finding as deterministic, AI-assessed or unverified.

**Why.** LLM output varies and can be wrong. A major upgrade should never show as low risk because a model said so.

**Trade-off.** Some upgrades look riskier than they are. The report shows why, so the user can judge.

## ADR-009: AI provider keys are server-side secrets

**Decision.** Workers AI is the default provider. Anthropic or OpenAI is used when the owner sets `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` as a Cloudflare secret. The browser never sends or receives keys.

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
